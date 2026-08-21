-- The manager's review of an assessment, stored beside the assessment it is about.
--
-- Three columns on assessments rather than a table of its own. The comment this workflow asks for
-- is one manager's finding on one assessment, and the row it hangs off already answers "which
-- report" and "which assessment" through the unique (report_id, ordinal) that has been there since
-- 0000. A separate table would restate both keys and open a way for a comment to point at the
-- wrong half of a review -- here that is not expressible, because the comment is the assessment
-- row. A thread of many comments is a different feature and would be a different table; the
-- process asks for one review, so this stores one.
--
-- Ordinal 2 gets the same three columns for nothing, which is the manager's later review of the
-- second assessment: the same shape, one row along, with no second mechanism to keep in step.
--
-- All three are nullable and move together. manager_comment_at IS NULL is what "not reviewed yet"
-- means, and no reader takes the text without it.
--
-- No GRANT here, and deliberately: 0008 granted SELECT, INSERT, UPDATE on the whole assessments
-- table to ereports_app, and a table-level grant covers columns added later. Repeating it would
-- suggest the privilege was missing, which it is not. Contrast 0009, which had to name its
-- columns because the reports grant is column-scoped.
--
-- NO ACTION on delete, matching every other user reference in the schema: a manager's row going
-- away must not silently empty the record of who reviewed an assessment.

ALTER TABLE "assessments" ADD COLUMN "manager_comment" text;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "manager_comment_by" uuid;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "manager_comment_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "assessments" ADD CONSTRAINT "assessments_manager_comment_by_users_id_fk" FOREIGN KEY ("manager_comment_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
