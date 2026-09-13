# IMDRF Terminology Subsystem (Phase 1 + Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated IMDRF adverse-event terminology repository (yearly releases, hierarchical terms) with an admin-only import/publish workflow and a read-only staff sidebar/browser, without touching reports/assessments/register/F004.

**Architecture:** Two new tables (`imdrf_releases`, `imdrf_terms`, self-referencing hierarchy) behind a domain layer (`server/src/domain/imdrf/`) with a parser → validator → import-service → database pipeline. Admin routes (upload/preview/confirm/publish) sit in the staff door's existing `administration` scope; read-only routes sit in the existing `active` scope (every signed-in role). No CLI. No FK from existing tables into IMDRF.

**Tech Stack:** Fastify 5, Drizzle ORM (postgres-js), `exceljs` (already a dependency) for XLSX parsing, `@kitajs/html` TSX views, Zod, Vitest.

## Global Constraints

- No CLI import path of any kind (no `pnpm db:import-imdrf`, no script run with `tsx`/`node`).
- Two tables only: `imdrf_releases`, `imdrf_terms`. No `level_1`/`level_2`/`level_3` columns; `level` is always derived from `code_hierarchy` segment count, never hardcoded to a max.
- No FK from `reports`, `assessments`, `assessment_comments`, `report_decisions`, `users`, `sessions`, Register tables, or F004 payloads into IMDRF tables, and no edits to those tables/files.
- Reuse existing auth (`requireRole`, `currentSession`) — no second auth system.
- Transaction safety: a failed import must leave zero partial writes; only a `draft` release may be replaced by re-import; a `published` release is immutable.
- Uploaded workbook is parsed with `exceljs` (already installed) — no new dependency.
- Follow existing code conventions exactly: routes use `app.db.execute(sql\`...\`)` style raw parameterized SQL seen in `users.tsx`/`register.ts` for hand-rolled queries, Drizzle's schema builder (`pgTable`) for schema, `@kitajs/html` JSX for views, `StaffShell` wrapper, Zod for form/body validation.

---

## File Structure

```
server/src/db/schema/index.ts                       (add: imdrfReleaseStatus enum, imdrfReleases, imdrfTerms)
server/drizzle/0018_imdrf_terminology.sql            (schema-only migration)
server/drizzle/0019_imdrf_terminology_grants.sql     (GRANT migration for ereports_app)

server/src/domain/imdrf/types.ts                     (shared types: Annex, ReleaseStatus, ParsedTermRow, etc.)
server/src/domain/imdrf/parser.ts                    (workbook -> ParsedAnnexSheet[] + ParseIssue[])
server/src/domain/imdrf/validate.ts                  (ParsedAnnexSheet[] -> ValidatedTerm[] + ValidationIssue[])
server/src/domain/imdrf/import-service.ts            (preview/import/publish orchestration + transaction + pending-upload store)
server/src/domain/imdrf/query-service.ts             (read-only queries: releases, annex summary, terms, children, search)

server/src/doors/staff/routes/imdrf-admin.tsx        (admin: list/detail/upload/preview/confirm/publish)
server/src/doors/staff/views/imdrf-admin.tsx         (admin views)
server/src/doors/staff/routes/imdrf.tsx              (read-only: releases/annex/terms/search/detail JSON+HTML endpoints)
server/src/doors/staff/views/imdrf.tsx               (read-only sidebar/browser view + its small client script)
server/src/doors/staff/index.ts                      (register the two new route modules in the right scopes)
server/src/doors/staff/views/shell.tsx               (add one rail entry: "IMDRF Terminology", active for every role)
server/tests/integration/helpers.ts                  (add imdrf_releases to truncateAll's table list)

server/tests/unit/imdrf-parser.test.ts
server/tests/unit/imdrf-validate.test.ts
server/tests/unit/imdrf-query-service.test.ts
server/tests/integration/staff-imdrf-admin.test.ts
server/tests/integration/staff-imdrf-readonly.test.ts

docs/imdrf-terminology.md                            (architecture doc, per spec section 26 / 21)
```

## Data Model

```ts
export const imdrfReleaseStatus = pgEnum("imdrf_release_status", ["draft", "published"]);

export const imdrfReleases = pgTable("imdrf_releases", {
  id: uuid("id").primaryKey().defaultRandom(),
  releaseYear: smallint("release_year").notNull().unique(),
  documentCode: text("document_code"),
  title: text("title"),
  sourceFileName: text("source_file_name").notNull(),
  status: imdrfReleaseStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export const imdrfTerms = pgTable("imdrf_terms", {
  id: uuid("id").primaryKey().defaultRandom(),
  releaseId: uuid("release_id").notNull().references(() => imdrfReleases.id, { onDelete: "cascade" }),
  annex: text("annex").notNull(),
  code: text("code").notNull(),
  term: text("term").notNull(),
  definition: text("definition"),
  nonImdrfCode: text("non_imdrf_code"),
  status: text("status"),
  statusDescription: text("status_description"),
  primaryCategory: text("primary_category"),
  secondaryCategory: text("secondary_category"),
  codeHierarchy: text("code_hierarchy").notNull(),
  parentTermId: uuid("parent_term_id").references((): AnyPgColumn => imdrfTerms.id),
  level: smallint("level").notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("imdrf_terms_release_code_uq").on(t.releaseId, t.code),
  index("imdrf_terms_release_annex_sort_idx").on(t.releaseId, t.annex, t.sortOrder),
  index("imdrf_terms_release_parent_idx").on(t.releaseId, t.parentTermId),
  index("imdrf_terms_release_level_idx").on(t.releaseId, t.level),
  check("imdrf_terms_annex_ck", sql`annex IN ('A','B','C','D','E','F','G')`),
]);
```

Self-reference needs Drizzle's `AnyPgColumn` callback form (already available in drizzle-orm/pg-core) since `imdrfTerms` references itself.

Search: dataset is small (~2,100 terms/release, confirmed by inspecting the actual 2026 workbook — see Task 2 notes), so plain `ILIKE` over `code`/`term`/`definition` filtered first by `release_id` (already the leading column of every composite index) is fast with no extra extension (no `pg_trgm`, keeping ops footprint minimal, consistent with "do not create unnecessary indexes").

## Workbook Structure (inspected directly — do not re-derive from assumptions)

Confirmed by loading `docs/TMDA files for reference/imdrf-tech-ae-terminologies-n43-ReleaseNumber2026-Annexes-revised 1 (1).XLSX` with `exceljs`:

- 7 worksheets, named exactly `"A"` … `"G"` (single letter, not "Annex A").
- Row 1 of each sheet has rich text `"Annex Name:" " Annex <L>"` — used as a cross-check that the sheet's own letter matches its stated annex name.
- Metadata rows occupy rows 1–7 (title/description/approval date/field-length note); **order and count of these rows is not identical across sheets** (Annex E has the field-length note before the approval date; others have it after) — so the header row must be *detected*, never assumed to be a fixed row number.
- Header row (row 8 in every sheet inspected, but detected by content, not position): first cell text is exactly `"Level 1 Term"`. Column sets differ per sheet:
  - A, C, F, G: `Level 1 Term, Level 2 Term, Level 3 Term, Code, Definition, Non-IMDRF Code[/Term], Status, Status Description, CodeHierarchy`
  - B: `Level 1 Term, Code, Definition, Non-IMDRF Code, Status, Status Description, CodeHierarchy` (no Level 2/3 — max depth 1)
  - D: `Level 1 Term, Level 2 Term, Code, Definition, Non-IMDRF Code, Status, Status Description, CodeHierarchy` (max depth 2)
  - E: adds `Primary Category`, `Secondary Category` columns (max depth 3)
  - Header text for the "Non-IMDRF Code" column varies (`"Non-IMDRF Code"` vs `"Non-IMDRF Code/Term"`) — map columns by normalized header text (trim, collapse whitespace, case-insensitive, and match `/^non-imdrf code/i` etc.), never by fixed column index.
- Exactly one `Level N Term` cell is filled per data row (the row's own term); the others are null. `Code` and `CodeHierarchy` are always present in the real workbook (0 blank in the actual file) but the parser/validator must not assume that and must report a precise error when they are missing.
- One fully-blank trailing row exists (Annex E, last row) — skip fully-blank rows silently, do not treat as a record and do not error on them.
- `status` values are inconsistent free text across annexes (`"Modified (editorial)"` vs `"Modified (Editorial)"` in Annex C, `"Retired (2025)"`, `"New"`, `"Not selectable"`, `"Not selectable. Modified (editorial)"`) — stored verbatim as `text`, never normalized into an enum, never dropped.
- `Release Number:` cell reads `"2026"` on every sheet — cross-checked against the release year the admin is importing.
- No merged cells in any of the 7 sheets (confirmed via `worksheet.model.merges`).

---

## Task 1: Schema + migrations

**Files:**
- Modify: `server/src/db/schema/index.ts` (append `imdrfReleaseStatus`, `imdrfReleases`, `imdrfTerms`, `AnyPgColumn` import)
- Create: `server/drizzle/0018_imdrf_terminology.sql`
- Create: `server/drizzle/0019_imdrf_terminology_grants.sql`
- Modify: `server/drizzle/meta/_journal.json` (append idx 18/19, `when` values strictly greater than 1788272959000)

**Interfaces:**
- Produces: `imdrfReleases`, `imdrfTerms`, `imdrfReleaseStatus` exports other tasks import from `../../../db/schema/index.js`.

- [ ] Add the schema block above to `server/src/db/schema/index.ts` (import `AnyPgColumn` from `drizzle-orm/pg-core` alongside the existing imports).
- [ ] Run `pnpm db:generate` (or hand-write, matching the tool's SQL style) to produce `0018_imdrf_terminology.sql` creating the enum, both tables, and all four indexes/constraints listed above.
- [ ] Hand-write `0019_imdrf_terminology_grants.sql`:
  ```sql
  -- The IMDRF admin import/publish workflow and the read-only sidebar both connect as the
  -- application role. Admin writes releases and (re)writes a draft release's terms; every
  -- signed-in role only ever reads. No UPDATE on imdrf_terms: a draft re-import always deletes
  -- and reinserts rather than editing rows in place, so there is one write path to reason about.
  GRANT SELECT, INSERT, UPDATE ON TABLE "imdrf_releases" TO "ereports_app";--> statement-breakpoint
  GRANT SELECT, INSERT, DELETE ON TABLE "imdrf_terms" TO "ereports_app";
  ```
- [ ] Append both entries to `server/drizzle/meta/_journal.json` with `when` values after the current max (1788272959000) — see [[drizzle-journal-timestamp-trap]] memory: bump strictly above the latest existing entry, never hand-stamp a past/duplicate value.
- [ ] Run `pnpm typecheck` — must stay green.
- [ ] Apply migrations against the dev DB (`pnpm db:migrate`) and confirm `\d imdrf_terms` shows both FKs, the unique index, and the check constraint.
- [ ] Add `imdrf_releases` to the `TRUNCATE` list in `server/tests/integration/helpers.ts` (cascades to `imdrf_terms` via FK `ON DELETE CASCADE`, so it does not need to be listed separately — but must be listed itself since nothing else cascades into it).
- [ ] Commit: `feat(imdrf): add release/term schema, migration, and grants`.

## Task 2: Parser (`server/src/domain/imdrf/parser.ts`)

**Files:**
- Create: `server/src/domain/imdrf/types.ts`
- Create: `server/src/domain/imdrf/parser.ts`
- Test: `server/tests/unit/imdrf-parser.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const ANNEXES = ["A", "B", "C", "D", "E", "F", "G"] as const;
  export type Annex = (typeof ANNEXES)[number];

  export type ParsedRow = {
    annex: Annex;
    sheetName: string;
    rowNumber: number;       // 1-based row in the sheet, for error messages
    sourceOrder: number;     // 0-based order within the annex, for sort_order
    term: string | null;
    code: string | null;
    definition: string | null;
    nonImdrfCode: string | null;
    status: string | null;
    statusDescription: string | null;
    primaryCategory: string | null;
    secondaryCategory: string | null;
    codeHierarchy: string | null;
    filledLevelColumns: number; // how many "Level N Term" cells were non-blank (should be 1)
  };

  export type ParseIssue = {
    severity: "error" | "warning";
    annex: Annex | null;
    sheet: string;
    row: number | null;
    field: string | null;
    message: string;
  };

  export type ParsedWorkbook = {
    rows: ParsedRow[];
    issues: ParseIssue[];
    releaseYearsFound: Set<number>; // from "Release Number:" cells, for cross-check
  };

  export async function parseImdrfWorkbook(buffer: Buffer): Promise<ParsedWorkbook>;
  ```
- Consumes: nothing from other tasks.

- [ ] Write `types.ts` with the `Annex`/`ANNEXES` exports above (shared with validate/import/query/routes).
- [ ] Write the failing test file with these cases against a tiny in-memory workbook built with `ExcelJS.Workbook()` in the test itself (no dependency on the real file, so the suite runs offline):
  ```ts
  import { describe, expect, it } from "vitest";
  import ExcelJS from "exceljs";
  import { parseImdrfWorkbook } from "../../src/domain/imdrf/parser.js";

  async function bufferOf(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    build(wb);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  function addAnnexA(wb: ExcelJS.Workbook): void {
    const ws = wb.addWorksheet("A");
    ws.addRow(["Annex Name: Annex A"]);
    ws.addRow(["Annex Title: Medical Device Problem"]);
    ws.addRow(["Release Number: 2026"]);
    ws.addRow([]);
    ws.addRow([]);
    ws.addRow([]);
    ws.addRow([]);
    ws.addRow(["Level 1 Term", "Level 2 Term", "Level 3 Term", "Code", "Definition", "Non-IMDRF Code", "Status", "Status Description", "CodeHierarchy"]);
    ws.addRow(["Root Term", null, null, "A01", "def", null, null, null, "A01"]);
    ws.addRow([null, "Child Term", null, "A0101", "def2", null, null, null, "A01|A0101"]);
    ws.addRow([null, null, "Grandchild Term", "A010101", "def3", null, "Retired (2020)", "no longer used", "A01|A0101|A010101"]);
    ws.addRow([]); // trailing blank row, must be skipped silently
  }

  describe("parseImdrfWorkbook", () => {
    it("discovers annex sheets by content and detects the header row by name, not position", async () => {
      const buf = await bufferOf(addAnnexA);
      const parsed = await parseImdrfWorkbook(buf);
      expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(parsed.rows).toHaveLength(3);
    });

    it("maps columns by header meaning, tolerating header text variants", async () => {
      const buf = await bufferOf((wb) => {
        const ws = wb.addWorksheet("C");
        for (let i = 0; i < 7; i++) ws.addRow([]);
        ws.addRow(["Level 1 Term", "Level 2 Term", "Level 3 Term", "Code", "Definition", "Non-IMDRF Code/Term", "Status", "Status Description", "CodeHierarchy"]);
        ws.addRow(["Root", null, null, "C01", "def", "MedDRA:1:x", null, null, "C01"]);
      });
      const parsed = await parseImdrfWorkbook(buf);
      expect(parsed.rows[0]?.nonImdrfCode).toBe("MedDRA:1:x");
    });

    it("supports annexes with only a Level 1 column (shallow hierarchy)", async () => {
      const buf = await bufferOf((wb) => {
        const ws = wb.addWorksheet("B");
        for (let i = 0; i < 7; i++) ws.addRow([]);
        ws.addRow(["Level 1 Term", "Code", "Definition", "Non-IMDRF Code", "Status", "Status Description", "CodeHierarchy"]);
        ws.addRow(["Only level", "B01", "def", null, null, null, "B01"]);
      });
      const parsed = await parseImdrfWorkbook(buf);
      expect(parsed.rows).toHaveLength(1);
      expect(parsed.rows[0]?.code).toBe("B01");
    });

    it("captures Primary/Secondary Category only where the sheet has those columns", async () => {
      const buf = await bufferOf((wb) => {
        const ws = wb.addWorksheet("E");
        for (let i = 0; i < 7; i++) ws.addRow([]);
        ws.addRow(["Level 1 Term", "Level 2 Term", "Level 3 Term", "Code", "Definition", "Non-IMDRF Code", "Primary Category", "Secondary Category", "Status", "Status Description", "CodeHierarchy"]);
        ws.addRow(["Nervous System", null, null, "E01", "def", null, null, null, null, null, "E01"]);
      });
      const parsed = await parseImdrfWorkbook(buf);
      expect(parsed.rows[0]?.primaryCategory).toBeNull();
    });

    it("ignores sheets that are not one of A-G", async () => {
      const buf = await bufferOf((wb) => {
        wb.addWorksheet("Cover Page").addRow(["Not terminology data"]);
        addAnnexA(wb);
      });
      const parsed = await parseImdrfWorkbook(buf);
      expect(parsed.rows.every((r) => r.annex === "A")).toBe(true);
    });

    it("reports a precise sheet+row+field error for a missing header row instead of throwing", async () => {
      const buf = await bufferOf((wb) => {
        wb.addWorksheet("D").addRow(["not a header row"]);
      });
      const parsed = await parseImdrfWorkbook(buf);
      expect(parsed.issues.some((i) => i.severity === "error" && i.sheet === "D")).toBe(true);
    });

    it("records the release year found on each sheet for cross-checking against the import target", async () => {
      const buf = await bufferOf(addAnnexA);
      const parsed = await parseImdrfWorkbook(buf);
      expect(parsed.releaseYearsFound).toEqual(new Set([2026]));
    });
  });
  ```
- [ ] Run `pnpm test tests/unit/imdrf-parser.test.ts` — confirm it fails (module does not exist yet).
- [ ] Implement `parser.ts`:
  - Iterate `workbook.worksheets`; a sheet is a candidate annex sheet only if its trimmed `name` is one of `ANNEXES` **or** row 1's flattened text matches `/Annex Name:\s*Annex\s*([A-G])\b/i` — when both are present they must agree (mismatch → error naming the sheet); a sheet matching neither is silently skipped (it is not terminology data, e.g. a future cover sheet).
  - Flatten a cell value to plain text with a `plainText(value)` helper that joins `richText` runs and stringifies everything else, trimming and collapsing internal whitespace.
  - Detect the header row: scan rows 1..30 for the first row whose first cell's `plainText` is exactly `"Level 1 Term"`. Not found → push an `error` issue for that sheet (`field: null, row: null`) and skip the sheet (no rows emitted for it) rather than throwing.
  - Build a column map from the header row: for each header cell, normalize (`trim().toLowerCase().replace(/\s+/g, " ")`) and match:
    - `/^level (\d+) term$/` → level-term column, keyed by its number
    - `code` → code
    - `codehierarchy` → hierarchy
    - `definition` → definition
    - `/^non-imdrf code/` → nonImdrfCode
    - `status` (exact) → status
    - `status description` → statusDescription
    - `primary category` → primaryCategory
    - `secondary category` → secondaryCategory
  - `code` and `codehierarchy` are required columns; missing either → sheet-level error, skip the sheet.
  - From the row after the header to `worksheet.rowCount`: skip a row where every cell is blank. Otherwise build a `ParsedRow`: `term` = the plain text of whichever level-term column is non-blank (if zero or more than one are non-blank, still emit the row with `filledLevelColumns` set accordingly and `term` = the first non-blank one or `null` — the validator turns `filledLevelColumns !== 1` into a validation error with the exact row number, per "reports the exact sheet and row for validation failures"). `sourceOrder` is a 0-based counter incremented per emitted (non-blank) row within the sheet, independent of Excel row gaps.
  - Extract `releaseYearsFound`: for each sheet, scan rows 1-10 for a cell whose plain text matches `/release number:\s*(\d{4})/i`; add the captured year (as number) to the set.
  - Never throw for malformed data — every failure becomes a `ParseIssue`; only a thrown `ExcelJS` read error (corrupt file) propagates, which the caller (import-service) turns into a single top-level issue.
- [ ] Run the test file again — confirm all cases pass.
- [ ] Run `pnpm typecheck && pnpm lint`.
- [ ] Commit: `feat(imdrf): add robust IMDRF workbook parser`.

## Task 3: Validator (`server/src/domain/imdrf/validate.ts`)

**Files:**
- Create: `server/src/domain/imdrf/validate.ts`
- Test: `server/tests/unit/imdrf-validate.test.ts`

**Interfaces:**
- Consumes: `ParsedRow`, `ParseIssue`, `Annex`, `ANNEXES` from `./parser.js` / `./types.js`.
- Produces:
  ```ts
  export type ValidatedTerm = {
    id: string;              // crypto.randomUUID(), generated here so parent resolution needs no DB round trip
    annex: Annex;
    code: string;
    term: string;
    definition: string | null;
    nonImdrfCode: string | null;
    status: string | null;
    statusDescription: string | null;
    primaryCategory: string | null;
    secondaryCategory: string | null;
    codeHierarchy: string;
    parentTermId: string | null;
    level: number;
    sortOrder: number;
  };

  export type ValidationIssue = ParseIssue; // same shape, same reporting contract

  export type AnnexSummary = { annex: Annex; count: number };

  export type ValidationResult =
    | { ok: true; terms: ValidatedTerm[]; summary: AnnexSummary[]; total: number; issues: ValidationIssue[] /* warnings only */ }
    | { ok: false; issues: ValidationIssue[] };

  export function validateParsedWorkbook(
    parsed: ParsedWorkbook,
    expectedReleaseYear: number,
  ): ValidationResult;
  ```

- [ ] Write the failing test file covering (each as its own `it`, building `ParsedRow[]` fixtures directly rather than going through the parser — this is a unit test of validation logic alone):
  - variable-depth hierarchy `A`, `A|A01`, `A|A01|A0101`, `A|A01|A0101|A010101` → levels `1,2,3,4` (never assume max 3)
  - parent resolution: child's `parentTermId` equals the `id` generated for the row whose `code` is the hierarchy's second-to-last segment
  - root terms: single-segment hierarchy → `parentTermId === null`
  - duplicate `code` within one call → `ok: false` with an issue naming the annex/row/field
  - missing parent (hierarchy references a code never present in this workbook) → `ok: false`, issue says which code and which row
  - malformed hierarchy (final segment ≠ `code`) → `ok: false`
  - annex not in A-G → `ok: false`
  - release year mismatch (`parsed.releaseYearsFound` disagrees with `expectedReleaseYear`) → `ok: false`
  - retired terms are kept: a row with `status: "Retired (2020)"` produces a `ValidatedTerm`, not a dropped one
  - `filledLevelColumns !== 1` (0 or 2+) → `ok: false`, names the row
  - empty optional cells (`definition: ""`, `nonImdrfCode: null`) become `null` on the `ValidatedTerm`, not `""`
  - `sortOrder` on the output preserves `ParsedRow.sourceOrder` (source row ordering)
  - a fully valid multi-annex input returns `ok: true` with a correct `summary` (`{annex, count}` per annex) and `total` equal to the sum
- [ ] Run — confirm failing.
- [ ] Implement `validate.ts`:
  - First pass: structural checks per row (annex ∈ ANNEXES, code/term/codeHierarchy present, `filledLevelColumns === 1`, hierarchy's last segment === code) — collect all such issues before touching parents, so a workbook with 5 unrelated bad rows reports all 5, not just the first.
  - Cross-row check: validate uniqueness of `code` across the entire parsed set (the schema's uniqueness is `(releaseId, code)` alone, not per-annex).
  - Release year check: every entry in `parsed.releaseYearsFound` must equal `expectedReleaseYear`; a workbook with no year found at all is also an error (cannot silently default).
  - Build `codeToId: Map<string, string>` assigning `crypto.randomUUID()` per structurally-valid row (a row with a structural error gets no id and is excluded from the output entirely).
  - Resolve `parentTermId`: split `codeHierarchy` on `"|"`; if length is 1 → `null`; else look up `codeToId.get(segments[segments.length - 2])` (confirmed true in the real workbook that a hierarchy's middle segment is exactly the code of that ancestor row) — missing → validation error naming the row and the missing parent code.
  - `level = codeHierarchy.split("|").length`.
  - If any error-severity issue exists anywhere, return `{ ok: false, issues }` (all collected issues, not just the first) and build **no** `ValidatedTerm[]` — "failed validation performs zero database writes" starts here, one layer before the transaction.
  - Otherwise return `{ ok: true, terms, summary, total, issues (warnings only) }`.
- [ ] Run — confirm passing. `pnpm typecheck && pnpm lint`.
- [ ] Commit: `feat(imdrf): add release-scoped hierarchy validation`.

## Task 4: Import service (`server/src/domain/imdrf/import-service.ts`)

**Files:**
- Create: `server/src/domain/imdrf/import-service.ts`
- Test: `server/tests/unit/imdrf-import-service.test.ts` (pending-store only, no DB)

**Interfaces:**
- Consumes: `parseImdrfWorkbook` (Task 2), `validateParsedWorkbook`/`ValidatedTerm`/`ValidationResult` (Task 3), `Database` (`../../db/client.js`), `imdrfReleases`/`imdrfTerms` (schema).
- Produces:
  ```ts
  export type ImportPreview = {
    token: string;              // opaque, references the held buffer for the confirm step
    releaseYear: number;
    documentCode: string | null;
    title: string | null;
    sourceFileName: string;
    summary: AnnexSummary[];
    total: number;
    issues: ValidationIssue[];  // errors and warnings; import is only offered when there are no errors
    ok: boolean;
  };

  export async function previewImdrfImport(input: {
    buffer: Buffer;
    releaseYear: number;
    documentCode: string | null;
    title: string | null;
    sourceFileName: string;
  }): Promise<ImportPreview>;

  export type ImportOutcome =
    | { status: "imported"; releaseId: string; total: number }
    | { status: "invalid_token" }
    | { status: "already_published" }
    | { status: "validation_failed"; issues: ValidationIssue[] };

  export async function confirmImdrfImport(db: Database, token: string): Promise<ImportOutcome>;

  export type PublishOutcome = { status: "published" } | { status: "not_found" } | { status: "already_published" };
  export async function publishImdrfRelease(db: Database, releaseId: string): Promise<PublishOutcome>;
  ```

- [ ] Write the pending-store unit test: a token from `previewImdrfImport` resolves within its TTL and is single-use — exercised only through the public functions (no reaching into module internals from the test).
- [ ] Implement an in-memory `Map<string, { buffer, releaseYear, documentCode, title, sourceFileName, expiresAt }>` module-private store with a fixed TTL (15 minutes) and lazy eviction of expired entries on every call (no background timer). Token = `crypto.randomUUID()`. Documented limitation: single-process only, acceptable for this deployment (one app instance per [[ae-reports-locked-architecture]]).
- [ ] `previewImdrfImport`: `parseImdrfWorkbook` → `validateParsedWorkbook(parsed, releaseYear)`. Only store the buffer/metadata under a token when `ok` (a failed preview is never confirmable, so nothing needs to be held for it). Build `summary`/`total`/`issues` from the validation result either way.
- [ ] `confirmImdrfImport(db, token)`:
  - Look up and delete the token (single-use) → `invalid_token` if missing/expired.
  - Re-run `parseImdrfWorkbook` + `validateParsedWorkbook` on the held buffer inside this function (never trust that nothing changed between preview and confirm) → `validation_failed` if it now fails.
  - `db.transaction(async (tx) => { ... })`:
    - Look up any existing release for that year.
    - Existing and `status === "published"` → return `already_published` (no writes).
    - Existing and `status === "draft"`: delete its terms, then update its metadata columns.
    - Not existing: insert a new `draft` release row.
    - Bulk-insert `ValidatedTerm[]` into `imdrf_terms` via `tx.insert(imdrfTerms).values(chunk)` in chunks of 500 — every row already carries its own `id` and pre-resolved `parentTermId`, so this is pure insert with **zero per-row SELECTs**.
    - Return `{ status: "imported", releaseId, total }`.
- [ ] `publishImdrfRelease(db, releaseId)`: single `UPDATE ... WHERE id = $1 AND status = 'draft' RETURNING id`; zero rows and it exists-but-published → `already_published`; zero rows and it doesn't exist → `not_found`; one row → `published`.
- [ ] `pnpm typecheck && pnpm lint`, run the new unit test.
- [ ] Commit: `feat(imdrf): add transactional import/publish service with preview token`.

## Task 5: Read-only query service (`server/src/domain/imdrf/query-service.ts`)

**Files:**
- Create: `server/src/domain/imdrf/query-service.ts`
- Test: `server/tests/unit/imdrf-query-service.test.ts` (pure cursor helper only, no DB)

**Interfaces:**
- Produces:
  ```ts
  export type ReleaseSummary = { id: string; releaseYear: number; documentCode: string | null; title: string | null; status: "draft" | "published"; publishedAt: Date | null };
  export type TermRow = { id: string; annex: Annex; code: string; term: string; level: number; hasChildren: boolean };
  export type TermDetail = ValidatedTerm & { id: string; hasChildren: boolean };

  export async function listPublishedReleases(db: Database): Promise<ReleaseSummary[]>;
  export async function listAllReleases(db: Database): Promise<ReleaseSummary[]>; // admin only, caller enforces the role
  export async function getRelease(db: Database, releaseId: string): Promise<ReleaseSummary | null>;
  export async function annexSummary(db: Database, releaseId: string): Promise<AnnexSummary[]>;
  export async function listTerms(db: Database, opts: { releaseId: string; annex?: Annex; parentId: string | null; limit: number; cursor?: string }): Promise<{ rows: TermRow[]; nextCursor: string | null }>;
  export async function searchTerms(db: Database, opts: { releaseId: string; query: string; limit: number; cursor?: string }): Promise<{ rows: TermRow[]; nextCursor: string | null }>;
  export async function getTerm(db: Database, releaseId: string, termId: string): Promise<TermDetail | null>;
  ```

- [ ] Write a unit test for the pure helper this task adds, `parseCursor`/`encodeCursor` (opaque pagination cursor): round-trips correctly and treats a malformed/tampered cursor as "start from the beginning" rather than throwing.
- [ ] Implement each function with parameterized `sql` template queries (`app.db.execute(sql\`...\`)`), matching the project's established raw-SQL style:
  - `listTerms` with `parentId: null` means "top-level of this annex" → requires `annex`, `WHERE release_id = $1 AND annex = $2 AND parent_term_id IS NULL ORDER BY sort_order LIMIT $3`; `parentId` non-null → `WHERE release_id = $1 AND parent_term_id = $2 ORDER BY sort_order LIMIT $3` (annex is implied by the parent).
  - `hasChildren` computed via `EXISTS (SELECT 1 FROM imdrf_terms c WHERE c.parent_term_id = t.id)` in the same query — no N+1 per row.
  - `searchTerms`: `WHERE release_id = $1 AND (code ILIKE $2 OR term ILIKE $2 OR definition ILIKE $2) ORDER BY sort_order LIMIT $3`, with `%`/`_`/`\` escaped in the user-typed input before building the LIKE pattern (`ESCAPE '\\'`).
  - `annexSummary`: one `SELECT annex, count(*) FROM imdrf_terms WHERE release_id = $1 GROUP BY annex` query.
  - All `limit` values clamped server-side to a max (e.g. 200) regardless of what the caller passes.
- [ ] `pnpm typecheck && pnpm lint`.
- [ ] Commit: `feat(imdrf): add paginated read-only query service`.

## Task 6: Admin routes + views

**Files:**
- Create: `server/src/doors/staff/views/imdrf-admin.tsx`
- Create: `server/src/doors/staff/routes/imdrf-admin.tsx`
- Modify: `server/src/doors/staff/index.ts` (register inside the existing `administration` scope, beside `usersRoutes`/`activityRoutes`)
- Test: part of Task 8's integration suite

**Interfaces:**
- Consumes: `previewImdrfImport`, `confirmImdrfImport`, `publishImdrfRelease` (Task 4), `listAllReleases`, `getRelease`, `annexSummary` (Task 5), `currentSession` (`../session-guard.js`).

- [ ] `ImdrfAdminPage` view: release tabs (`listAllReleases`, admin sees drafts too) + selected release's `annexSummary` table + status badge + "Publish" button (draft only) + upload form (`enctype="multipart/form-data"`, fields: file input, `release_year` number input). Mirrors `UsersPage`'s structure (`StaffShell`, `.staff-head`, `.tscroll`/`.utable`).
- [ ] `ImdrfImportPreviewPage` view: shows `ImportPreview` (per-annex counts, total, issues list with sheet/row/field/message columns) and, only when `ok`, a confirm form posting the `token`; always a "Cancel" link back to `/imdrf`.
- [ ] Routes (`imdrfAdminRoutes`):
  - `GET /imdrf` — `renderImdrfAdmin` (list + selected release, `?release=<uuid>` query selects which tab, defaults to the newest).
  - `POST /imdrf/upload` — parse multipart via `request.file()` (`@fastify/multipart` is already registered globally in `server.ts`, so no re-registration is needed here — see `src/forms/submission.ts` for this repo's existing consumption pattern of `request.parts()`/fields alongside a file). Zod-validate `release_year` as `z.coerce.number().int().min(2000).max(2100)`, buffer the file (`await file.toBuffer()`), call `previewImdrfImport`, render `ImdrfImportPreviewPage`. Reject a non-`.xlsx` filename/mimetype before parsing with a clear 422 message (defense in depth beyond the parser's own error reporting).
  - `POST /imdrf/import` — body has `token`; call `confirmImdrfImport`; on `imported` redirect to `/imdrf?release=<id>` (303); on `invalid_token`/`validation_failed`/`already_published` re-render the admin list with an error banner (reuse `renderUsers`'s error-over-list pattern).
  - `POST /imdrf/:releaseId/publish` — `TargetId` (`z.uuid()`) parse, call `publishImdrfRelease`, redirect to `/imdrf?release=:releaseId` (303) or re-render with an error for `not_found`/`already_published`.
- [ ] Register in `server/src/doors/staff/index.ts`: inside the existing `administration` scope (`requireRole(administration, ["administrator"])`), add `await administration.register(imdrfAdminRoutes);` beside `usersRoutes`/`activityRoutes`.
- [ ] `pnpm typecheck && pnpm lint`.
- [ ] Commit: `feat(imdrf): add admin upload/preview/confirm/publish UI`.

## Task 7: Read-only sidebar/browser routes + views

**Files:**
- Create: `server/src/doors/staff/views/imdrf.tsx`
- Create: `server/src/doors/staff/routes/imdrf.tsx`
- Modify: `server/src/doors/staff/index.ts` (register in the `active` scope — every signed-in role, same level as `reportsRoutes`)
- Modify: `server/src/doors/staff/views/shell.tsx` (new rail icon + entry `"IMDRF Terminology"`, `active: "imdrf"`, shown for every role since it is a reference tool, not vigilance data)

**Interfaces:**
- Consumes: `listPublishedReleases`, `annexSummary`, `listTerms`, `searchTerms`, `getTerm` (Task 5).

- [ ] `ImdrfBrowserPage` view: release-year tabs (`listPublishedReleases` only — drafts never reach a non-admin reader), annex list with counts (`annexSummary`), a search input, an empty results/tree panel, and a small inline `<script>` that:
  - debounces search input (≈300ms) and calls `GET /imdrf/releases/:releaseId/search?q=...`, rendering the returned JSON into the results panel via plain DOM calls (consistent with "zero client React" — this is the one small script on the page, the same opt-in pattern `f4Find`/`railScript` already use).
  - on annex click, `GET /imdrf/releases/:releaseId/terms?annex=A&parentId=` (empty `parentId` = top level) and renders the returned rows as an expandable list; expanding a row with `hasChildren` fetches `.../terms?parentId=<id>` on demand.
  - on row click, `GET /imdrf/releases/:releaseId/terms/:id` and renders `TermDetail` into a detail panel.
- [ ] Routes (`imdrfBrowserRoutes`), all read-only, all release-scoped by a required `:releaseId` path param that must belong to a **published** release (a non-admin requesting a draft's id gets 404, never the data):
  - `GET /imdrf` — the full page, `listPublishedReleases`, defaulting to the newest by `releaseYear`.
  - `GET /imdrf/releases/:releaseId/annexes` — JSON: `annexSummary` result, after checking the release is published.
  - `GET /imdrf/releases/:releaseId/terms` — JSON: `listTerms` (query: `annex?`, `parentId?`, `cursor?`), `limit` fixed server-side (e.g. 50).
  - `GET /imdrf/releases/:releaseId/terms/:id` — JSON: `getTerm`.
  - `GET /imdrf/releases/:releaseId/search` — JSON: `searchTerms` (query: `q`, `cursor?`), `limit` fixed server-side (e.g. 25); empty/whitespace `q` → `{ rows: [], nextCursor: null }` without querying the database.
  - A small shared `requirePublishedRelease(db, releaseId)` helper (used by every handler above) that 404s when the release doesn't exist or isn't published — this is what makes "drafts are not exposed to normal read-only consumers" a property of one function rather than five repeated checks.
- [ ] Register in `server/src/doors/staff/index.ts`: `await active.register(imdrfBrowserRoutes);` at the same nesting level as `reportsRoutes` (every signed-in, password-changed role — manager, assessor, administrator all read; only the `administration` scope's routes from Task 6 write).
- [ ] Add the rail entry in `shell.tsx`: a new `IconImdrf` (simple stroke icon, same style as the others) and an `<a href="/imdrf" ...>` shown for every role (no `isOfficer`/`isManager`/`isAdministrator` gate), matching "Dashboard"'s ungated placement.
- [ ] `pnpm typecheck && pnpm lint`.
- [ ] Commit: `feat(imdrf): add read-only terminology sidebar for all staff roles`.

## Task 8: Integration tests

**Files:**
- Create: `server/tests/integration/staff-imdrf-admin.test.ts`
- Create: `server/tests/integration/staff-imdrf-readonly.test.ts`

Follow the existing integration suite's shape exactly: `openOwner()`/`openApp()` from `helpers.ts`, `truncateAll` in `beforeEach`, seed via the owner connection, exercise routes via whatever request-injection helper `staff-users.test.ts`/`staff-admin-tools.test.ts` already use (read one of those first — do not invent a different harness).

- [ ] `staff-imdrf-admin.test.ts` covers:
  1. Uploading a valid small in-memory workbook (build with `ExcelJS.Workbook()`, same fixture style as Task 2) as an administrator returns a preview with correct per-annex counts and no errors.
  2. Confirming that preview creates a `draft` release with all terms, correct `level`/`parentTermId`/`sortOrder`.
  3. A second release year (e.g. 2027) can be imported without touching the 2026 rows — both coexist.
  4. Re-importing the same still-draft release replaces its terms (old codes gone, new ones present) without creating a duplicate `imdrf_releases` row for that year.
  5. Publishing a release sets `status='published'`, `published_at` non-null; publishing an already-published release is refused.
  6. Importing over an already-published release is refused and the published rows are unchanged (row-count and content assertions before/after).
  7. A workbook with a duplicate code, a missing parent, or a mismatched hierarchy tail is rejected at preview with zero rows written for that release year.
  8. A manager or assessor hitting any `/imdrf/*` admin route gets 403 (same contract already proven by `staff-users.test.ts`).
- [ ] `staff-imdrf-readonly.test.ts` covers:
  1. A published release's terms are visible to manager, assessor, and administrator alike.
  2. A draft release is invisible to the read-only routes for every role (404 on its `:releaseId`, absent from `GET /imdrf`'s release list).
  3. Switching `:releaseId` between two published releases returns disjoint term sets.
  4. `GET .../terms?annex=A&parentId=` returns only root terms of that annex; a child's id from that response, passed as `parentId`, returns exactly its children.
  5. A hierarchy deeper than 3 levels (seed one directly via the owner connection with a 4-segment `code_hierarchy`) is retrievable and its `level` is 4 — the query layer makes no depth-3 assumption.
  6. `search?q=...` only matches within the given `releaseId` (seed the same code text differently in two releases, confirm no cross-release match).
  7. A retired term (`status: 'Retired (2020)'`) still appears in both browse and search results.
  8. Empty/blank `q` returns an empty result set without error.
  9. `limit`/pagination: seed more rows than one page, confirm `nextCursor` is non-null and following it returns the remainder with no overlap or gaps.
- [ ] `pnpm test:integration` — all green.
- [ ] Commit: `test(imdrf): add admin and read-only integration coverage`.

## Task 9: Documentation

**Files:**
- Create: `docs/imdrf-terminology.md`

- [ ] Write a concise doc (headings: Why separate, Release model, Term model & hierarchy, Variable depth, Import process & transaction safety, Validation rules, Admin permissions, Adding a future release, What Phase 2 (sidebar) consumes, What Phase 3 (F004 §3) will eventually connect) — one short paragraph each, cross-referencing the actual files from this plan rather than restating code.
- [ ] Commit: `docs(imdrf): document the terminology subsystem`.

## Task 10: Final verification

- [ ] `pnpm typecheck`
- [ ] `pnpm test` and `pnpm test:integration` (full suite, not just the new files — confirm nothing in reports/assessments/register/F004 regressed)
- [ ] `pnpm lint` — note per [[lint-crlf-preexisting]] that ~14 pre-existing files fail on CRLF at clean HEAD; confirm no *new* files added by this plan are in that failing set, rather than expecting a fully clean run.
- [ ] Manually exercise in a browser/dev server: upload the real 2026 workbook as an administrator, confirm the preview's per-annex counts match the inspected totals (A 491, B 34, C 160, D 45, E 1014, F 82, G 307 — total 2,133), publish it, then open `/imdrf` as a manager and assessor account and browse/search/expand a deep (level-3) term.
- [ ] Report per the user's requested final-report format (tables created, migration, admin API, admin UI, import service, parser, validation rules, tests, per-annex counts, total imported, files changed, files deliberately not changed, workbook issues found, assumptions made).
