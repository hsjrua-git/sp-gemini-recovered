CREATE FUNCTION audit_academic_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_old jsonb; v_new jsonb; v_row jsonb; v_action text;
  v_user uuid; v_actor text; v_archive_key text;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old:=to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new:=to_jsonb(NEW); END IF;
  IF TG_OP='UPDATE' AND (v_old-'updated_at') IS NOT DISTINCT FROM (v_new-'updated_at') THEN
    RETURN NULL;
  END IF;
  v_row:=COALESCE(v_new,v_old);
  v_action:=CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'DELETE' THEN 'delete' ELSE 'update' END;
  v_archive_key:=CASE WHEN TG_TABLE_NAME='students' THEN 'deleted_at' ELSE 'archived_at' END;
  IF TG_OP='UPDATE' THEN
    IF v_old->>v_archive_key IS NULL AND v_new->>v_archive_key IS NOT NULL THEN v_action:='archive';
    ELSIF v_old->>v_archive_key IS NOT NULL AND v_new->>v_archive_key IS NULL THEN v_action:='restore';
    END IF;
  END IF;
  v_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  v_actor:=COALESCE(NULLIF(current_setting('app.actor',true),''),current_user);
  INSERT INTO audit_log(user_id,actor,action,entity_type,entity_id,details,old_data,new_data)
    VALUES(v_user,v_actor,TG_ARGV[0] || '.' || v_action,TG_ARGV[0],v_row->>'id',
      jsonb_strip_nulls(jsonb_build_object('source','database',
        'overrideReason',NULLIF(current_setting('app.override_reason',true),''))),v_old,v_new);
  RETURN NULL;
END;
$$;

DO $$
DECLARE v_pair text[];
BEGIN
  FOREACH v_pair SLICE 1 IN ARRAY ARRAY[
    ['students','student'],['student_groups','group'],['student_group_members','membership'],
    ['teachers','teacher'],['parameters','parameter'],['intervals','interval'],
    ['assignments','assignment'],['sessions','session'],['periods','period'],
    ['evaluations','evaluation'],['tasks','task'],['task_templates','task_template'],
    ['alerts','alert'],['student_field_definitions','field_definition']
  ] LOOP
    EXECUTE format('CREATE TRIGGER academic_row_audit AFTER INSERT OR UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION audit_academic_row(%L)',v_pair[1],v_pair[2]);
  END LOOP;
END;
$$;

ALTER TABLE audit_log ADD CONSTRAINT audit_row_identity_ck CHECK (
  details->>'source' IS DISTINCT FROM 'database'
  OR (entity_type IS NOT NULL AND entity_id IS NOT NULL AND (old_data IS NOT NULL OR new_data IS NOT NULL))
);
CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='TRUNCATE' AND current_setting('app.reset_data',true)='on' THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE='check_violation',CONSTRAINT='audit_log_append_only';
END;
$$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
REVOKE UPDATE,DELETE,TRUNCATE ON audit_log FROM PUBLIC;
