# IMDRF terminology subsystem

An isolated repository of IMDRF adverse-event terminology, imported by an administrator by pasting
the yearly JSON payload IMDRF publishes, and browsed read-only by every signed-in staff role. Built
in two phases: Phase 1 (release repository + admin paste/validate/import/publish) and Phase 2 (the
read-only sidebar). Phase 3 — connecting this data into F004 Section 3 — has not been built.

The import path is paste-only: an administrator pastes the official IMDRF JSON payload verbatim
into a textarea on `/imdrf/manage/import`, a dedicated page reached from the release library at
`/imdrf/manage`. There is no file upload and no CLI/script import path — the server is the sole
source of truth for validation, exactly as it would be for any other input.

### Payload shape

The real IMDRF export is a **bare top-level JSON array** of terminology records — never an object
with a `releaseYear`/`annexes` wrapper. Each record looks like:

```json
{
  "code": "A0101",
  "term": "Patient-Device Incompatibility",
  "definition": "...",
  "non-IMDRF code": "MedDRA:10092649:...",
  "status": "",
  "status description": "",
  "primary category": "",
  "secondary category": "",
  "codehierarchy": "A|A01|A0101"
}
```

IMDRF actually publishes 8 such payloads per release: one **consolidated** array spanning all
seven annexes, and 7 **single-annex** arrays (one per annex, A–G). The two shapes differ in one
telling way: the consolidated array includes a bare annex-root record for each annex (`code: "A"`,
`codehierarchy: "A"`), and every other record's hierarchy begins with that same bare letter (e.g.
`"A|A01|A0101"`); a single-annex array omits that root record entirely, so its hierarchies start
directly at the first real code (e.g. `"A01|A0101"`, `"G01"`). `parser.ts` classifies a payload as
"consolidated" or "single-annex" from this fact in the data itself — there is no metadata field in
any real export that states which shape it is. Release-level metadata (`documentCode`, `title`,
the release year) is never carried in the payload; it is supplied by the import form and stored on
`imdrf_releases`, independent of the array.

Field names use spaces, and casing is inconsistent between the real exports themselves — the
consolidated file spells `"non-IMDRF code"`, the single-annex files spell `"non-imdrf code"` — so
`parser.ts` matches field names case-insensitively rather than trusting one spelling.

An administrator's document code and title default to `IMDRF/AE WG/N43` and
`IMDRF Adverse Event Terminology` on the import form, editable per release.

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

- **draft** — pasted, validated and imported, but not yet what read-only consumers see. An
  administrator may replace a draft's terms as many times as needed (re-pasting corrects mistakes)
  without creating a second row for that year.
- **published** — immutable. Once published, a release can never be re-imported over; the only way
  to change published terminology is to publish a later year.

2026 remaining unchanged when 2027 is imported, and both coexisting indefinitely, follows directly
from this: nothing ever writes across release rows, and `imdrf_terms.release_id` scopes every
query.

## Term model and hierarchy

`imdrf_terms` holds one row per term, at whatever depth its own annex actually has. Three fields
carry the hierarchy:

- `code_hierarchy` — the source payload's own trail, e.g. `A01|A0101|A010101`, kept verbatim.
- `level` — `code_hierarchy.split("|").length`, computed once at import time. Never hardcoded to a
  maximum: the real 2026 payload has annexes at depth 1 (Annex B), depth 2 (Annex D), and depth 3
  (A, C, E, F, G) side by side, in the same two tables.
- `parent_term_id` — a self-referencing foreign key, resolved at import time by matching a row's
  hierarchy-minus-its-last-segment against another row's own `code_hierarchy`.

`annex` is a plain `text` column (checked against `A`–`G`), not encoded in `code` or `id` — a
reader never infers the annex from the first character of a code.

### Variable hierarchy depth

See `server/src/domain/imdrf/parser.ts` and `validate.ts`. The parser reads the pasted JSON's
bare top-level array and maps fields by name, case-insensitively (`"non-IMDRF code"` /
`"non-imdrf code"`, etc. — see "Payload shape" above). Each record's annex is derived from the
first character of its own `code` (A–G), true of both the consolidated and single-annex shapes.
`level` is always derived from `code_hierarchy.split("|").length` at validation time, never from
anything the payload itself claims about depth — a payload cannot lie about a term's level by
mislabeling it.

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

`status` and `status_description` are preserved verbatim from the payload, including values like
`"Retired (2020)"`, and are never dropped, filtered, or converted to a boolean. A retired term
remains fully queryable and browsable — it is part of the historical record a release exists to
keep, not dead data.

## Import process and transaction safety

`server/src/domain/imdrf/import-service.ts` is the only writer. The flow:

1. **Validate/Preview** (`previewImdrfImport`) — parses and validates the pasted JSON text (bounded
   by `MAX_PAYLOAD_BYTES`, checked before `JSON.parse` ever runs). Never writes. On success ("
   VALIDATION PASSED" / "READY TO IMPORT"), holds the payload text in `imdrf_import_staging`
   (Postgres, not an in-memory map — a preview and its confirm can land on two different
   application instances once this deployment scales past one), keyed by a hashed, single-use,
   15-minute-TTL token. On failure ("IMPORT BLOCKED"), nothing is staged or written, and every
   issue found is reported at once.
2. **Import** (`confirmImdrfImport`) — consumes the token once, **re-parses and re-validates the
   held payload from scratch** (never trusts that nothing changed since validation), then does the
   entire write — release row insert/update, term delete-then-reinsert for a replaced draft, bulk
   term insert — inside one `db.transaction`. A failure anywhere rolls the whole thing back: a
   malformed 2027 payload can never leave 2026's rows touched, and can never leave 2027 half
   written.
3. **Publish** (`publishImdrfRelease`) — a single conditional `UPDATE ... WHERE status = 'draft'`,
   a deliberately separate, explicit action from import: importing a new release never makes it
   live on its own, and the previously published release for another year is untouched either way.

## Validation rules

`server/src/domain/imdrf/validate.ts`, run in full before any write: the payload must be valid
JSON; the top-level value must be an array of terminology records (never an object, never empty);
every record's `code` must resolve to a known annex (A–G); `code`/`term`/`codehierarchy` must be
present; the hierarchy's last segment must equal the record's own code; every non-root record's
parent hierarchy must resolve to another record in the same payload; a single-annex payload (no
annex-root marker records present) must not silently mix annexes; the release year supplied by the
import form must itself be a sane year; and `codehierarchy` (not `code` alone — see "Why `code`
alone is not unique" above) must be unique within the payload. Every failure is collected (not just
the first) and reported with the exact annex, index, field and message — an administrator sees
every problem in one paste rather than one per retry. A single error anywhere means zero terms are
computed for insertion at all — "IMPORT BLOCKED" is all-or-nothing.

## Admin permissions

Everything under `/imdrf/manage/*` (`server/src/doors/staff/imdrf/routes/admin.tsx`) sits in the
staff door's existing `administrator`-only scope (`doors/staff/index.ts`), beside `usersRoutes` and
`activityRoutes`. No new authentication or authorization system — the existing `requireRole` guard,
which refuses a manager or assessor with 403 before any handler runs, is what enforces this.

## How a future release is added

An administrator opens `/imdrf/manage` (the release library) and clicks "+ Import New Release" to
reach `/imdrf/manage/import`, pastes the new year's JSON payload verbatim (one of IMDRF's 8 real
export files — consolidated or single-annex, both accepted with no reformatting), clicks Validate,
reviews the full-width preview (detected payload shape, per-annex counts, hierarchy depth, a sample
of terms, and every validation issue if any), imports, and publishes it when ready. No file upload,
no CLI, no script, no deployment step — the whole workflow is the admin frontend.

## What Phase 2 (the sidebar) consumes

`server/src/domain/imdrf/query-service.ts` is the only reader both the admin UI's own list/detail
view and the sidebar use. Every function takes a `releaseId` and never queries across releases.
`listTerms`/`searchTerms` page results (a clamped server-side `limit` plus an opaque cursor over
`sort_order`) rather than loading a release's few thousand terms into memory or into the browser.
The sidebar itself (`server/src/doors/staff/imdrf/routes/imdrf.tsx`, `imdrf/pages/imdrf.tsx`,
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
