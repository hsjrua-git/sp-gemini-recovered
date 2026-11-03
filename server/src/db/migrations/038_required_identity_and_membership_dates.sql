-- Schema 4 identity requirements apply to every writer, including imports.
ALTER TABLE students
  ALTER COLUMN gender SET NOT NULL,
  ALTER COLUMN birth_date SET NOT NULL,
  ALTER COLUMN father_name SET NOT NULL,
  ALTER COLUMN national_id SET NOT NULL,
  DROP CONSTRAINT students_birth_date_sane,
  ADD CONSTRAINT students_birth_date_sane CHECK (isfinite(birth_date) AND birth_date <= CURRENT_DATE),
  DROP CONSTRAINT students_father_name_length,
  ADD CONSTRAINT students_father_name_length CHECK (char_length(btrim(father_name)) BETWEEN 2 AND 100);

ALTER TABLE teachers
  DROP CONSTRAINT teachers_birth_date_sane,
  ADD CONSTRAINT teachers_birth_date_sane CHECK (isfinite(birth_date) AND birth_date <= CURRENT_DATE);

-- Recording a membership and joining a group are separate events. Keep the
-- original timestamp as creation history; eligibility uses the explicit date.
ALTER TABLE student_group_members RENAME COLUMN added_at TO created_at;
ALTER TABLE student_group_members ADD COLUMN joined_on date;
UPDATE student_group_members SET joined_on = created_at::date;
ALTER TABLE student_group_members
  ALTER COLUMN joined_on SET NOT NULL,
  DROP CONSTRAINT student_group_members_dates_ck,
  ADD CONSTRAINT student_group_members_dates_ck CHECK (
    isfinite(joined_on) AND (left_on IS NULL OR (isfinite(left_on) AND left_on >= joined_on))
  );
DROP INDEX student_group_members_history_unique;
CREATE UNIQUE INDEX student_group_members_history_unique
  ON student_group_members (student_id, group_id, joined_on);

-- PL/pgSQL source is not rewritten by ALTER COLUMN RENAME. Update the two
-- existing guards while retaining all their active-reference checks.
DO $$
DECLARE v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['evaluations_schema4_guard', 'tasks_schema4_guard'] LOOP
    EXECUTE replace(pg_get_functiondef((v_name || '()')::regprocedure),
      'm.added_at::date AS joined_on', 'm.joined_on');
  END LOOP;
END;
$$;

ALTER TABLE parameters ADD CONSTRAINT parameters_sort_ck CHECK (sort_order >= 0);
DROP INDEX parameters_parent_name_unique;
CREATE UNIQUE INDEX parameters_name_unique ON parameters (name);

ALTER TABLE user_preferences
  ADD CONSTRAINT user_preferences_object_ck CHECK (jsonb_typeof(settings) = 'object');
CREATE TRIGGER secrets_updated_at BEFORE UPDATE ON secrets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Global public configuration and global UI defaults complement per-user
-- preferences. Secrets continue to belong exclusively in secrets / the env.
CREATE TABLE settings (
  key text PRIMARY KEY CHECK (char_length(btrim(key)) BETWEEN 1 AND 120),
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER settings_updated_at BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TABLE preferences (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO preferences (id) VALUES (1);
CREATE TRIGGER preferences_updated_at BEFORE UPDATE ON preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
