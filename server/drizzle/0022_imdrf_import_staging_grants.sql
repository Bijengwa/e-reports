-- Preview writes a row, confirm reads and deletes it (single-use), and expired rows are swept the
-- same way on either path. No UPDATE: a staging row is never edited in place, only inserted once
-- and deleted once, so there is exactly one write path per row to reason about — the same
-- discipline the terminology tables themselves already keep (see 0019's own note on imdrf_terms).
--
-- This table is never read by the terminology query service and carries no grant that would let
-- it be: it is operational upload state, not something the read-only sidebar or the admin
-- list/detail views have any reason to see.

GRANT SELECT, INSERT, DELETE ON TABLE "imdrf_import_staging" TO "ereports_app";
