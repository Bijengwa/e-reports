-- The manager-decision history the repeated A1 -> A2 -> Manager -> A3 -> Manager -> ... cascade
-- needs once a report can carry any number of secondary assessments, plus the terminal
-- "work officer assigned" state this MVP actually ends at.
--
-- `assigned_for_work` is additive on the existing report_status enum -- Postgres adds an enum
-- value without rewriting the column, so this carries none of the risk a value rename would.
-- `closed` is untouched and unused by this slice; it predates the secondary-assessment cascade.
--
-- report_decisions is new. It is deliberately not columns on `assessments`: a decision is not
-- about any one assessment row, including the one the manager just finished reading, and
-- `assessments.manager_comment` stays exactly what migration 0010 made it -- the manager's review
-- of one specific submitted assessment.
--
-- The CHECK constraint is the same discipline `f004.ts`'s A2SectionResponse already applies to its
-- three degrees: a `kind` carries exactly its own columns, so a row that claims one kind while
-- carrying the other's data cannot be written.
--
-- SELECT and INSERT only for the application role, matching 0011's assessment_comments: a decision
-- is an append-only event, nothing here is ever rewritten.

CREATE TYPE "public"."report_decision_kind" AS ENUM('assign_next_assessor', 'assign_work_officer');--> statement-breakpoint
ALTER TYPE "public"."report_status" ADD VALUE 'assigned_for_work';--> statement-breakpoint
CREATE TABLE "report_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"decided_by_user_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "report_decision_kind" NOT NULL,
	"comment" text,
	"reviewed_through_ordinal" smallint NOT NULL,
	"next_assessor_user_id" uuid,
	"next_ordinal" smallint,
	"work_officer_user_id" uuid,
	CONSTRAINT "report_decisions_kind_columns_ck" CHECK ((kind = 'assign_next_assessor' AND next_assessor_user_id IS NOT NULL
             AND next_ordinal IS NOT NULL AND work_officer_user_id IS NULL)
          OR (kind = 'assign_work_officer' AND work_officer_user_id IS NOT NULL
             AND next_assessor_user_id IS NULL AND next_ordinal IS NULL))
);
--> statement-breakpoint
ALTER TABLE "report_decisions" ADD CONSTRAINT "report_decisions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_decisions" ADD CONSTRAINT "report_decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_decisions" ADD CONSTRAINT "report_decisions_next_assessor_user_id_users_id_fk" FOREIGN KEY ("next_assessor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_decisions" ADD CONSTRAINT "report_decisions_work_officer_user_id_users_id_fk" FOREIGN KEY ("work_officer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_decisions_report_idx" ON "report_decisions" USING btree ("report_id","decided_at");--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "report_decisions" TO "ereports_app";
