-- IMDRF's own Annex E cross-lists roughly 200 terms under more than one category branch,
-- reusing the same code at each hierarchy position it appears at (e.g. E0104 "Cerebral
-- Hyperperfusion Syndrome" appears at both E01|E0104 and E05|E0104 — the same term, deliberately
-- shown under two branches). `code` alone is therefore not a safe uniqueness key within a
-- release; `code_hierarchy` is, because it names the exact position, and IMDRF never reuses a
-- hierarchy string within one annex's tree.
--
-- Widens 0018's `(release_id, code)` unique index to `(release_id, code, code_hierarchy)`. This
-- is additive to what an importer may write, not a narrowing: nothing that was valid before is
-- rejected now, and a row that was previously impossible (a repeated code at a new hierarchy
-- position) is now accepted, matching the real source workbook.

DROP INDEX "imdrf_terms_release_code_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "imdrf_terms_release_code_hierarchy_uq" ON "imdrf_terms" USING btree ("release_id","code","code_hierarchy");
