-- The first assessor can now write an F004, so the staff door writes assessments and moves a
-- report's status for the first time.
--
-- assessments has been withheld since 0004 -- "nothing is granted on reports, assessments,
-- attachments or report_counters" -- and 0005 and 0006 each repeated the reason. The caller now
-- exists, so the grant follows it, which is the order those migrations set.
--
-- SELECT as well as INSERT and UPDATE: a draft is read back onto the form every time the Officer
-- returns to it, and the save is an upsert on (report_id, ordinal), which needs both halves.
--
-- On reports, UPDATE of one column and no more. A first save moves a report from received to
-- first_assessment and a submit moves it to awaiting_second_assessor; nothing else about the row
-- may change from the application, and column-scoped UPDATE is how the database says so rather
-- than the application merely promising it. Granting UPDATE on the whole row would hand over the
-- number, the payload and the assignee too, none of which any route has a reason to rewrite.
--
-- Still withheld: DELETE on everything, attachments, and every other column of reports. An
-- assessment is a regulatory record; the privilege to erase one should arrive with the first
-- caller that has a reason to, and there is none.
--
-- This is a privilege change and nothing else. No row is written, no column or constraint moves.

GRANT SELECT, INSERT, UPDATE ON TABLE "assessments" TO "ereports_app";--> statement-breakpoint
GRANT UPDATE ("status") ON TABLE "reports" TO "ereports_app";
