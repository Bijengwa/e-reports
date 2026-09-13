-- The IMDRF admin import/publish workflow and the read-only terminology sidebar both connect as
-- the application role, `ereports_app`, the same as every other route in this app.
--
-- Admin writes releases (create a draft, update a draft's metadata on re-import, flip it to
-- published) and rewrites a draft release's terms wholesale (delete then reinsert) rather than
-- editing rows in place -- so there is no UPDATE grant on imdrf_terms, only SELECT/INSERT/DELETE.
-- One write path is easier to reason about than "insert for a new release, update for a
-- re-import" would be.
--
-- Every signed-in staff role (manager, assessor, administrator) only ever reads through the
-- sidebar; that needs no grant beyond the SELECT already given here for the admin UI's own list
-- and detail views.
--
-- This is a privilege change and nothing else. No row is written, no column or constraint moves.

GRANT SELECT, INSERT, UPDATE ON TABLE "imdrf_releases" TO "ereports_app";--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE "imdrf_terms" TO "ereports_app";
