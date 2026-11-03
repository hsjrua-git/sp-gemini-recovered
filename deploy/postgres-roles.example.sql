-- Least-privilege deployment template adapted from schema-4-security.sql.
-- Run as the database owner/superuser after replacing all psql variables:
--
-- psql -d student_panel \
--   -v owner_role=student_panel_owner \
--   -v app_role=student_panel_app \
--   -v readonly_role=student_panel_readonly \
--   -v app_password='...' -v readonly_password='...' \
--   -f deploy/postgres-roles.example.sql
\set ON_ERROR_STOP on

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_role', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role')\gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'readonly_role', :'readonly_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'readonly_role')\gexec

REVOKE ALL ON SCHEMA public FROM public;
SELECT format('GRANT USAGE ON SCHEMA public TO %I, %I', :'app_role', :'readonly_role')\gexec

SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
  :'app_role'
)\gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_role')\gexec
SELECT format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I', :'app_role')\gexec
SELECT format('REVOKE ALL ON audit_log FROM %I', :'app_role')\gexec
SELECT format('GRANT SELECT, INSERT ON audit_log TO %I', :'app_role')\gexec

SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', :'readonly_role')\gexec
SELECT format('REVOKE ALL ON users, user_sessions, secrets FROM %I', :'readonly_role')\gexec
SELECT format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I', :'readonly_role')\gexec
SELECT format('ALTER ROLE %I SET default_transaction_read_only = on', :'readonly_role')\gexec

REVOKE ALL ON secrets FROM public;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM public;

SELECT format('ALTER ROLE %I SET search_path = public, pg_temp', :'app_role')\gexec
SELECT format('ALTER ROLE %I SET statement_timeout = %L', :'app_role', '30s')\gexec
SELECT format('ALTER ROLE %I SET lock_timeout = %L', :'app_role', '5s')\gexec
SELECT format(
  'ALTER ROLE %I SET idle_in_transaction_session_timeout = %L',
  :'app_role', '60s'
)\gexec

-- Future objects created by the owner inherit the same runtime grants.
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
  :'owner_role', :'app_role'
)\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO %I',
  :'owner_role', :'readonly_role'
)\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
  :'owner_role', :'app_role'
)\gexec
