-- An Officer can now register a report that arrived by email, so the staff door writes reports.
--
-- Migration 0005 granted SELECT and said why nothing else: "This slice reads: there is no assign,
-- no assessment, no status change, and the orange form's write path still connects as the owner.
-- INSERT or UPDATE here would be exactly the premature grant 0004 warned about." The caller now
-- exists, so the grant follows it -- the order those two migrations set.
--
-- Three tables, because one filing touches three. `storeReport` reserves a number by upserting
-- `report_counters` and reading back the new value, inserts the report, then inserts its
-- attachments, all in one transaction: a grant missing from any of them fails the whole filing
-- with 42501.
--
-- INSERT and no UPDATE on `reports`. Nothing in this slice edits a report once it is filed --
-- there is still no assign, no assessment and no status change -- and a report is a vigilance
-- record, so the privilege to rewrite one should arrive with the first caller that has a reason
-- to, not before. `report_counters` is the exception that proves the rule: incrementing the
-- year's counter *is* an UPDATE, and without it every report after the first in a year fails.
--
-- Still withheld: assessments, and DELETE on everything. No route added here touches either.
--
-- This is a privilege change and nothing else. No row is written, no column or constraint moves.

GRANT INSERT ON TABLE "reports" TO "ereports_app";--> statement-breakpoint
GRANT INSERT ON TABLE "attachments" TO "ereports_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "report_counters" TO "ereports_app";
