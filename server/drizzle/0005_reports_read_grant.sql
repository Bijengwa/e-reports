-- The staff door now lists reports and opens one.
--
-- Migration 0004 withheld every privilege on this table on purpose. Its comment reads "nothing is
-- granted on reports, assessments, attachments or report_counters. No route in this slice touches
-- them, and a grant that exists before its caller does is one nobody will think to remove." The
-- caller now exists, so the grant follows it rather than preceding it.
--
-- SELECT and nothing else. This slice reads: there is no assign, no assessment, no status change,
-- and the orange form's write path still connects as the owner. INSERT or UPDATE here would be
-- exactly the premature grant 0004 warned about.
--
-- Still withheld: assessments, attachments and report_counters. No route added here touches them,
-- so the same argument keeps them ungranted -- including attachments, which the report page
-- deliberately does not list.
--
-- This is a privilege change and nothing else. No row is written, no column or constraint moves.

GRANT SELECT ON TABLE "reports" TO "ereports_app";
