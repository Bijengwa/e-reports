-- Sign-in inserts a session row, and every request inside the staff door's authenticated area
-- slides `last_seen_at`. Migration 0003 withheld both privileges on purpose -- its comment reads
-- "No INSERT: this slice never creates one" -- which was true of the admin CLI and stops being
-- true here.
--
-- No CREATE ROLE: 0003 already created ereports_app, and creating it again from a second
-- migration would be a second place that decides what the role is.
--
-- Still withheld: nothing is granted on reports, assessments, attachments or report_counters.
-- No route in this slice touches them, and a grant that exists before its caller does is one
-- nobody will think to remove.
--
-- This is a privilege change and nothing else. No row is written, no column or constraint moves.
-- The application still connects as the owner, so granting to ereports_app takes nothing away
-- from it and alters no running behaviour -- only what the restricted role, which the integration
-- tests already connect as, is allowed to do.

GRANT INSERT, UPDATE ON TABLE "sessions" TO "ereports_app";
