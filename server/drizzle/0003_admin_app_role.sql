-- The role the application and the staff CLI are meant to run as.
--
-- Migration 0001 already revokes UPDATE/DELETE/TRUNCATE on audit_log from this role, but it
-- wraps everything in an IF EXISTS check and the role has never existed, so that block has
-- always taken its ELSE branch. Creating the role here means 0001's intent finally applies --
-- and because 0001 has already run, its grants and revoke are repeated below rather than
-- relied upon.
--
-- No password is set here. A migration is committed to git; a credential must not be. The
-- operator sets one out of band:
--
--   ALTER ROLE ereports_app PASSWORD '<generated>';
--
-- Granting to a new role takes nothing away from the owner, so the running application, which
-- currently connects as the owner, is unaffected.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ereports_app') THEN
    CREATE ROLE "ereports_app" LOGIN;
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA "public" TO "ereports_app";
--> statement-breakpoint

-- create inserts; reset-password updates password_hash and must_change_password.
GRANT SELECT, INSERT, UPDATE ON TABLE "users" TO "ereports_app";
--> statement-breakpoint

-- reset-password deletes the reset user's sessions. No INSERT: this slice never creates one.
GRANT SELECT, DELETE ON TABLE "sessions" TO "ereports_app";
--> statement-breakpoint

-- Repeated from 0001, which skipped because the role did not exist yet.
GRANT SELECT, INSERT ON TABLE "audit_log" TO "ereports_app";
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "audit_log_id_seq" TO "ereports_app";
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_log" FROM "ereports_app";