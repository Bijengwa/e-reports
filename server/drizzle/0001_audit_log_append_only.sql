-- The audit trail is append-only in the database, not merely by convention in application code.
-- A trail the application only promises not to edit is not a trail.
--
-- Two independent guards:
--   1. A trigger, which applies to every role including the table owner.
--   2. Privilege revocation for the application role, as defence in depth.

CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_log_no_mutation ON "audit_log";
--> statement-breakpoint

CREATE TRIGGER audit_log_no_mutation
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
--> statement-breakpoint

-- The application must connect as a non-owner, non-superuser role for this half to bite.
-- Skipped silently when the role does not exist yet, so local development still migrates.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ereports_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_log" FROM "ereports_app";
    GRANT SELECT, INSERT ON TABLE "audit_log" TO "ereports_app";
    GRANT USAGE, SELECT ON SEQUENCE "audit_log_id_seq" TO "ereports_app";
  ELSE
    RAISE NOTICE 'Role ereports_app does not exist; audit_log grants not applied. The trigger still protects the table.';
  END IF;
END
$$;
