-- A statement-level gate is acquired before academic row locks. Updating the
-- version also forces stale repeatable-read writers to retry instead of
-- validating a relationship against an obsolete snapshot.
CREATE TABLE academic_invariant_lock (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  version bigint NOT NULL DEFAULT 0
);
INSERT INTO academic_invariant_lock (id) VALUES (true);
CREATE FUNCTION lock_academic_write() RETURNS void LANGUAGE sql AS $$
  UPDATE academic_invariant_lock SET version = version + 1 WHERE id;
$$;
CREATE FUNCTION academic_statement_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM lock_academic_write();
  RETURN NULL;
END;
$$;
DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['students','student_groups','student_group_members',
    'teachers','parameters','intervals','assignments','sessions','periods',
    'evaluations','tasks','task_templates'] LOOP
    EXECUTE format('CREATE TRIGGER academic_write_lock BEFORE INSERT OR UPDATE OR DELETE ON %I
      FOR EACH STATEMENT EXECUTE FUNCTION academic_statement_lock()', v_table);
  END LOOP;
END;
$$;

CREATE FUNCTION assignment_target_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.group_id IS DISTINCT FROM OLD.group_id OR NEW.membership_id IS DISTINCT FROM OLD.membership_id)
     AND (EXISTS (SELECT 1 FROM evaluations e JOIN sessions s ON s.id=e.session_id WHERE s.assignment_id=OLD.id)
       OR EXISTS (SELECT 1 FROM tasks t JOIN sessions s ON s.id=t.session_id WHERE s.assignment_id=OLD.id)) THEN
    RAISE EXCEPTION 'assignment target cannot change after evaluation cells or tasks exist'
      USING ERRCODE='check_violation', CONSTRAINT='assignment_target_history_ck';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_target_history_ck BEFORE UPDATE OF group_id, membership_id ON assignments
  FOR EACH ROW EXECUTE FUNCTION assignment_target_history_guard();

CREATE FUNCTION membership_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.student_id IS DISTINCT FROM OLD.student_id OR NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    IF EXISTS (SELECT 1 FROM assignments WHERE membership_id=OLD.id)
       OR EXISTS (SELECT 1 FROM evaluations WHERE membership_id=OLD.id)
       OR EXISTS (SELECT 1 FROM tasks WHERE membership_id=OLD.id) THEN
      RAISE EXCEPTION 'a referenced membership cannot change student or group'
        USING ERRCODE='check_violation', CONSTRAINT='membership_history_ck';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM sessions s JOIN (
      SELECT session_id FROM evaluations WHERE membership_id=OLD.id
      UNION SELECT session_id FROM tasks WHERE membership_id=OLD.id
    ) refs ON refs.session_id=s.id
    WHERE s.session_date < NEW.joined_on OR (NEW.left_on IS NOT NULL AND s.session_date > NEW.left_on)
  ) THEN
    RAISE EXCEPTION 'membership dates would exclude existing evaluations or tasks'
      USING ERRCODE='check_violation', CONSTRAINT='membership_history_ck';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER membership_history_ck BEFORE UPDATE OF student_id,group_id,joined_on,left_on ON student_group_members
  FOR EACH ROW EXECUTE FUNCTION membership_history_guard();

CREATE FUNCTION session_target_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_date date := COALESCE(NEW.moved_to, NEW.planned_date);
BEGIN
  IF NOT isfinite(v_date) THEN
    RAISE EXCEPTION 'session date must be finite' USING ERRCODE='check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM student_group_members m JOIN (
      SELECT membership_id FROM evaluations WHERE session_id=NEW.id
      UNION SELECT membership_id FROM tasks WHERE session_id=NEW.id
    ) refs ON refs.membership_id=m.id
    WHERE v_date < m.joined_on OR (m.left_on IS NOT NULL AND v_date > m.left_on)
  ) THEN
    RAISE EXCEPTION 'session date would exclude existing evaluation or task memberships'
      USING ERRCODE='check_violation', CONSTRAINT='session_target_history_ck';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER session_target_history_ck BEFORE UPDATE OF moved_to,archived_at,canceled_at ON sessions
  FOR EACH ROW EXECUTE FUNCTION session_target_history_guard();

CREATE FUNCTION generate_assignment_code(p_teacher uuid,p_interval uuid,p_group uuid,p_membership uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_teacher text; v_interval text; v_target text; v_base text; v_try text; v_n integer:=1; v_suffix text;
BEGIN
  SELECT code INTO v_teacher FROM teachers WHERE id=p_teacher;
  SELECT name INTO v_interval FROM intervals WHERE id=p_interval;
  IF p_group IS NOT NULL THEN
    SELECT code INTO v_target FROM student_groups WHERE id=p_group;
  ELSE
    SELECT st.student_code INTO v_target FROM student_group_members m
      JOIN students st ON st.id=m.student_id WHERE m.id=p_membership;
  END IF;
  v_base := left(COALESCE(NULLIF(trim(both '-' FROM regexp_replace(upper(
    COALESCE(v_target,'TARGET') || '-' || COALESCE(v_interval,'INTERVAL') || '-' || COALESCE(v_teacher,'TEACHER')
  ), '[^A-Z0-9]+','-','g')),''),'ASSIGNMENT'),40);
  v_try := v_base;
  WHILE EXISTS(SELECT 1 FROM assignments WHERE code=v_try) LOOP
    v_n:=v_n+1; v_suffix:='-' || v_n;
    v_try:=left(v_base,40-char_length(v_suffix)) || v_suffix;
  END LOOP;
  RETURN v_try;
END;
$$;
CREATE FUNCTION assignment_set_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS NULL OR btrim(NEW.code)='' THEN
    NEW.code:=generate_assignment_code(NEW.teacher_id,NEW.interval_id,NEW.group_id,NEW.membership_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_code_fill BEFORE INSERT ON assignments
  FOR EACH ROW EXECUTE FUNCTION assignment_set_code();

-- A selection is not an answer. Remember the FIRST answer independently of
-- row creation, so editing/clearing/restoring cannot renew a late-entry window.
ALTER TABLE evaluations ALTER COLUMN locks_at DROP NOT NULL;
ALTER TABLE evaluations ADD COLUMN first_answered_at timestamptz;
ALTER TABLE evaluations DISABLE TRIGGER evaluations_archived_edit_guard_trg;
UPDATE evaluations SET first_answered_at=created_at
  WHERE evaluation_is_answered(quality_value,quantity_value,quality_comment,quantity_comment);
UPDATE evaluations SET locks_at=NULL WHERE first_answered_at IS NULL;
ALTER TABLE evaluations ENABLE TRIGGER evaluations_archived_edit_guard_trg;

-- session_date is moved_to when present, otherwise planned_date. Calendar
-- midnight is interpreted in the database's configured institutional timezone.
CREATE FUNCTION evaluation_lock_deadline(p_date date,p_answered_at timestamptz)
RETURNS timestamptz LANGUAGE sql STABLE STRICT AS $$
  SELECT CASE WHEN p_answered_at < (p_date+7)::timestamptz
    THEN (p_date+7)::timestamptz ELSE p_answered_at+interval '24 hours' END;
$$;

CREATE FUNCTION evaluation_answer_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_date date;
BEGIN
  NEW.quality_comment:=NULLIF(btrim(NEW.quality_comment),'');
  NEW.quantity_comment:=NULLIF(btrim(NEW.quantity_comment),'');
  SELECT session_date INTO v_date FROM sessions WHERE id=NEW.session_id;
  IF TG_OP='UPDATE' AND OLD.first_answered_at IS NOT NULL THEN
    NEW.first_answered_at:=OLD.first_answered_at;
    IF NEW.locks_at IS DISTINCT FROM OLD.locks_at AND OLD.locks_at > now() THEN
      NEW.locks_at:=evaluation_lock_deadline(v_date,OLD.first_answered_at);
    ELSE
      NEW.locks_at:=OLD.locks_at;
    END IF;
  ELSIF evaluation_is_answered(NEW.quality_value,NEW.quantity_value,NEW.quality_comment,NEW.quantity_comment) THEN
    NEW.first_answered_at:=CASE WHEN TG_OP='INSERT' THEN COALESCE(NEW.first_answered_at,now()) ELSE now() END;
    IF NOT isfinite(NEW.first_answered_at) OR NEW.first_answered_at > now() THEN
      RAISE EXCEPTION 'first answer timestamp must be finite and not in the future' USING ERRCODE='check_violation';
    END IF;
    NEW.locks_at:=evaluation_lock_deadline(v_date,NEW.first_answered_at);
  ELSE
    NEW.first_answered_at:=NULL;
    NEW.locks_at:=NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER evaluations_00_answer_deadline BEFORE INSERT OR UPDATE ON evaluations
  FOR EACH ROW EXECUTE FUNCTION evaluation_answer_deadline();

CREATE OR REPLACE FUNCTION evaluations_lock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_reason text; v_changed boolean;
BEGIN
  IF OLD.locks_at IS NULL OR OLD.locks_at > now() THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    v_changed:=true;
  ELSE
    v_changed:=NEW.session_id IS DISTINCT FROM OLD.session_id
      OR NEW.parameter_id IS DISTINCT FROM OLD.parameter_id
      OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
      OR NEW.quality_value IS DISTINCT FROM OLD.quality_value
      OR NEW.quantity_value IS DISTINCT FROM OLD.quantity_value
      OR NEW.quality_comment IS DISTINCT FROM OLD.quality_comment
      OR NEW.quantity_comment IS DISTINCT FROM OLD.quantity_comment
      OR NEW.archived_at IS DISTINCT FROM OLD.archived_at;
  END IF;
  IF v_changed THEN
    v_reason:=NULLIF(btrim(COALESCE(current_setting('app.override_reason',true),'')),'');
    IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 5 AND 300 THEN
      RAISE EXCEPTION 'locked evaluation requires an override reason of 5 to 300 characters'
        USING ERRCODE='check_violation', CONSTRAINT='evaluations_lock_ck';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION session_move_deadlines() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_date IS DISTINCT FROM OLD.session_date
     AND NEW.archived_at IS NULL AND NEW.canceled_at IS NULL THEN
    UPDATE evaluations SET locks_at=evaluation_lock_deadline(NEW.session_date,first_answered_at)
      WHERE session_id=NEW.id AND archived_at IS NULL AND first_answered_at IS NOT NULL AND locks_at>now();
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER sessions_move_deadlines AFTER UPDATE OF moved_to ON sessions
  FOR EACH ROW EXECUTE FUNCTION session_move_deadlines();

ALTER TABLE evaluations ADD CONSTRAINT evaluation_answer_deadline_ck CHECK (
  (first_answered_at IS NULL) = (locks_at IS NULL)
  AND (NOT evaluation_is_answered(quality_value,quantity_value,quality_comment,quantity_comment)
       OR first_answered_at IS NOT NULL)
);

-- The effective lock instant is null until the deadline has passed; no daily
-- job is needed to turn a scheduled deadline into an enforced lock.
CREATE FUNCTION evaluation_locked_at(p_evaluation uuid) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN locks_at<=now() THEN locks_at END FROM evaluations WHERE id=p_evaluation;
$$;
