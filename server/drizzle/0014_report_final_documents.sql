-- The Final Document: what the manager actually approved, frozen at the moment of approval.
--
-- The third document in a system that has three. `reports.payload` is the Orange Report as filed
-- and never changes; `assessments` is the internal working record of A1..An and every disagreement
-- and clarification along the way; this is the one clean set of resolved answers, with the argument
-- left behind in the rows above.
--
-- Snapshotted rather than derived. "What exactly did the manager approve?" must be answerable next
-- year without replaying a resolution that may have been corrected since, over assessment rows that
-- may have gained a sibling -- a derived answer is a claim about the present, this is a record of
-- the past.
--
-- Deliberately not columns on `reports`: that table is granted UPDATE for the status cascade, so a
-- snapshot living there would be a mutable record of an immutable event.
--
-- SELECT and INSERT only for the application role, matching 0011 and 0012. An approval is an
-- append-only event; nothing here is ever rewritten, and the database is what enforces that rather
-- than a promise the application makes about itself.

CREATE TABLE "report_final_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"approved_by_user_id" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_through_ordinal" smallint NOT NULL,
	"form_version" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "report_final_documents_report_id_unique" UNIQUE("report_id")
);
--> statement-breakpoint
ALTER TABLE "report_final_documents" ADD CONSTRAINT "report_final_documents_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_final_documents" ADD CONSTRAINT "report_final_documents_decision_id_report_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."report_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_final_documents" ADD CONSTRAINT "report_final_documents_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_final_documents_approved_at_idx" ON "report_final_documents" USING btree ("approved_at");
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "report_final_documents" TO "ereports_app";
