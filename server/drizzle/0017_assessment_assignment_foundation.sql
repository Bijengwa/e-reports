-- Generalizes "who is this assessment's Officer, by whose decision, and by when must they act"
-- from a report-level pair of columns good for exactly one ordinal
-- (assessor1_user_id/assessor1_assigned_at) onto `assessments` itself -- the table already keyed
-- by (report_id, ordinal) for A1, A2, A3, ... An. A future assignment route for any ordinal reads
-- and writes these five columns; none of them belong to A1 alone, and none of them are added to
-- `reports` a second time.
--
-- `deadline_unit` is its own enum rather than text, on the same argument `report_status` and
-- `report_decision_kind` already make: the set of units a Manager may choose is closed, and the
-- database should refuse a sixth one rather than trust every future caller to remember the list.
--
-- All five columns are nullable, and stay that way for every row written before this migration:
-- nothing before it ever recorded who assigned an assessment or by when, and a backfilled guess
-- would be worse than a history that admits what it does not know.
--
-- No GRANT here. `assessments` already carries table-wide SELECT, INSERT and UPDATE for
-- `ereports_app` from migration 0008 -- these five columns arrive already writable, the same way
-- every column added to `reports` before this project started column-scoping its grants did.

CREATE TYPE "public"."deadline_unit" AS ENUM('seconds', 'minutes', 'hours', 'days', 'weeks');--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "assigned_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "deadline_value" integer;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "deadline_unit" "deadline_unit";--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Serves the overdue/near-deadline sweep a later slice runs across every open assessment.
CREATE INDEX "assessments_due_at_idx" ON "assessments" USING btree ("due_at");
