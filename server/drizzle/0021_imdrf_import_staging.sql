-- The hold between an administrator's "preview" and "confirm" clicks. Not terminology data —
-- one uploaded workbook's bytes and metadata, kept only long enough to be re-validated and
-- imported, or to expire unused. Moved out of the application's in-memory process into Postgres
-- because a preview and its confirm can land on two different application instances once this
-- deployment scales past one; see `db/schema/index.ts` for the full rationale.
--
-- `created_by_user_id` is audit metadata (who started an import), the same shape `audit_log`
-- already uses — not a foreign key from reports/assessments/F004/Register into IMDRF, which this
-- subsystem still carries none of.

CREATE TABLE "imdrf_import_staging" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"release_year" smallint NOT NULL,
	"document_code" text,
	"title" text,
	"source_file_name" text NOT NULL,
	"workbook_data" bytea NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "imdrf_import_staging_token_hash_unique" UNIQUE("token_hash")
);--> statement-breakpoint
ALTER TABLE "imdrf_import_staging" ADD CONSTRAINT "imdrf_import_staging_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "imdrf_import_staging_expires_at_idx" ON "imdrf_import_staging" USING btree ("expires_at");
