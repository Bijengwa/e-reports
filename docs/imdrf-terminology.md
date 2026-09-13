# IMDRF terminology subsystem

An isolated repository of IMDRF adverse-event terminology, imported by an administrator from the
yearly workbook IMDRF publishes, and browsed read-only by every signed-in staff role. Built in two
phases: Phase 1 (release repository + admin import/publish) and Phase 2 (the read-only sidebar).
Phase 3 — connecting this data into F004 Section 3 — has not been built.

## Why it is separate

`reports`, `assessments`, `assessment_comments`, `report_decisions`, the Register, and F004's
payloads all describe one report's journey through this office's own workflow. IMDRF terminology
describes something else entirely: a vocabulary IMDRF publishes once a year that TMDA merely
stores. There is no foreign key from any existing table into `imdrf_releases` or `imdrf_terms`,
and none of those tables or their code were touched to build this. Wiring a report or an
assessment to a specific term is Phase 3's job.

## Release model

`imdrf_releases` (`server/src/db/schema/index.ts`) is one row per yearly release — 2026, 2027, and
so on — identified by `release_year` (a business key, unique, not the primary key: the primary key
is a UUID like every other table in this schema). A release has a lifecycle of exactly two states:

- **draft** — uploaded and validated, but not yet what read-only consumers see. An administrator
  may replace a draft's terms as many times as needed (re-uploading corrects mistakes) without
  creating a second row for that year.
- **published** — immutable. Once published, a release can never be re-imported over; the only way
  to change published terminology is to publish a later year.

2026 remaining unchanged when 2027 is imported, and both coexisting indefinitely, follows directly
from this: nothing ever writes across release rows, and `imdrf_terms.release_id` scopes every
query.

## Term model and hierarchy

`imdrf_terms` holds one row per term, at whatever depth its own annex actually has. Three fields
carry the hierarchy:

- `code_hierarchy` — the source workbook's own trail, e.g. `A01|A0101|A010101`, kept verbatim.
- `level` — `code_hierarchy.split("|").length`, computed once at import time. Never hardcoded to a
  maximum: the real 2026 workbook has annexes at depth 1 (Annex B), depth 2 (Annex D), and depth 3
  (A, C, E, F, G) side by side, in the same two tables.
- `parent_term_id` — a self-referencing foreign key, resolved at import time by matching a row's
  hierarchy-minus-its-last-segment against another row's own `code_hierarchy`.

`annex` is a plain `text` column (checked against `A`–`G`), not encoded in `code` or `id` — a
reader never infers the annex from the first character of a code.

### Variable hierarchy depth

See `server/src/domain/imdrf/parser.ts` and `validate.ts`. The parser detects each sheet's header
row by content (a cell reading exactly `"Level 1 Term"`), not by row number — the real workbook's
metadata rows are not laid out identically across sheets — and maps columns by normalized header
text, tolerating the workbook's own inconsistencies (`"Non-IMDRF Code"` vs `"Non-IMDRF Code/Term"`,
1–3 "Level N Term" columns per sheet). `level` is always derived from `code_hierarchy`, never from
which "Level N Term" column held the text.

### Why `code` alone is not unique

The real 2026 Annex E cross-lists roughly 200 terms under more than one category branch, reusing
the same `code` at each hierarchy position (e.g. `E0104` "Cerebral Hyperperfusion Syndrome"
appears at both `E01|E0104`, under Nervous System, and `E05|E0104`, under Vascular System — the
same term, deliberately shown in two places). The unique index is therefore
`(release_id, code, code_hierarchy)`, not `(release_id, code)`, and duplicate detection /
parent resolution in `validate.ts` key on the full hierarchy string rather than the bare code. The
same code recurring in a *later* release (2027 reusing `G02002`) is expected and unaffected — that
is scoped by `release_id`, same as before.

### Retired terms

`status` and `status_description` are preserved verbatim from the workbook, including values like
`"Retired (2020)"`, and are never dropped, filtered, or converted to a boolean. A retired term
remains fully queryable and browsable — it is part of the historical record a release exists to
keep, not dead data.

## Import process and transaction safety

`server/src/domain/imdrf/import-service.ts` is the only writer. The flow:

1. **Preview** (`previewImdrfImport`) — parses and validates an uploaded buffer. Never writes. On
   success, holds the buffer in an in-memory, single-process, 15-minute-TTL map keyed by an opaque
   token (documented limitation: this deployment runs one Fastify process, so this is sufficient;
   see the "AE Reports locked architecture" note).
2. **Confirm** (`confirmImdrfImport`) — consumes the token once, **re-parses and re-validates the
   held buffer from scratch** (never trusts that nothing changed since the preview), then does the
   entire write — release row insert/update, term delete-then-reinsert for a replaced draft, bulk
   term insert — inside one `db.transaction`. A failure anywhere rolls the whole thing back: a
   malformed 2027 workbook can never leave 2026's rows touched, and can never leave 2027 half
   written.
3. **Publish** (`publishImdrfRelease`) — a single conditional `UPDATE ... WHERE status = 'draft'`.

## Validation rules

`server/src/domain/imdrf/validate.ts`, run in full before any write: annex must be one of A–G,
`code`/`term`/`code_hierarchy` must be present, exactly one "Level N Term" column must be filled
per row, the hierarchy's last segment must equal the row's own code, every non-root row's parent
hierarchy must resolve to another row in the same workbook, the release year the workbook declares
must match the year being imported, and `(code, code_hierarchy)` must be unique within the
workbook. Every failure is collected (not just the first) and reported with the exact sheet, row,
field and message — an administrator sees every problem in one upload rather than one per retry.
A single error anywhere means zero terms are computed for insertion at all.

## Admin permissions

Everything under `/imdrf/manage/*` (`server/src/doors/staff/routes/imdrf-admin.tsx`) sits in the
staff door's existing `administrator`-only scope (`doors/staff/index.ts`), beside `usersRoutes` and
`activityRoutes`. No new authentication or authorization system — the existing `requireRole` guard,
which refuses a manager or assessor with 403 before any handler runs, is what enforces this.

## How a future release is added

An administrator opens `/imdrf/manage`, uploads the new year's `.xlsx`, reviews the preview (which
shows per-annex counts and every validation issue, if any), confirms the import, and publishes it
when ready. No CLI, no script, no deployment step — the whole workflow is the admin frontend.

## What Phase 2 (the sidebar) consumes

`server/src/domain/imdrf/query-service.ts` is the only reader both the admin UI's own list/detail
view and the sidebar use. Every function takes a `releaseId` and never queries across releases.
`listTerms`/`searchTerms` page results (a clamped server-side `limit` plus an opaque cursor over
`sort_order`) rather than loading a release's few thousand terms into memory or into the browser.
The sidebar itself (`server/src/doors/staff/routes/imdrf.tsx`, `views/imdrf.tsx`,
`public/imdrf-browser.js`) sits in the staff door's `active` scope — every signed-in, password-set
role, the same nesting level as the reports index — because it is a reference tool, not a
vigilance record. `requirePublishedRelease` is the one function every read-only handler calls
first: a draft release 404s exactly as a nonexistent one would, so a non-admin reader cannot tell
"no such release" from "not published yet" apart.

## What Phase 3 will eventually connect

F004 Section 3 currently stores free-text/coded answers (`imdrf_component_l1`, `_l2`, `_l3`,
`_code`, and the equivalent fields for device problem, clinical signs, health impact, investigation
type/findings/conclusion — see `server/src/domain/f004.ts` and `register.ts`, which map those
fields to the Register's V–AW columns). Phase 3 is expected to let an assessor pick a term from
this repository instead of typing free text, and to store a reference to the chosen `imdrf_terms`
row. That is a workflow decision with real implications for F004's existing payload shape and is
deliberately out of scope here: **no foreign key exists yet from `reports`, `assessments`, or any
F004 payload into `imdrf_terms`**, and none of those files were modified to build Phase 1 or 2.
