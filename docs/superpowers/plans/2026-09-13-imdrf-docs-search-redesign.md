# IMDRF documentation-app navigation + indexed fuzzy search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Source of truth:** `docs/superpowers/plans/2026-09-13-imdrf-docs-search-redesign-requirements.md`
> (authored directly by the user) is the authoritative requirements/acceptance-criteria
> document for this feature. This file is the task-by-task execution of it — amended to
> include an Overview landing mode (§9), `.imdrf-docs-*`/`.imdrf-term-*` CSS naming
> (§35), stale-request-safe search (§29), tiered short-query scoring (§25), a
> collapsible mobile nav menu (§32), a migration-privilege check (§38), and a
> real-dataset verification task (§45). If anything here still contradicts that
> document, the requirements document wins.

**Goal:** Replace the IMDRF terminology door's two-pane tree/detail browser with a
documentation-app-style layout (annex sidebar, breadcrumbs, deep-linkable term anchors),
and replace its plain `ILIKE` search with a ranked, typo-tolerant hybrid of PostgreSQL
full-text search and trigram similarity.

**Architecture:** Two additive, independent changes to the read-only `/imdrf` staff
door. Search: one new migration (generated `tsvector` column + GIN indexes, `pg_trgm`
extension) and a rewritten `searchTerms` in `domain/imdrf/query-service.ts` with its own
relevance-ranked pagination cursor. Navigation: `listTerms` drops its tree/`parentId`
branch and becomes a flat per-annex query; `views/imdrf.tsx` and
`public/imdrf-browser.js` are rewritten around a sidebar + breadcrumb + reading-pane
layout with `id="term-<uuid>"` anchors. `getTerm` / `GET .../terms/:id` are kept
unchanged throughout.

**Tech Stack:** Fastify, server-rendered TSX (no client React), Drizzle
(`db.execute(sql\`...\`)` tagged templates, no ORM query builder for these reads),
PostgreSQL (`pg_trgm`, native full-text search — no new infrastructure), vanilla JS for
the one opt-in client script this door already uses.

## Global Constraints

- No client-side dataset download: every list/search call is server-paged; an empty
  search query returns zero rows without querying the index.
- `listTerms`'s browse cursor stays `(sort_order, id)`, completely unchanged in shape,
  SQL, or semantics. Search gets its own, separate `SearchCursor` type.
- `GET /imdrf/releases/:releaseId/terms/:id` and `getTerm` are **kept, unchanged** —
  not deleted, not modified.
- Term anchors are keyed by the term's own UUID (`id="term-<uuid>"`), never by `code`
  alone — `code` legitimately repeats across hierarchy positions within one annex
  (Annex E cross-lists ~200 terms this way; see migration `0020`).
- No external search infrastructure (Elasticsearch, Meilisearch, Algolia, Redis).
- Release isolation (`WHERE release_id = ...` first) is preserved in every query touched.
- No inline styles anywhere in rendered HTML (`style-src 'self'`).
- Every SQL query goes through `db.execute<RowType>(sql\`...\`)`, matching this file's
  existing convention — no drizzle-orm query builder calls added here.
- Out of scope, do not touch: `imdrf-admin.tsx`/`import-service.ts`/`validate.ts`/
  `parser.ts` (admin import/staging pipeline), multi-release `.wl-tabs` switching,
  status/MedDRA/retired-term sidebar filters.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/drizzle/0023_imdrf_terms_search.sql` | New migration: `pg_trgm` extension, generated `search_vector` column, three GIN indexes. Additive only. |
| `server/drizzle/meta/_journal.json` | New journal entry for migration `0023`. |
| `server/src/db/schema/index.ts` | Add `imdrfTerms.searchVector` (generated tsvector column) + its GIN index + two trigram GIN indexes, so drizzle-kit's schema model matches the hand-written migration. |
| `server/src/domain/imdrf/query-service.ts` | `TermRow` grows; `listTerms` drops its `parentId` branch and becomes flat; `searchTerms` rewritten with hybrid FTS+trigram ranking; new `SearchCursor` type + `encodeSearchCursor`/`decodeSearchCursor`. `getTerm`/`Cursor`/`encodeCursor`/`decodeCursor` untouched. |
| `server/src/doors/staff/routes/imdrf.tsx` | `/terms` route drops its `parentId` query-param branch (annex always required). `/terms/:id` route untouched. |
| `server/src/doors/staff/views/imdrf.tsx` | New sidebar + breadcrumb + reading-pane layout; server-renders the first page of the selected annex or search results directly from `annex`/`q`/`term` query params. |
| `server/public/imdrf-browser.js` | Rewritten: infinite scroll (two independent cursors), search-vs-browse toggle, `term=<uuid>` deep-link resolution and anchor scroll. |
| `server/public/app.css` | Old `.imdrf-reader`/`.imdrf-toc`/`.imdrf-doc` block (lines 3249–3577) replaced with the new layout's styles. `.imdrf-admin*` (admin door, line 3579+) untouched. |
| `server/tests/unit/imdrf-query-service.test.ts` | Add `SearchCursor` encode/decode tests. |
| `server/tests/integration/staff-imdrf-readonly.test.ts` | Remove tree/`parentId`-listing tests; add flat-listing, anchor-id, and search-ranking tests. `getTerm` tests kept as-is. |
| `server/tests/integration/imdrf-query-pagination.test.ts` | Replace root-vs-children pagination cases with flat-per-annex cases; add a search-cursor pagination case. |

---

### Task 1: Migration + schema for hybrid search

**Files:**
- Create: `server/drizzle/0023_imdrf_terms_search.sql`
- Modify: `server/drizzle/meta/_journal.json`
- Modify: `server/src/db/schema/index.ts:517-567` (the `imdrfTerms` table definition)
- Test: `server/tests/integration/imdrf-search-vector.test.ts` (new)

**Interfaces:**
- Produces: a `search_vector tsvector` column on `imdrf_terms` (generated, always
  populated), plus GIN indexes `imdrf_terms_search_vector_idx`,
  `imdrf_terms_code_trgm_idx`, `imdrf_terms_term_trgm_idx`,
  `imdrf_terms_definition_trgm_idx`. Task 3 (`searchTerms`) depends on all four being
  usable as index-backed *candidate-retrieval* predicates (`@@`, `%`, `<%`), not merely
  as inputs to `ts_rank()`/`similarity()`/`word_similarity()` computed over a full scan
  — a GIN index only helps a query that filters through the operator it indexes.

- [ ] **Step 0: Verify the migration role can create extensions before assuming it**

`CREATE EXTENSION` needs a privileged role — do not assume this repo's migration role
has it just because earlier migrations here only ran `CREATE TABLE`/`ALTER TABLE`.
Check how migrations are actually run in this deployment: inspect
`server/drizzle.config.ts` and whatever connection string/role `db:migrate` uses (see
`.env`/`.env.example` for `DATABASE_URL` — is it a superuser/owner role, or a narrower
one?), then either:
- confirm that role already has `CREATE EXTENSION` rights (owning a database in
  PostgreSQL, RDS, Supabase, Neon, etc. usually does), or
- if it doesn't, `pg_trgm` must be enabled once, out-of-band, by whoever administers
  the actual database (a platform superuser/admin console action) *before* this
  migration runs — note that requirement to the user rather than silently failing
  partway through a migration run.

Do not proceed to Step 1 until this is confirmed one way or the other.

- [ ] **Step 1: Write the migration SQL**

Create `server/drizzle/0023_imdrf_terms_search.sql`:

```sql
-- Adds ranked, typo-tolerant search to imdrf_terms: PostgreSQL full-text search
-- (tsvector) for word/prefix matching, plus pg_trgm for fuzzy/typo tolerance. The query
-- service (domain/imdrf/query-service.ts, searchTerms) combines both into one relevance
-- score. See docs/superpowers/specs/2026-09-13-imdrf-docs-search-redesign-design.md for
-- the full rationale. Purely additive: no existing column, row, or grant changes.

CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "imdrf_terms" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("term", '') || ' ' || coalesce("definition", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce("code", '') || ' ' || coalesce("non_imdrf_code", '')), 'B')
) STORED;--> statement-breakpoint
CREATE INDEX "imdrf_terms_search_vector_idx" ON "imdrf_terms" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "imdrf_terms_code_trgm_idx" ON "imdrf_terms" USING gin ("code" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "imdrf_terms_term_trgm_idx" ON "imdrf_terms" USING gin ("term" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "imdrf_terms_definition_trgm_idx" ON "imdrf_terms" USING gin ("definition" gin_trgm_ops);
```

Four indexes, not three: `search_vector` backs the `@@` full-text predicate;
`code`/`term`/`definition` trigram indexes each back both the `%` (similarity) and
`<%`/`%>` (word_similarity) operators — pg_trgm's GIN opclass supports all three,
which is what lets `searchTerms` (Task 3) filter candidate rows through an index
*before* ranking, rather than computing similarity for every row in the release.

- [ ] **Step 2: Add the journal entry**

Open `server/drizzle/meta/_journal.json`. The last entry is:

```json
    {
      "idx": 22,
      "version": "7",
      "when": 1788704959000,
      "tag": "0022_imdrf_import_staging_grants",
      "breakpoints": true
    }
```

Add a new entry immediately after it, inside the same `entries` array, with a `when`
value **greater than** `1788704959000` (the drizzle journal trap: a `when` that isn't
strictly increasing causes this migration to be silently skipped):

```json
    {
      "idx": 22,
      "version": "7",
      "when": 1788704959000,
      "tag": "0022_imdrf_import_staging_grants",
      "breakpoints": true
    },
    {
      "idx": 23,
      "version": "7",
      "when": 1788791359000,
      "tag": "0023_imdrf_terms_search",
      "breakpoints": true
    }
```

- [ ] **Step 3: Update the Drizzle schema to match**

In `server/src/db/schema/index.ts`, immediately before `export const imdrfTerms = pgTable(`
(currently line 517), add a custom `tsvector` type (following the existing `bytea`
`customType` pattern used later in this same file for `imdrfImportStaging`):

```ts
/** Postgres's own full-text-search value type. Always generated, never written directly. */
const tsvectorType = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

```

Then, inside the `imdrfTerms` column list, add the generated column right after
`secondaryCategory: text("secondary_category"),` (currently line 538):

```ts
    secondaryCategory: text("secondary_category"),
    /** Generated by Postgres from term/definition (weight A) and code/non-IMDRF code (weight B).
     *  Never written by the importer — see migration 0023 for the exact expression. Powers
     *  `searchTerms`'s full-text-search signal; `similarity()`/`word_similarity()` against the raw
     *  `code`/`term`/`definition` columns supply the fuzzy/typo-tolerant signal alongside it. */
    searchVector: tsvectorType("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(term, '') || ' ' || coalesce(definition, '')), 'A') || setweight(to_tsvector('simple', coalesce(code, '') || ' ' || coalesce(non_imdrf_code, '')), 'B')`,
    ),
```

And inside the `(t) => [...]` index array (currently lines 549–566), add three more
entries right after `index("imdrf_terms_release_level_idx").on(t.releaseId, t.level),`:

```ts
    index("imdrf_terms_release_level_idx").on(t.releaseId, t.level),
    // GIN index over the generated tsvector, so a future `@@` full-text lookup has index support.
    index("imdrf_terms_search_vector_idx").using("gin", t.searchVector),
    // Trigram GIN indexes on all three fuzzy-search columns: `searchTerms` (Task 3) filters
    // through the `%`/`<%` operators these back *before* ranking, so the index is actually used
    // for candidate retrieval, not just consulted informally.
    index("imdrf_terms_code_trgm_idx").using("gin", sql`${t.code} gin_trgm_ops`),
    index("imdrf_terms_term_trgm_idx").using("gin", sql`${t.term} gin_trgm_ops`),
    index("imdrf_terms_definition_trgm_idx").using("gin", sql`${t.definition} gin_trgm_ops`),
    check("imdrf_terms_annex_ck", sql`annex IN ('A','B','C','D','E','F','G')`),
```

(`check(...)` stays last, exactly where it already is — only the three `index(...)`
lines above it are new.)

- [ ] **Step 4: Write a failing integration test proving the column exists and populates**

Create `server/tests/integration/imdrf-search-vector.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.js";
import { INTEGRATION_ENABLED, openOwner, truncateAll } from "./helpers.js";

let owner: DatabaseHandle;

afterAll(async () => {
  await owner?.close();
});

describe.skipIf(!INTEGRATION_ENABLED)("imdrf_terms.search_vector", () => {
  beforeEach(async () => {
    owner ??= openOwner();
    await truncateAll(owner.db);
  });

  it("is generated automatically from term, definition, code and non_imdrf_code", async () => {
    const releaseRows = await owner.db.execute(sql`
      INSERT INTO imdrf_releases (release_year, source_file_name, status, published_at)
      VALUES (2026, 'seed.xlsx', 'published', now())
      RETURNING id
    `);
    const releaseId = (releaseRows[0] as { id: string }).id;

    await owner.db.execute(sql`
      INSERT INTO imdrf_terms (release_id, annex, code, term, code_hierarchy, level, sort_order, definition)
      VALUES (${releaseId}, 'G', 'G02002', 'Battery', 'G02|G02002', 2, 0, 'A power cell for a device.')
    `);

    const rows = await owner.db.execute<{ has_battery: boolean; has_power: boolean }>(sql`
      SELECT
        search_vector @@ to_tsquery('english', 'battery') AS has_battery,
        search_vector @@ to_tsquery('english', 'power') AS has_power
      FROM imdrf_terms
      WHERE release_id = ${releaseId}
    `);

    expect(rows[0]?.has_battery).toBe(true);
    expect(rows[0]?.has_power).toBe(true);
  });

  it("pg_trgm similarity() is usable against code and term", async () => {
    const releaseRows = await owner.db.execute(sql`
      INSERT INTO imdrf_releases (release_year, source_file_name, status, published_at)
      VALUES (2026, 'seed.xlsx', 'published', now())
      RETURNING id
    `);
    const releaseId = (releaseRows[0] as { id: string }).id;

    await owner.db.execute(sql`
      INSERT INTO imdrf_terms (release_id, annex, code, term, code_hierarchy, level, sort_order)
      VALUES (${releaseId}, 'G', 'G02002', 'Battery', 'G02|G02002', 2, 0)
    `);

    const rows = await owner.db.execute<{ sim: number }>(sql`
      SELECT similarity(term, 'batery') AS sim FROM imdrf_terms WHERE release_id = ${releaseId}
    `);

    expect(Number(rows[0]?.sim)).toBeGreaterThan(0.3);
  });
});
```

- [ ] **Step 5: Run the migration and the test**

Run: `pnpm --dir server db:migrate` (this repo's `package.json` script name for
`drizzle-kit migrate`), then:

Run: `pnpm --dir server test:integration -- tests/integration/imdrf-search-vector.test.ts`
Expected: both tests PASS. If `INTEGRATION_ENABLED` is false in this environment, the
suite reports skipped, not failed — confirm the test DB env var this repo's other
integration tests rely on (`requireTestDatabase`/`INTEGRATION_ENABLED` in
`tests/integration/helpers.ts`) is set before treating a skip as a pass.

- [ ] **Step 6: Typecheck**

Run: `pnpm --dir server typecheck` (or `tsc --noEmit`, matching this repo's existing
script name)
Expected: no new errors from `schema/index.ts`.

- [ ] **Step 7: Commit**

```bash
git add server/drizzle/0023_imdrf_terms_search.sql server/drizzle/meta/_journal.json server/src/db/schema/index.ts server/tests/integration/imdrf-search-vector.test.ts
git commit -m "feat(imdrf): add generated search_vector column and trigram indexes"
```

---

### Task 2: `SearchCursor` — encode/decode with fixed-precision score

**Files:**
- Modify: `server/src/domain/imdrf/query-service.ts` (add near the existing `Cursor`/
  `encodeCursor`/`decodeCursor`, currently lines 47–82 — leave those three completely
  untouched, add new code alongside)
- Test: `server/tests/unit/imdrf-query-service.test.ts`

**Interfaces:**
- Produces: `export type SearchCursor = { score: number; id: string }`,
  `export function encodeSearchCursor(cursor: SearchCursor): string`,
  `export function decodeSearchCursor(value: string | undefined): SearchCursor | null`,
  and `export function roundScore(score: number): number` (rounds to 6 decimal places —
  Task 3's SQL uses the SQL-side equivalent `round(x::numeric, 6)`; this JS-side helper
  exists so a re-encoded cursor and a freshly-computed score are compared using the
  exact same precision rule, per the spec's determinism requirement).
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing tests**

Add to `server/tests/unit/imdrf-query-service.test.ts` (below the existing
`describe("imdrf query-service cursor helpers", ...)` block, as a sibling `describe`):

```ts
import {
  decodeSearchCursor,
  encodeSearchCursor,
  roundScore,
} from "../../src/domain/imdrf/query-service.js";

describe("imdrf query-service search cursor helpers", () => {
  it("round-trips a {score, id} cursor through encode/decode", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect(decodeSearchCursor(encodeSearchCursor({ score: 0.482913, id }))).toEqual({
      score: 0.482913,
      id,
    });
    expect(decodeSearchCursor(encodeSearchCursor({ score: 0, id }))).toEqual({
      score: 0,
      id,
    });
  });

  it("treats a missing, malformed or tampered cursor as the start", () => {
    expect(decodeSearchCursor(undefined)).toBeNull();
    expect(decodeSearchCursor("not-a-real-cursor")).toBeNull();
    expect(decodeSearchCursor(Buffer.from("not json", "utf8").toString("base64url"))).toBeNull();
  });

  it("rejects a decoded value missing score or id, or with a non-finite score", () => {
    expect(
      decodeSearchCursor(Buffer.from(JSON.stringify({ id: "x" }), "utf8").toString("base64url")),
    ).toBeNull();
    expect(
      decodeSearchCursor(
        Buffer.from(JSON.stringify({ score: 0.5 }), "utf8").toString("base64url"),
      ),
    ).toBeNull();
    expect(
      decodeSearchCursor(
        Buffer.from(JSON.stringify({ score: "0.5", id: "x" }), "utf8").toString("base64url"),
      ),
    ).toBeNull();
    expect(
      decodeSearchCursor(
        Buffer.from(JSON.stringify({ score: Number.NaN, id: "x" }), "utf8").toString("base64url"),
      ),
    ).toBeNull();
  });

  it("roundScore rounds to 6 decimal places, matching the SQL-side round(x::numeric, 6)", () => {
    expect(roundScore(0.1234565)).toBe(0.123457);
    expect(roundScore(0.1234564)).toBe(0.123456);
    expect(roundScore(1)).toBe(1);
    expect(roundScore(0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --dir server vitest run tests/unit/imdrf-query-service.test.ts`
Expected: FAIL — `encodeSearchCursor`/`decodeSearchCursor`/`roundScore` are not exported.

- [ ] **Step 3: Implement**

In `server/src/domain/imdrf/query-service.ts`, immediately after the existing
`decodeCursor` function (currently ending at line 82, right before `type ReleaseRow`),
add:

```ts
export type SearchCursor = { score: number; id: string };

/**
 * Rounds a relevance score to 6 decimal places — the same precision the search query's
 * SQL applies via `round(score::numeric, 6)`. Both sides of a search-cursor comparison
 * (the cursor a client hands back, and the score a fresh query recomputes for the same
 * row) must use this identical rule, or float round-tripping through JSON could make two
 * numerically-equal scores compare as different, causing a page to overlap or skip rows.
 */
export function roundScore(score: number): number {
  return Math.round(score * 1_000_000) / 1_000_000;
}

/** Same opaque base64url pattern as {@link encodeCursor}, over a `(score, id)` tuple instead of
 *  `(sort_order, id)` — relevance-ranked search results aren't in document order, so they need
 *  their own total order to page over. */
export function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify({ score: roundScore(cursor.score), id: cursor.id }), "utf8").toString(
    "base64url",
  );
}

export function decodeSearchCursor(value: string | undefined): SearchCursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "score" in decoded &&
      "id" in decoded &&
      typeof (decoded as { score: unknown }).score === "number" &&
      Number.isFinite((decoded as { score: unknown }).score) &&
      typeof (decoded as { id: unknown }).id === "string"
    ) {
      return decoded as SearchCursor;
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --dir server vitest run tests/unit/imdrf-query-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/domain/imdrf/query-service.ts server/tests/unit/imdrf-query-service.test.ts
git commit -m "feat(imdrf): add SearchCursor with fixed-precision score rounding"
```

---

### Task 3: Rewrite `searchTerms` with hybrid FTS + trigram ranking

**Files:**
- Modify: `server/src/domain/imdrf/query-service.ts` (the `TermRow` type at lines
  28–35, the `TermQueryRow`/`termRowOf` at lines 157–179, and `searchTerms` at lines
  242–284 — `likePattern` is deleted, `searchTerms` is fully replaced; everything else
  in this file — `Cursor`, `encodeCursor`, `decodeCursor`, `listPublishedReleases`,
  `listAllReleases`, `getRelease`, `isReleasePublished`, `annexSummary`, `getTerm`, the
  new `SearchCursor` helpers from Task 2 — is untouched)
- Test: `server/tests/integration/staff-imdrf-readonly.test.ts` (new ranking cases,
  appended — do not touch the existing tests in this file yet, that's Task 9)

**Interfaces:**
- Consumes: `SearchCursor`, `encodeSearchCursor`, `decodeSearchCursor` from Task 2.
- Produces: the new `TermRow` shape (below), consumed by Task 4 (`listTerms`), Task 5
  (routes), Task 6 (view), and Task 7 (`imdrf-browser.js`).

```ts
export type TermRow = {
  id: string;
  annex: Annex;
  code: string;
  term: string;
  level: number;
  definition: string | null;
  codeHierarchy: string;
  status: string | null;
  statusDescription: string | null;
  nonImdrfCode: string | null;
  primaryCategory: string | null;
  secondaryCategory: string | null;
};
```

- [ ] **Step 1: Write the failing integration tests for ranking behavior**

Append to `server/tests/integration/staff-imdrf-readonly.test.ts`, inside the existing
`describe.skipIf(!INTEGRATION_ENABLED)("the read-only IMDRF terminology sidebar", ...)`
block (this file already has `seedRelease`/`seedTerm`/`signedInAs`/`get`/`json` helpers
— reuse them, don't redefine):

```ts
  it("search tolerates a partial word: 'batt' finds 'Battery'", async () => {
    const releaseId = await seedRelease(2026);
    await seedTerm(releaseId, {
      annex: "G",
      code: "G02002",
      term: "Battery",
      codeHierarchy: "G02|G02002",
      level: 2,
      sortOrder: 0,
    });
    const { cookie } = await signedInAs("manager");

    const res = json<{ rows: { term: string }[] }>(
      await get(`/imdrf/releases/${releaseId}/search?q=batt`, cookie),
    );
    expect(res.rows.map((r) => r.term)).toContain("Battery");
  });

  it("search tolerates a typo: 'batery' finds 'Battery'", async () => {
    const releaseId = await seedRelease(2026);
    await seedTerm(releaseId, {
      annex: "G",
      code: "G02002",
      term: "Battery",
      codeHierarchy: "G02|G02002",
      level: 2,
      sortOrder: 0,
    });
    const { cookie } = await signedInAs("manager");

    const res = json<{ rows: { term: string }[] }>(
      await get(`/imdrf/releases/${releaseId}/search?q=batery`, cookie),
    );
    expect(res.rows.map((r) => r.term)).toContain("Battery");
  });

  it("search tolerates an extra, unmatched word: 'battery device' still finds 'Battery'", async () => {
    const releaseId = await seedRelease(2026);
    await seedTerm(releaseId, {
      annex: "G",
      code: "G02002",
      term: "Battery",
      codeHierarchy: "G02|G02002",
      level: 2,
      sortOrder: 0,
    });
    const { cookie } = await signedInAs("manager");

    const res = json<{ rows: { term: string }[] }>(
      await get(`/imdrf/releases/${releaseId}/search?q=${encodeURIComponent("battery device")}`, cookie),
    );
    expect(res.rows.map((r) => r.term)).toContain("Battery");
  });

  it("search by bare code finds the matching term", async () => {
    const releaseId = await seedRelease(2026);
    await seedTerm(releaseId, {
      annex: "G",
      code: "G02002",
      term: "Battery",
      codeHierarchy: "G02|G02002",
      level: 2,
      sortOrder: 0,
    });
    const { cookie } = await signedInAs("manager");

    const res = json<{ rows: { term: string }[] }>(
      await get(`/imdrf/releases/${releaseId}/search?q=G02002`, cookie),
    );
    expect(res.rows.map((r) => r.term)).toContain("Battery");
  });

  it("ranks an exact term match above an unrelated definition-only mention", async () => {
    const releaseId = await seedRelease(2026);
    await seedTerm(releaseId, {
      annex: "G",
      code: "G02002",
      term: "Battery",
      codeHierarchy: "G02|G02002",
      level: 2,
      sortOrder: 0,
    });
    await seedTerm(releaseId, {
      annex: "A",
      code: "A9001",
      term: "Unrelated Problem",
      codeHierarchy: "A9001",
      level: 1,
      sortOrder: 1,
      definition: "Sometimes involves a battery-powered accessory.",
    });
    const { cookie } = await signedInAs("manager");

    const res = json<{ rows: { term: string }[] }>(
      await get(`/imdrf/releases/${releaseId}/search?q=battery`, cookie),
    );
    expect(res.rows[0]?.term).toBe("Battery");
  });

  it("searchTerms's TermRow carries definition, codeHierarchy, status and category fields", async () => {
    const releaseId = await seedRelease(2026);
    await seedTerm(releaseId, {
      annex: "G",
      code: "G02002",
      term: "Battery",
      codeHierarchy: "G02|G02002",
      level: 2,
      sortOrder: 0,
      definition: "A power cell for a device.",
      status: "New",
    });
    const { cookie } = await signedInAs("manager");

    const res = json<{
      rows: { definition: string | null; codeHierarchy: string; status: string | null }[];
    }>(await get(`/imdrf/releases/${releaseId}/search?q=battery`, cookie));
    expect(res.rows[0]?.definition).toBe("A power cell for a device.");
    expect(res.rows[0]?.codeHierarchy).toBe("G02|G02002");
    expect(res.rows[0]?.status).toBe("New");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --dir server test:integration -- tests/integration/staff-imdrf-readonly.test.ts`
Expected: FAIL — the current `ILIKE`-only `searchTerms` doesn't match "batt", "batery",
or "battery device" against "Battery", and today's `TermRow` has no `definition`/
`codeHierarchy`/`status` fields.

- [ ] **Step 3: Replace `TermRow` and `TermQueryRow`/`termRowOf`**

In `server/src/domain/imdrf/query-service.ts`, replace the existing `TermRow` type
(lines 28–35):

```ts
export type TermRow = {
  id: string;
  annex: Annex;
  code: string;
  term: string;
  level: number;
};
```

with:

```ts
export type TermRow = {
  id: string;
  annex: Annex;
  code: string;
  term: string;
  level: number;
  definition: string | null;
  codeHierarchy: string;
  status: string | null;
  statusDescription: string | null;
  nonImdrfCode: string | null;
  primaryCategory: string | null;
  secondaryCategory: string | null;
};
```

Replace `TermQueryRow` and `termRowOf` (currently lines 157–179):

```ts
type TermQueryRow = {
  id: string;
  annex: string;
  code: string;
  term: string;
  level: number;
  sort_order: number;
  has_children: boolean;
};

function termRowOf(row: TermQueryRow): TermRow {
  if (!isAnnex(row.annex)) {
    throw new Error(`Stored term ${row.id} has an invalid annex "${row.annex}".`);
  }
  return {
    id: row.id,
    annex: row.annex,
    code: row.code,
    term: row.term,
    level: row.level,
    hasChildren: row.has_children,
  };
}
```

with:

```ts
type TermQueryRow = {
  id: string;
  annex: string;
  code: string;
  term: string;
  level: number;
  sort_order: number;
  definition: string | null;
  code_hierarchy: string;
  status: string | null;
  status_description: string | null;
  non_imdrf_code: string | null;
  primary_category: string | null;
  secondary_category: string | null;
};

function termRowOf(row: TermQueryRow): TermRow {
  if (!isAnnex(row.annex)) {
    throw new Error(`Stored term ${row.id} has an invalid annex "${row.annex}".`);
  }
  return {
    id: row.id,
    annex: row.annex,
    code: row.code,
    term: row.term,
    level: row.level,
    definition: row.definition,
    codeHierarchy: row.code_hierarchy,
    status: row.status,
    statusDescription: row.status_description,
    nonImdrfCode: row.non_imdrf_code,
    primaryCategory: row.primary_category,
    secondaryCategory: row.secondary_category,
  };
}
```

(This will not compile yet — `listTerms` (Task 4) still selects `has_children` and
builds the old shape. That's expected; Task 4 fixes it next. `searchTerms`, replaced in
the next step, already targets the new shape.)

- [ ] **Step 4: Replace `likePattern` and `searchTerms`**

Delete the `likePattern` function and the existing `searchTerms` (currently lines
242–284) entirely, and replace with:

```ts
/**
 * A small, tunable floor below which a row's relevance score is not "found" at all — every
 * row has *some* nonzero trigram similarity to any string, so without a floor a search would
 * return the entire release, worst-match-first. These starting points must be re-validated
 * against the actual imported 2026 release (Task 10) — they are not to be trusted as final just
 * because they compile; if real usage against the real dataset shows either floor too strict
 * (misses genuine typos) or too loose (returns noise), it is these two constants to retune, not
 * the query's structure.
 *
 * Two floors, not one: a very short query (1-2 characters) has so few trigrams that almost
 * anything clears a low floor, burying the handful of genuine prefix/code matches under noise —
 * so short queries use a stricter floor and skip the fuzzy definition signal entirely (below),
 * relying on prefix/code matching instead.
 */
const SEARCH_SCORE_FLOOR = 0.15;
const SHORT_QUERY_SCORE_FLOOR = 0.4;
const SHORT_QUERY_MAX_LENGTH = 2;

/** Strips everything but letters/digits from a token so it can be embedded directly into a
 *  hand-built `to_tsquery` string (as `token:*`) without risking tsquery operator-syntax
 *  characters (`&`, `|`, `!`, `:`, parentheses, quotes) reaching the parser. */
function tsqueryToken(token: string): string {
  return token.replace(/[^\p{L}\p{N}]/gu, "");
}

export async function searchTerms(
  db: Database,
  opts: { releaseId: string; query: string; limit: number; cursor?: string },
): Promise<{ rows: TermRow[]; nextCursor: string | null }> {
  const trimmed = opts.query.trim();
  if (trimmed === "") return { rows: [], nextCursor: null };

  const limit = clampLimit(opts.limit, MAX_SEARCH_LIMIT);
  const after = decodeSearchCursor(opts.cursor);
  const afterScore = after?.score ?? null;
  const afterId = after?.id ?? null;
  const isShortQuery = trimmed.length <= SHORT_QUERY_MAX_LENGTH;
  const scoreFloor = isShortQuery ? SHORT_QUERY_SCORE_FLOOR : SEARCH_SCORE_FLOOR;

  // Up to 8 tokens, each becomes a prefix match ("batt:*") OR'd together — OR (not AND) is what
  // lets a query that only supplies some of a multi-word term's words still find it; ts_rank
  // naturally scores a row matching more tokens higher than one matching fewer.
  const tsTokens = trimmed
    .split(/\s+/)
    .slice(0, 8)
    .map(tsqueryToken)
    .filter((t) => t.length > 0);
  const tsqueryText = tsTokens.map((t) => `${t}:*`).join(" | ");

  // Candidate retrieval happens through operators the migration's GIN indexes actually back —
  // `@@` on search_vector, `%`/`<%` (similarity/word_similarity) on code/term/definition — so
  // Postgres can use an index (bitmap-or) scan to find candidates instead of a sequential scan
  // computing a similarity function for every row in the release. Ranking (the GREATEST(...)
  // below) then runs only over that already-narrowed candidate set, not the whole table. This is
  // the "indexed candidate retrieval, then rank" shape the spec requires — never widen this WHERE
  // clause back to an unconditional per-row similarity() scan.
  const rows = await db.execute<TermQueryRow & { score: string }>(sql`
    WITH q AS (
      SELECT ${tsqueryText === "" ? sql`NULL::tsquery` : sql`to_tsquery('english', ${tsqueryText})`} AS tsq
    )
    SELECT * FROM (
      SELECT
        t.id, t.annex, t.code, t.term, t.level,
        t.definition, t.code_hierarchy, t.status, t.status_description,
        t.non_imdrf_code, t.primary_category, t.secondary_category,
        round(
          GREATEST(
            -- ts_rank over search_vector already weights term+code (weight A) above
            -- definition+non_imdrf_code (weight B) via the migration's setweight() calls.
            COALESCE(ts_rank(t.search_vector, q.tsq), 0),
            similarity(t.code, ${trimmed}),
            similarity(t.term, ${trimmed})
            ${
              isShortQuery
                ? sql``
                : sql`, word_similarity(${trimmed}, coalesce(t.definition, ''))`
            }
          )::numeric,
          6
        ) AS score
      FROM imdrf_terms t, q
      WHERE t.release_id = ${opts.releaseId}
        AND (
          (q.tsq IS NOT NULL AND t.search_vector @@ q.tsq)
          OR t.code % ${trimmed}
          OR t.term % ${trimmed}
          ${isShortQuery ? sql`` : sql`OR t.definition %> ${trimmed}`}
        )
    ) ranked
    WHERE ranked.score > ${scoreFloor}
      AND (
        ${afterScore}::numeric IS NULL
        OR ranked.score < ${afterScore}
        OR (ranked.score = ${afterScore} AND ranked.id > ${afterId})
      )
    ORDER BY ranked.score DESC, ranked.id ASC
    LIMIT ${limit + 1}
  `);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    rows: page.map(termRowOf),
    nextCursor:
      hasMore && last
        ? encodeSearchCursor({ score: Number(last.score), id: last.id })
        : null,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --dir server test:integration -- tests/integration/staff-imdrf-readonly.test.ts`
Expected: the six new tests PASS. The file's *older* tests may still fail to compile —
they reference `hasChildren`/`parentId` against the now-changed `TermRow`; that's
expected and fixed in Task 9. If your toolchain fails the whole file on a type error
before running anything, temporarily comment out the old parentId-dependent assertions
(`hasChildren`/`?parentId=`) to confirm the new tests pass in isolation, then leave them
commented for Task 9 to remove/replace properly — do not delete Task 9's file section
outright here.

- [ ] **Step 6: Commit**

```bash
git add server/src/domain/imdrf/query-service.ts server/tests/integration/staff-imdrf-readonly.test.ts
git commit -m "feat(imdrf): rewrite searchTerms with hybrid FTS + trigram ranking"
```

---

### Task 4: Flatten `listTerms`, keep `getTerm` untouched

**Files:**
- Modify: `server/src/domain/imdrf/query-service.ts:181-240` (`listTerms` only)
- Test: `server/tests/integration/imdrf-query-pagination.test.ts` (new flat-listing
  case; the file's full cleanup is Task 9 — this step only adds proof the new query
  shape paginates correctly, without yet deleting the old root/children cases)

**Interfaces:**
- Consumes: the `TermRow`/`TermQueryRow`/`termRowOf` from Task 3.
- Produces:
  `listTerms(db, opts: { releaseId: string; annex: Annex; limit: number; cursor?: string }): Promise<{ rows: TermRow[]; nextCursor: string | null }>`
  — note `parentId` is gone from the options object entirely; `annex` is always
  required now. `Cursor`/`encodeCursor`/`decodeCursor` (the `(sort_order, id)` browse
  cursor) are unchanged and still what this function uses.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/integration/imdrf-query-pagination.test.ts` (inside the
existing `describe.skipIf(!INTEGRATION_ENABLED)(...)` block, reusing its `seedRelease`
helper):

```ts
  it("lists an annex flat, parents and children together, in sort_order document order", async () => {
    const releaseId = await seedRelease();
    const rootId = (
      await owner.db.execute(sql`
        INSERT INTO imdrf_terms (release_id, annex, code, term, code_hierarchy, level, sort_order)
        VALUES (${releaseId}, 'A', 'A01', 'Root', 'A01', 1, 0)
        RETURNING id
      `)
    )[0] as { id: string };
    await owner.db.execute(sql`
      INSERT INTO imdrf_terms (release_id, annex, code, term, code_hierarchy, level, sort_order, parent_term_id)
      VALUES (${releaseId}, 'A', 'A0101', 'Child', 'A01|A0101', 2, 1, ${rootId.id})
    `);
    await owner.db.execute(sql`
      INSERT INTO imdrf_terms (release_id, annex, code, term, code_hierarchy, level, sort_order)
      VALUES (${releaseId}, 'A', 'A02', 'Other root', 'A02', 1, 2)
    `);

    const page = await listTerms(owner.db, { releaseId, annex: "A", limit: 10 });

    expect(page.rows.map((r) => r.code)).toEqual(["A01", "A0101", "A02"]);
  });
```

Add `listTerms` to this file's existing import line (`import { listTerms, searchTerms }
from "../../src/domain/imdrf/query-service.js";` — already present, no change needed
there).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir server test:integration -- tests/integration/imdrf-query-pagination.test.ts`
Expected: FAIL — `listTerms` still requires `parentId` in its options and won't accept
this call shape (or a type error, depending on how strictly the test file is checked
before running).

- [ ] **Step 3: Replace `listTerms`**

In `server/src/domain/imdrf/query-service.ts`, replace the entire existing `listTerms`
function (currently lines 181–240) with:

```ts
export async function listTerms(
  db: Database,
  opts: { releaseId: string; annex: Annex; limit: number; cursor?: string },
): Promise<{ rows: TermRow[]; nextCursor: string | null }> {
  const limit = clampLimit(opts.limit, MAX_LIST_LIMIT);
  const after = decodeCursor(opts.cursor);
  const afterSortOrder = after?.sortOrder ?? null;
  const afterId = after?.id ?? null;

  const rows = await db.execute<TermQueryRow>(sql`
    SELECT t.id, t.annex, t.code, t.term, t.level, t.sort_order,
           t.definition, t.code_hierarchy, t.status, t.status_description,
           t.non_imdrf_code, t.primary_category, t.secondary_category
      FROM imdrf_terms t
     WHERE t.release_id = ${opts.releaseId}
       AND t.annex = ${opts.annex}
       AND (
         ${afterSortOrder}::int IS NULL
         OR t.sort_order > ${afterSortOrder}
         OR (t.sort_order = ${afterSortOrder} AND t.id > ${afterId})
       )
     ORDER BY t.sort_order, t.id
     LIMIT ${limit + 1}
  `);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    rows: page.map(termRowOf),
    nextCursor: hasMore && last ? encodeCursor({ sortOrder: last.sort_order, id: last.id }) : null,
  };
}
```

Do **not** touch `getTerm`, `TermDetailRow`, or `TermDetail` anywhere else in this
file — they stay exactly as they are today.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir server test:integration -- tests/integration/imdrf-query-pagination.test.ts`
Expected: the new test PASSES. The file's older root/children pagination tests will now
fail to compile/run against the new `listTerms` signature — expected, and fixed in
Task 9.

- [ ] **Step 5: Typecheck the whole server**

Run: `pnpm --dir server typecheck`
Expected: errors only in `routes/imdrf.tsx` (still calls `listTerms` with `parentId`)
and in the not-yet-updated test files — both fixed by Tasks 5 and 9. No errors in
`query-service.ts` itself.

- [ ] **Step 6: Commit**

```bash
git add server/src/domain/imdrf/query-service.ts server/tests/integration/imdrf-query-pagination.test.ts
git commit -m "feat(imdrf): flatten listTerms to one ORDER BY sort_order, id query"
```

---

### Task 5: Update the routes — drop `parentId`, keep `/terms/:id`

**Files:**
- Modify: `server/src/doors/staff/routes/imdrf.tsx:82-113` (the `/terms` route only)
- Test: `server/tests/integration/staff-imdrf-readonly.test.ts` (one new case; the
  file's old parentId test is removed in Task 9, not here)

**Interfaces:**
- Consumes: `listTerms(db, { releaseId, annex, limit, cursor })` from Task 4.
- Produces: `GET /imdrf/releases/:releaseId/terms?annex=X&cursor=Y` (annex always
  required; `parentId` no longer accepted as a query param — an old link using it now
  just gets ignored, since the route no longer reads it). `GET .../terms/:id` is
  untouched below this task's edit.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/integration/staff-imdrf-readonly.test.ts`:

```ts
  it("terms listing requires annex and rejects an invalid one with 400", async () => {
    const releaseId = await seedRelease(2026);
    const { cookie } = await signedInAs("manager");

    const missing = await get(`/imdrf/releases/${releaseId}/terms`, cookie);
    expect(missing.statusCode).toBe(400);

    const invalid = await get(`/imdrf/releases/${releaseId}/terms?annex=Z`, cookie);
    expect(invalid.statusCode).toBe(400);
  });
```

- [ ] **Step 2: Run the test to verify it fails (or already passes by accident)**

Run: `pnpm --dir server test:integration -- tests/integration/staff-imdrf-readonly.test.ts -t "requires annex"`
Expected: likely FAILs to even compile alongside the file's other now-stale tests from
Task 3/4 — that's fine, this task's edit plus Task 9's cleanup together make the whole
file consistent. Confirm this specific test's logic is sound by inspection if the
runner can't isolate it cleanly yet.

- [ ] **Step 3: Replace the `/terms` route handler**

In `server/src/doors/staff/routes/imdrf.tsx`, replace the existing handler (currently
lines 82–113):

```ts
  app.get("/imdrf/releases/:releaseId/terms", async (request, reply) => {
    const release = await requirePublishedRelease(
      app,
      (request.params as { releaseId: string }).releaseId,
    );
    if (!release) return reply.status(404).send({ error: "Release not found." });

    const query = request.query as { annex?: string; parentId?: string; cursor?: string };

    if (query.parentId === undefined || query.parentId === "") {
      if (query.annex === undefined || !isAnnex(query.annex)) {
        return reply.status(400).send({ error: "annex is required when parentId is absent." });
      }
      return listTerms(app.db, {
        releaseId: release.id,
        annex: query.annex,
        parentId: null,
        limit: TERMS_PAGE_LIMIT,
        cursor: query.cursor,
      });
    }

    const parentId = TermId.safeParse(query.parentId);
    if (!parentId.success) return reply.status(400).send({ error: "Invalid parentId." });

    return listTerms(app.db, {
      releaseId: release.id,
      parentId: parentId.data,
      limit: TERMS_PAGE_LIMIT,
      cursor: query.cursor,
    });
  });
```

with:

```ts
  app.get("/imdrf/releases/:releaseId/terms", async (request, reply) => {
    const release = await requirePublishedRelease(
      app,
      (request.params as { releaseId: string }).releaseId,
    );
    if (!release) return reply.status(404).send({ error: "Release not found." });

    const query = request.query as { annex?: string; cursor?: string };
    if (query.annex === undefined || !isAnnex(query.annex)) {
      return reply.status(400).send({ error: "annex is required." });
    }

    return listTerms(app.db, {
      releaseId: release.id,
      annex: query.annex,
      limit: TERMS_PAGE_LIMIT,
      cursor: query.cursor,
    });
  });
```

Leave the `/terms/:id` route (below it in the same file) and every import at the top
of the file exactly as-is — `getTerm` is still imported and used there unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir server test:integration -- tests/integration/staff-imdrf-readonly.test.ts -t "requires annex"`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --dir server typecheck`
Expected: no errors in `routes/imdrf.tsx`. Remaining errors, if any, are in
not-yet-updated view/test files, addressed in Tasks 6 and 9.

- [ ] **Step 6: Commit**

```bash
git add server/src/doors/staff/routes/imdrf.tsx server/tests/integration/staff-imdrf-readonly.test.ts
git commit -m "feat(imdrf): drop parentId from the terms listing route"
```

---

### Task 6: Rewrite `views/imdrf.tsx` — sidebar, breadcrumb, reading pane

**Files:**
- Modify: `server/src/doors/staff/views/imdrf.tsx` (full rewrite of the body; keep the
  `ImdrfBrowserPageProps` shape and `ANNEX_TITLES` map)
- Modify: `server/src/doors/staff/routes/imdrf.tsx:50-70` (the `GET /imdrf` handler —
  needs to also read `annex`/`q`/`term` and pass an initial server-rendered page of
  rows to the view)
- Test: `server/tests/integration/staff-imdrf-readonly.test.ts` (extend the existing
  "renders a documentation reader" test)

**Interfaces:**
- Consumes: `TermRow` (Task 3), `listTerms`/`searchTerms` (Tasks 3–4),
  `AnnexSummary`/`ReleaseSummary` (unchanged).
- Produces: the page shell Task 7's client script attaches to — `data-imdrf-browser`
  root, `data-release-id`, a `data-imdrf-annex` button per annex, a
  `data-imdrf-search` input, a `data-imdrf-content` container holding server-rendered
  `<article id="term-<uuid>" class="imdrf-term" data-code="...">` blocks, and a
  `data-imdrf-sentinel` div for the client's `IntersectionObserver`.

- [ ] **Step 1: Extend the failing integration test**

Replace the existing "renders a documentation reader..." test in
`server/tests/integration/staff-imdrf-readonly.test.ts` with:

```ts
  it("renders a documentation reader with sidebar, breadcrumb and anchored term cards, no inline styles", async () => {
    const releaseId = await seedRelease(2026);
    await seedTerm(releaseId, {
      annex: "A",
      code: "A01",
      term: "Root",
      codeHierarchy: "A01",
      level: 1,
      sortOrder: 0,
      definition: "A root-level problem term.",
    });
    const { cookie } = await signedInAs("assessor");

    const page = await get("/imdrf?annex=A", cookie);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(">IMDRF terminology<");
    expect(page.body).toContain("data-imdrf-browser");
    expect(page.body).toContain("data-imdrf-annex=\"A\"");
    expect(page.body).toContain("data-imdrf-search");
    expect(page.body).toContain("data-imdrf-content");
    expect(page.body).toContain("data-imdrf-sentinel");
    expect(page.body).toMatch(/id="term-[0-9a-f-]{36}"/);
    expect(page.body).toContain("Medical Device Problem"); // breadcrumb/annex title text
    expect(page.body).not.toContain('style="');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir server test:integration -- tests/integration/staff-imdrf-readonly.test.ts -t "sidebar, breadcrumb"`
Expected: FAIL — today's page has none of `data-imdrf-content`/`data-imdrf-sentinel`/
`id="term-..."`.

- [ ] **Step 3: Update the `GET /imdrf` route handler**

In `server/src/doors/staff/routes/imdrf.tsx`, replace the existing handler (currently
lines 50–70):

```ts
  app.get("/imdrf", async (request, reply) => {
    const session = currentSession(request);
    const releases = await listPublishedReleases(app.db);

    const query = request.query as { release?: string };
    const selected =
      releases.find((release) => release.id === query.release) ?? releases[0] ?? null;

    const summary = selected ? await annexSummary(app.db, selected.id) : [];

    reply.html(
      <ImdrfBrowserPage
        releases={releases}
        selected={selected}
        summary={summary}
        viewerRole={session.role}
        viewerName={session.fullName}
      />,
    );
  });
```

with:

```ts
  app.get("/imdrf", async (request, reply) => {
    const session = currentSession(request);
    const releases = await listPublishedReleases(app.db);

    const query = request.query as { release?: string; annex?: string; q?: string };
    const selected =
      releases.find((release) => release.id === query.release) ?? releases[0] ?? null;

    const summary = selected ? await annexSummary(app.db, selected.id) : [];
    const q = (query.q ?? "").trim();
    // No `annex` param at all means "the overview page" (the documentation landing page — release
    // info + the annex list as navigation), not "default to Annex A". Only an explicit, valid
    // `?annex=X` selects a browse target.
    const activeAnnex: Annex | null = isAnnex(query.annex ?? "") ? (query.annex as Annex) : null;

    let initialRows: TermRow[] = [];
    let initialNextCursor: string | null = null;
    let mode: "overview" | "browse" | "search" = "overview";

    if (selected) {
      if (q !== "") {
        mode = "search";
        const page = await searchTerms(app.db, {
          releaseId: selected.id,
          query: q,
          limit: SEARCH_PAGE_LIMIT,
        });
        initialRows = page.rows;
        initialNextCursor = page.nextCursor;
      } else if (activeAnnex !== null) {
        mode = "browse";
        const page = await listTerms(app.db, {
          releaseId: selected.id,
          annex: activeAnnex,
          limit: TERMS_PAGE_LIMIT,
        });
        initialRows = page.rows;
        initialNextCursor = page.nextCursor;
      }
      // mode stays "overview" when neither q nor annex is present — no listTerms/searchTerms call
      // at all, matching "opening /imdrf does not download thousands of terms" (spec §12, §45).
    }

    reply.html(
      <ImdrfBrowserPage
        releases={releases}
        selected={selected}
        summary={summary}
        viewerRole={session.role}
        viewerName={session.fullName}
        mode={mode}
        activeAnnex={activeAnnex}
        query={q}
        initialRows={initialRows}
        initialNextCursor={initialNextCursor}
      />,
    );
  });
```

Add `Annex` and `TermRow` to this file's existing type-only import from
`../../../domain/imdrf/query-service.js` / `../../../domain/imdrf/types.js` (the file
already imports `isAnnex` from `types.js` and several functions from
`query-service.js` — add `type { Annex }` to the `types.js` import and `type { TermRow
}` plus `searchTerms` to the `query-service.js` import; `searchTerms` is not yet
imported there today).

- [ ] **Step 4: Rewrite `views/imdrf.tsx`**

Replace the full contents of `server/src/doors/staff/views/imdrf.tsx` with:

```tsx
/**
 * The read-only IMDRF terminology documentation reader, reachable by every signed-in staff role.
 *
 * A documentation-app layout, not a database browser: sticky annex sidebar (docs-style left nav),
 * a breadcrumb naming the active annex or search, and a reading pane rendered in the workbook's
 * own document order (`sort_order` — see `parser.ts`). Every term's rendered block carries a
 * `term-<uuid>` anchor, never a `code`-keyed one — IMDRF's own data reuses codes across more than
 * one hierarchy position (Annex E cross-lists ~200 terms this way), so `code` alone cannot safely
 * identify one occurrence.
 *
 * The first page of rows (whichever annex or search is active) is rendered here, server-side, so
 * a shared link works even before `/assets/imdrf-browser.js` runs. That script then owns infinite
 * scroll, the search-vs-browse toggle, and resolving a `term=<uuid>` deep link that isn't on the
 * first page.
 */

import type { TermRow } from "../../../domain/imdrf/query-service.js";
import type { ReleaseSummary } from "../../../domain/imdrf/query-service.js";
import type { Annex, AnnexSummary } from "../../../domain/imdrf/types.js";
import { StaffShell } from "./shell.js";

const ANNEX_TITLES: Record<string, string> = {
  A: "Medical Device Problem",
  B: "Type of Investigation",
  C: "Investigation Findings",
  D: "Investigation Conclusion",
  E: "Clinical Signs, Symptoms or Conditions",
  F: "Health Impact",
  G: "Medical Device Component",
};

export type ImdrfBrowserPageProps = {
  releases: ReleaseSummary[];
  selected: ReleaseSummary | null;
  summary: AnnexSummary[];
  viewerRole: string;
  viewerName: string;
  mode: "overview" | "browse" | "search";
  activeAnnex: Annex | null;
  query: string;
  initialRows: TermRow[];
  initialNextCursor: string | null;
};

function termTotal(summary: AnnexSummary[]): number {
  return summary.reduce((sum, row) => sum + row.count, 0);
}

function TermCard({ row }: { row: TermRow }): JSX.Element {
  const crumb = row.codeHierarchy.split("|").filter(Boolean).join(" › ");
  const statusLower = (row.status ?? "").toLowerCase();
  const isQuiet = statusLower.includes("retired") || statusLower.includes("not selectable");
  const hasMeta = Boolean(row.nonImdrfCode || row.primaryCategory || row.secondaryCategory);

  return (
    <article
      class="imdrf-term"
      id={`term-${row.id}`}
      data-imdrf-term
      data-code={row.code}
      data-annex={row.annex}
    >
      <p class="eyebrow">
        Annex {row.annex} · Level {row.level}
      </p>
      <h3 class="imdrf-term-head">
        <code safe class="imdrf-term-code">{row.code}</code>
        <span safe>{row.term}</span>
        {row.status && (
          <span class={isQuiet ? "tag muted" : "tag"} safe>
            {row.status}
          </span>
        )}
      </h3>
      {crumb && crumb !== row.code && (
        <p class="imdrf-term-crumb" safe>
          {crumb}
        </p>
      )}
      {row.definition && (
        <p class="imdrf-term-definition" safe>
          {row.definition}
        </p>
      )}
      {row.statusDescription && (
        <p class="hint" safe>
          {row.statusDescription}
        </p>
      )}
      {hasMeta && (
        <dl class="imdrf-term-meta">
          {row.nonImdrfCode && (
            <div>
              <dt>Non-IMDRF code</dt>
              <dd safe>{row.nonImdrfCode}</dd>
            </div>
          )}
          {row.primaryCategory && (
            <div>
              <dt>Primary category</dt>
              <dd safe>{row.primaryCategory}</dd>
            </div>
          )}
          {row.secondaryCategory && (
            <div>
              <dt>Secondary category</dt>
              <dd safe>{row.secondaryCategory}</dd>
            </div>
          )}
        </dl>
      )}
    </article>
  );
}

export function ImdrfBrowserPage({
  releases,
  selected,
  summary,
  viewerRole,
  viewerName,
  mode,
  activeAnnex,
  query,
  initialRows,
  initialNextCursor,
}: ImdrfBrowserPageProps): JSX.Element {
  const total = termTotal(summary);
  const breadcrumb =
    mode === "search"
      ? `Search results for "${query}"`
      : activeAnnex
        ? `Annex ${activeAnnex} · ${ANNEX_TITLES[activeAnnex] ?? ""}`
        : "";

  return (
    <StaffShell
      title="IMDRF terminology — AE Reports"
      pageTitle="IMDRF terminology"
      role={viewerRole}
      fullName={viewerName}
      active="imdrf"
    >
      {releases.length === 0 || selected === null ? (
        <div class="staff-head">
          <div class="sp">
            <p class="hint">No IMDRF terminology has been published yet.</p>
          </div>
        </div>
      ) : (
        <div
          class="imdrf-page"
          data-imdrf-browser
          data-release-id={selected.id}
          data-initial-annex={activeAnnex ?? ""}
          data-initial-mode={mode}
          data-initial-cursor={initialNextCursor ?? ""}
        >
          <div class="staff-head">
            <div class="sp">
              <p class="eyebrow">
                Release {selected.releaseYear}
                {selected.documentCode && (
                  <>
                    {" · "}
                    <span safe>{selected.documentCode}</span>
                  </>
                )}
              </p>
              <h2 safe>{selected.title ?? "IMDRF Adverse Event Terminology"}</h2>
              <p class="hint">
                A read-only handbook of published IMDRF codes and definitions. Officers look terms
                up here while assessing a report.
                {total > 0 && (
                  <>
                    {" "}
                    {total.toLocaleString("en")} term{total === 1 ? "" : "s"} across{" "}
                    {summary.length} annex{summary.length === 1 ? "" : "es"}.
                  </>
                )}
              </p>
            </div>
            <input
              type="search"
              class="imdrf-search"
              data-imdrf-search
              value={query}
              placeholder="Search code, term or definition…"
              aria-label="Search terminology"
            />
          </div>

          {releases.length > 1 && (
            <nav class="wl-tabs" aria-label="IMDRF releases">
              {releases.map((release) => {
                const on = selected.id === release.id;
                return (
                  <a
                    href={`/imdrf?release=${release.id}`}
                    class={on ? "on" : ""}
                    aria-current={on ? "true" : undefined}
                  >
                    {release.releaseYear}
                  </a>
                );
              })}
            </nav>
          )}

          <button
            type="button"
            class="imdrf-nav-toggle"
            data-imdrf-nav-toggle
            aria-expanded="false"
            aria-controls="imdrf-docs-nav"
          >
            Annexes
          </button>

          <div class="imdrf-docs">
            <aside class="imdrf-docs-nav" id="imdrf-docs-nav" aria-label="Annex">
              <a href="/imdrf" class={mode === "overview" ? "imdrf-annex on" : "imdrf-annex"}>
                <span class="imdrf-annex-name">Overview</span>
              </a>
              {summary.map((row) => {
                const on = mode === "browse" && row.annex === activeAnnex;
                return (
                  <a
                    href={`/imdrf?release=${selected.id}&annex=${row.annex}`}
                    class={on ? "imdrf-annex on" : "imdrf-annex"}
                    data-imdrf-annex={row.annex}
                    aria-current={on ? "true" : undefined}
                  >
                    <span class="imdrf-annex-code" safe>
                      {row.annex}
                    </span>
                    <span class="imdrf-annex-name">{ANNEX_TITLES[row.annex] ?? ""}</span>
                    <span class="imdrf-annex-count">{row.count}</span>
                  </a>
                );
              })}
            </aside>

            <div class="imdrf-docs-main">
              {mode === "overview" ? (
                <div class="imdrf-overview" data-imdrf-overview>
                  <p class="hint">
                    A read-only, indexed handbook of published IMDRF adverse-event codes and
                    definitions. Officers look terms up here while assessing a report — browse an
                    annex from the list on the left, or search above.
                  </p>
                  <nav class="imdrf-overview-annexes" aria-label="Annexes">
                    {summary.map((row) => (
                      <a class="imdrf-overview-annex" href={`/imdrf?release=${selected.id}&annex=${row.annex}`}>
                        <span class="imdrf-annex-code" safe>
                          {row.annex}
                        </span>
                        <span class="imdrf-annex-name">{ANNEX_TITLES[row.annex] ?? ""}</span>
                        <span class="imdrf-annex-count">
                          {row.count} term{row.count === 1 ? "" : "s"}
                        </span>
                      </a>
                    ))}
                  </nav>
                </div>
              ) : (
                <>
                  <p class="imdrf-docs-breadcrumb" data-imdrf-docs-breadcrumb safe>
                    {breadcrumb}
                  </p>
                  <div
                    class={mode === "search" ? "imdrf-content imdrf-search-results" : "imdrf-content"}
                    data-imdrf-content
                  >
                    {initialRows.length === 0 ? (
                      <p class="hint" data-imdrf-empty>
                        {mode === "search" ? "No matching terms." : "No terms in this annex."}
                      </p>
                    ) : (
                      initialRows.map((row) => <TermCard row={row} />)
                    )}
                  </div>
                  <div class="imdrf-sentinel" data-imdrf-sentinel></div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {selected && <script src="/assets/imdrf-browser.js" defer></script>}
    </StaffShell>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --dir server test:integration -- tests/integration/staff-imdrf-readonly.test.ts -t "sidebar, breadcrumb"`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --dir server typecheck`
Expected: no errors in `views/imdrf.tsx` or `routes/imdrf.tsx`.

- [ ] **Step 7: Commit**

```bash
git add server/src/doors/staff/views/imdrf.tsx server/src/doors/staff/routes/imdrf.tsx server/tests/integration/staff-imdrf-readonly.test.ts
git commit -m "feat(imdrf): rewrite reader as docs-style sidebar + breadcrumb + cards"
```

---

### Task 7: Rewrite `public/imdrf-browser.js`

**Files:**
- Modify: `server/public/imdrf-browser.js` (full rewrite)

**Interfaces:**
- Consumes: `GET /imdrf/releases/:releaseId/terms?annex=X&cursor=Y`,
  `GET /imdrf/releases/:releaseId/search?q=X&cursor=Y`,
  `GET /imdrf/releases/:releaseId/terms/:id` (all from Tasks 3–5); reads
  `data-release-id`/`data-initial-annex`/`data-initial-mode`/`data-initial-cursor` and
  the `data-imdrf-*` hooks Task 6's view renders.
- Produces: no exports (IIFE, same as today) — this is the door's opt-in client script.

This file has no automated test (matching this door's existing convention — the old
`imdrf-browser.js` has none either; its behavior is exercised manually and through the
server-rendered-shell integration tests already covering its hooks' presence). Verify
it manually per Step 3 below.

- [ ] **Step 1: Replace the file**

Replace the full contents of `server/public/imdrf-browser.js` with:

```js
/*
 * The IMDRF terminology documentation reader: annex sidebar, debounced search, infinite scroll,
 * and `term=<uuid>` deep-link resolution. Every list here comes from the server already paged —
 * nothing in this file ever fetches "all terms" and filters client-side. Opt-in like the door's
 * other scripts: a page with no `[data-imdrf-browser]` container loads this file (it is only ever
 * referenced from the one page that has one) and does nothing.
 *
 * Two cursors are tracked, never conflated: one for the active annex's browse pagination, one for
 * the active search's ranked pagination. Switching mode resets both to "start of a new page 1".
 */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value).replace(
      /[&<>"']/g,
      function (ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
      },
    );
  }

  ready(function () {
    var root = document.querySelector("[data-imdrf-browser]");
    if (!root) return;

    var releaseId = root.getAttribute("data-release-id");
    var searchInput = root.querySelector("[data-imdrf-search]");
    var contentEl = root.querySelector("[data-imdrf-content]");
    var sentinelEl = root.querySelector("[data-imdrf-sentinel]");
    var breadcrumbEl = root.querySelector("[data-imdrf-docs-breadcrumb]");
    var annexButtons = root.querySelectorAll("[data-imdrf-annex]");

    var mode = root.getAttribute("data-initial-mode") || "browse";
    var activeAnnex = root.getAttribute("data-initial-annex") || "A";
    var nextCursor = root.getAttribute("data-initial-cursor") || null;
    var searchTimer = null;
    var loading = false;

    var ANNEX_TITLES = {
      A: "Medical Device Problem",
      B: "Type of Investigation",
      C: "Investigation Findings",
      D: "Investigation Conclusion",
      E: "Clinical Signs, Symptoms or Conditions",
      F: "Health Impact",
      G: "Medical Device Component",
    };

    function termCardHtml(row) {
      var crumb = String(row.codeHierarchy || "")
        .split("|")
        .filter(Boolean)
        .join(" › ");
      var statusLower = String(row.status || "").toLowerCase();
      var isQuiet = statusLower.indexOf("retired") !== -1 || statusLower.indexOf("not selectable") !== -1;

      var html =
        '<article class="imdrf-term" id="term-' +
        escapeHtml(row.id) +
        '" data-imdrf-term data-code="' +
        escapeHtml(row.code) +
        '" data-annex="' +
        escapeHtml(row.annex) +
        '">' +
        '<p class="eyebrow">Annex ' +
        escapeHtml(row.annex) +
        " · Level " +
        escapeHtml(row.level) +
        "</p>" +
        '<h3 class="imdrf-term-head"><code class="imdrf-term-code">' +
        escapeHtml(row.code) +
        "</code><span>" +
        escapeHtml(row.term) +
        "</span>";
      if (row.status) {
        html +=
          '<span class="tag' + (isQuiet ? " muted" : "") + '">' + escapeHtml(row.status) + "</span>";
      }
      html += "</h3>";
      if (crumb && crumb !== String(row.code)) {
        html += '<p class="imdrf-term-crumb">' + escapeHtml(crumb) + "</p>";
      }
      if (row.definition) {
        html += '<p class="imdrf-term-definition">' + escapeHtml(row.definition) + "</p>";
      }
      if (row.statusDescription) {
        html += '<p class="hint">' + escapeHtml(row.statusDescription) + "</p>";
      }
      var meta = "";
      if (row.nonImdrfCode) {
        meta += "<div><dt>Non-IMDRF code</dt><dd>" + escapeHtml(row.nonImdrfCode) + "</dd></div>";
      }
      if (row.primaryCategory) {
        meta += "<div><dt>Primary category</dt><dd>" + escapeHtml(row.primaryCategory) + "</dd></div>";
      }
      if (row.secondaryCategory) {
        meta +=
          "<div><dt>Secondary category</dt><dd>" + escapeHtml(row.secondaryCategory) + "</dd></div>";
      }
      if (meta) html += '<dl class="imdrf-term-meta">' + meta + "</dl>";
      html += "</article>";
      return html;
    }

    function setBreadcrumb(text) {
      if (breadcrumbEl) breadcrumbEl.textContent = text;
    }

    function appendRows(rows) {
      if (rows.length === 0 && contentEl.children.length === 0) {
        contentEl.innerHTML =
          '<p class="hint" data-imdrf-empty>' +
          (mode === "search" ? "No matching terms." : "No terms in this annex.") +
          "</p>";
        return;
      }
      var emptyHint = contentEl.querySelector("[data-imdrf-empty]");
      if (emptyHint) emptyHint.remove();
      contentEl.insertAdjacentHTML("beforeend", rows.map(termCardHtml).join(""));
    }

    function resetContent() {
      contentEl.innerHTML = "";
      contentEl.classList.toggle("imdrf-search-results", mode === "search");
    }

    /**
     * Every response that lands is checked against `requestToken` before it's allowed to touch
     * the DOM. A fast typist firing "b", "ba", "bat" in quick succession can have those three
     * requests resolve out of order (a slow "b" landing after a fast "bat"); without this check
     * the stale "b" response would overwrite "bat"'s newer, narrower results. Incrementing the
     * token on every new fetch and comparing it when a response arrives means only the most
     * recently *started* request is ever allowed to render — older ones are silently dropped.
     */
    var requestToken = 0;

    function fetchNextPage() {
      if (loading || !nextCursor) return Promise.resolve();
      loading = true;
      var myToken = ++requestToken;
      var url =
        mode === "search"
          ? "/imdrf/releases/" +
            releaseId +
            "/search?q=" +
            encodeURIComponent(searchInput ? searchInput.value : "") +
            "&cursor=" +
            encodeURIComponent(nextCursor)
          : "/imdrf/releases/" +
            releaseId +
            "/terms?annex=" +
            encodeURIComponent(activeAnnex) +
            "&cursor=" +
            encodeURIComponent(nextCursor);

      return fetch(url)
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (myToken !== requestToken) return; // a newer request has since started; drop this one
          appendRows(data.rows);
          nextCursor = data.nextCursor;
          loading = false;
        })
        .catch(function () {
          if (myToken === requestToken) loading = false;
        });
    }

    function loadAnnex(annex, opts) {
      mode = "browse";
      activeAnnex = annex;
      nextCursor = null;
      resetContent();
      setBreadcrumb("Annex " + annex + " · " + (ANNEX_TITLES[annex] || ""));
      contentEl.scrollIntoView({ block: "start" });
      if (!opts || opts.pushState !== false) {
        history.pushState(
          { imdrfAnnex: annex },
          "",
          "/imdrf?release=" + releaseId + "&annex=" + encodeURIComponent(annex),
        );
      }

      loading = true;
      var myToken = ++requestToken;
      fetch("/imdrf/releases/" + releaseId + "/terms?annex=" + encodeURIComponent(annex))
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (myToken !== requestToken) return;
          appendRows(data.rows);
          nextCursor = data.nextCursor;
          loading = false;
        })
        .catch(function () {
          if (myToken === requestToken) loading = false;
        });
    }

    function runSearch(query, opts) {
      mode = "search";
      nextCursor = null;
      resetContent();
      setBreadcrumb('Search results for "' + query + '"');
      if (!opts || opts.pushState !== false) {
        history.pushState(
          { imdrfQuery: query },
          "",
          "/imdrf?release=" + releaseId + "&q=" + encodeURIComponent(query),
        );
      }

      loading = true;
      var myToken = ++requestToken;
      fetch("/imdrf/releases/" + releaseId + "/search?q=" + encodeURIComponent(query))
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (myToken !== requestToken) return; // a newer keystroke's search has since started
          appendRows(data.rows);
          nextCursor = data.nextCursor;
          loading = false;
        })
        .catch(function () {
          if (myToken === requestToken) loading = false;
        });
    }

    // Sidebar annex links are real `<a href>`s (so "Overview" → an annex → back works with plain
    // navigation and no JS at all). When the browse/search content area is already on the page —
    // i.e. we're not on the Overview landing page — intercept the click for a fast client-side
    // switch instead of a full reload; on the Overview page (no `contentEl`) the click falls
    // through to the browser's normal navigation.
    annexButtons.forEach(function (btn) {
      btn.addEventListener("click", function (event) {
        if (!contentEl) return; // Overview page: let the link navigate normally
        event.preventDefault();
        annexButtons.forEach(function (b) {
          b.classList.remove("on");
        });
        btn.classList.add("on");
        if (searchInput) searchInput.value = "";
        loadAnnex(btn.getAttribute("data-imdrf-annex"));
        closeMobileNav();
      });
    });

    if (searchInput) {
      searchInput.addEventListener("input", function () {
        var query = searchInput.value;
        if (searchTimer) clearTimeout(searchTimer);
        if (query.trim() === "") {
          loadAnnex(activeAnnex);
          return;
        }
        searchTimer = setTimeout(function () {
          runSearch(query);
        }, 250);
      });
    }

    /* Mobile documentation menu: the sidebar (`.imdrf-docs-nav`) is hidden below 900px and
     * replaced by a toggle button that reveals it as a collapsible menu — never a permanently
     * visible desktop sidebar squeezed onto a phone screen. */
    var navToggle = root.querySelector("[data-imdrf-nav-toggle]");
    var navEl = root.querySelector(".imdrf-docs-nav");

    function closeMobileNav() {
      if (navEl) navEl.classList.remove("open");
      if (navToggle) navToggle.setAttribute("aria-expanded", "false");
    }

    if (navToggle && navEl) {
      navToggle.addEventListener("click", function () {
        var open = navEl.classList.toggle("open");
        navToggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }

    if (sentinelEl && "IntersectionObserver" in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) fetchNextPage();
        });
      });
      observer.observe(sentinelEl);
    }

    /** Resolves a `?term=<uuid>` deep link: scrolls it into view if it's already on the
     *  server-rendered first page, otherwise fetches it directly and inserts it before scrolling. */
    function resolveDeepLinkedTerm(termId) {
      var existing = document.getElementById("term-" + termId);
      if (existing) {
        existing.scrollIntoView({ block: "start" });
        return;
      }
      fetch("/imdrf/releases/" + releaseId + "/terms/" + encodeURIComponent(termId))
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (term) {
          if (!term) return;
          contentEl.insertAdjacentHTML("afterbegin", termCardHtml(term));
          var inserted = document.getElementById("term-" + termId);
          if (inserted) inserted.scrollIntoView({ block: "start" });
        })
        .catch(function () {
          /* deep link couldn't be resolved; the page is still usable without it */
        });
    }

    // Back/Forward after a client-side annex switch or search: re-derive state from the URL
    // rather than trusting `event.state`, since a user can also arrive here via a plain link.
    window.addEventListener("popstate", function () {
      if (!contentEl) return; // came from the Overview page originally; a full reload already happened
      var params = new URLSearchParams(window.location.search);
      var q = params.get("q");
      var annex = params.get("annex");
      if (q) {
        if (searchInput) searchInput.value = q;
        runSearch(q, { pushState: false });
      } else if (annex) {
        if (searchInput) searchInput.value = "";
        loadAnnex(annex, { pushState: false });
      }
    });

    var params = new URLSearchParams(window.location.search);
    var deepLinkedTerm = params.get("term");
    if (deepLinkedTerm) resolveDeepLinkedTerm(deepLinkedTerm);
  });
})();
```

- [ ] **Step 2: Typecheck / lint the JS (this repo lints server code, not this plain
  `public/*.js` file, per existing convention — no `.eslintrc` override needed here;
  confirm by checking whether `imdrf-browser.js`'s previous version was covered by any
  lint script before assuming otherwise)**

Run: `pnpm --dir server lint` (per this repo's known pre-existing CRLF lint failures on
~14 unrelated files — see project memory — treat only *new* failures introduced by this
file as blocking, not the pre-existing ones)

- [ ] **Step 3: Manual verification in the browser**

Start the dev server, sign in as any staff role, open `/imdrf`. Confirm:
- The sidebar lists annexes A–G with counts; clicking one switches the reading pane and
  updates the breadcrumb.
- Typing in the search box (e.g. "batt") debounces ~300ms then shows ranked results
  with a "Search results for…" breadcrumb; clearing it returns to the previously
  active annex.
- Scrolling to the bottom of a long annex or search result list loads more rows via the
  sentinel, with no duplicate or missing rows at the page boundary.
- Visiting `/imdrf?annex=E&term=<a-real-term-uuid>` scrolls that term into view (test
  with both a term on the first page and one far enough down that it isn't).

- [ ] **Step 4: Commit**

```bash
git add server/public/imdrf-browser.js
git commit -m "feat(imdrf): rewrite client script for docs-style browse/search/deep-link"
```

---

### Task 8: Replace the old reader CSS

**Files:**
- Modify: `server/public/app.css:3249-3577` (the entire `/* ---------- IMDRF
  terminology ---------- */` block, up to but not including `.imdrf-admin` at line
  3579 — the admin door's styles are untouched)

**Interfaces:**
- Produces: `.imdrf-search`, `.imdrf-docs`, `.imdrf-docs-nav`, `.imdrf-annex(.on)`,
  `.imdrf-annex-code/-name/-count`, `.imdrf-docs-main`, `.imdrf-docs-breadcrumb`,
  `.imdrf-content`, `.imdrf-term`, `.imdrf-term-head/-crumb/-def/-meta`,
  `.imdrf-sentinel` — the exact class names Task 6's view and Task 7's script emit.

- [ ] **Step 1: Replace the CSS block**

In `server/public/app.css`, replace everything from the `/* ---------- IMDRF
terminology ---------- */` comment (currently line 3249) through the end of
`.imdrf-entry-meta dd { ... }` (currently line 3577) — i.e. everything before
`.imdrf-admin {` — with:

```css
/* ---------- IMDRF terminology ---------- */
/*
 * A documentation reader, not a database browser or a second rail.
 *
 * The title bar still carries only the page name (same 56px bar as every other staff page).
 * `.staff-head` introduces the published document; year switching, when there is more than one
 * release, reuses `.wl-tabs`. Below that: a sticky annex sidebar (docs-style left nav) and a
 * reading pane that scrolls with the page — no inner bounded-height scroll pane, unlike the old
 * two-pane tree/detail layout this replaces.
 */
.imdrf-search {
  width: 320px;
  max-width: 100%;
  padding: 7px 11px;
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  background: var(--card);
}

.imdrf-search:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 1px;
}

.imdrf-docs {
  display: grid;
  grid-template-columns: minmax(200px, 260px) minmax(0, 1fr);
  gap: 22px;
  align-items: start;
}

.imdrf-docs-nav {
  position: sticky;
  top: 76px;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  border: 1px solid var(--rule);
  border-radius: var(--r);
  background: var(--paper);
}

/* Mobile-only toggle for the annex list — hidden on desktop, where the sidebar is always
 * visible. See the `@media (max-width: 900px)` block below for its shown state. */
.imdrf-nav-toggle {
  display: none;
  margin-bottom: 12px;
  padding: 8px 14px;
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  background: var(--card);
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.imdrf-annex {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  border-bottom: 1px solid var(--rule);
  background: transparent;
  color: var(--ink-2);
  text-align: left;
  cursor: pointer;
}

.imdrf-annex:last-child {
  border-bottom: 0;
}

.imdrf-annex:hover {
  background: #eef2ee;
  color: var(--ink);
}

.imdrf-annex.on {
  background: var(--green-bg);
  color: var(--green-d);
  font-weight: 600;
}

.imdrf-annex:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: -2px;
}

.imdrf-annex-code {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
}

.imdrf-annex-name {
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.3;
}

.imdrf-annex-count {
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-3);
  font-weight: 500;
}

.imdrf-annex.on .imdrf-annex-count {
  color: var(--green-d);
  opacity: 0.75;
}

/* The "Overview" nav entry has only a name span, not code/count — let it span the full row
 * instead of collapsing into the 22px code column the 3-column grid otherwise reserves for it. */
.imdrf-annex-name:only-child {
  grid-column: 1 / -1;
}

/* Overview (landing) page: release description + the annex list as documentation nav cards —
 * compact rows, not the huge-button/card/table layouts the spec explicitly rules out. */
.imdrf-overview-annexes {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 16px;
}

.imdrf-overview-annex {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid var(--rule);
  border-radius: var(--r);
  color: inherit;
  text-decoration: none;
}

.imdrf-overview-annex + .imdrf-overview-annex {
  margin-top: 2px;
}

.imdrf-overview-annex:hover {
  border-color: var(--green);
  background: var(--green-bg);
}

.imdrf-overview-annex .imdrf-annex-code {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--green-d);
}

.imdrf-overview-annex .imdrf-annex-count {
  font-size: 12px;
  color: var(--ink-3);
}

.imdrf-docs-main {
  min-width: 0;
}

.imdrf-docs-breadcrumb {
  position: sticky;
  top: 56px;
  z-index: 20;
  margin: 0 0 14px;
  padding: 10px 0;
  background: var(--paper);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--ink-3);
  border-bottom: 1px solid var(--rule);
}

.imdrf-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.imdrf-term {
  padding: 16px 20px;
  border: 1px solid var(--rule);
  border-radius: var(--r);
  background: var(--card);
  scroll-margin-top: 96px;
}

.imdrf-term:target {
  border-color: var(--green);
  outline: 2px solid var(--green-bg);
  outline-offset: 2px;
}

.imdrf-term-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px;
  margin: 4px 0 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.35;
}

.imdrf-term-code {
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--green-d);
  background: var(--green-bg);
  padding: 2px 6px;
  border-radius: 4px;
}

.imdrf-term-crumb {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink-3);
  margin: 8px 0 0;
}

.imdrf-term-definition {
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--ink);
  text-wrap: pretty;
  max-width: 68ch;
  margin: 10px 0 0;
}

.imdrf-term-meta {
  display: grid;
  gap: 10px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--rule);
  max-width: 68ch;
}

.imdrf-term-meta dt {
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-3);
  font-weight: 500;
}

.imdrf-term-meta dd {
  font-size: 13.5px;
  color: var(--ink-2);
}

.imdrf-sentinel {
  height: 1px;
}

@media (max-width: 900px) {
  /* Mobile is a real documentation menu, not a shrunken desktop sidebar: the annex list is
   * collapsed behind a toggle button by default, and expands as a full-width dropdown menu when
   * opened — never a permanently visible column squeezed next to the reading pane. */
  .imdrf-nav-toggle {
    display: block;
  }

  .imdrf-docs {
    grid-template-columns: 1fr;
  }

  .imdrf-docs-nav {
    display: none;
    position: static;
    max-height: none;
    flex-direction: column;
    width: 100%;
    margin-bottom: 16px;
  }

  .imdrf-docs-nav.open {
    display: flex;
  }

  .imdrf-annex {
    width: 100%;
  }
}

```

- [ ] **Step 2: Visual check**

Reload `/imdrf` in the browser (Task 7's manual check already covers this — do this
step alongside it, not as a separate pass): confirm the sidebar, breadcrumb, and cards
render without unstyled flashes, in both the light theme this door already uses and at
a narrow (≤900px) viewport width.

- [ ] **Step 3: Commit**

```bash
git add server/public/app.css
git commit -m "feat(imdrf): style the docs-style sidebar, breadcrumb and card layout"
```

---

### Task 9: Finish updating the test files

**Files:**
- Modify: `server/tests/integration/staff-imdrf-readonly.test.ts` (remove the two
  tree/`parentId`-listing tests; fix the remaining pre-existing tests' assertions to
  match the new `TermRow` shape and page markup)
- Modify: `server/tests/integration/imdrf-query-pagination.test.ts` (replace the
  root/children pagination cases with flat-annex ones; add a search-cursor pagination
  case)

**Interfaces:**
- Consumes: everything from Tasks 3–6. No new interfaces produced — this task only
  brings the test suite back to fully green.

- [ ] **Step 1: Remove the two tree/`parentId` tests from `staff-imdrf-readonly.test.ts`**

Delete these two `it(...)` blocks entirely (they test the `listTerms` tree branch,
which Task 4 removed):
- `"lists only root terms with parentId absent, and exactly a term's own children with parentId set"`
- `"retrieves a hierarchy deeper than 3 levels with the correct level, making no depth-3 assumption"`

(The second one also exercises `GET .../terms/:id` — but only incidentally, to reach a
level-4 term. Since `getTerm` itself is unchanged and still tested by the "a retired
term still appears in browse and search" test's `detail` assertion later in this file,
no coverage of `getTerm` itself is lost by removing this one.)

- [ ] **Step 2: Fix the remaining pre-existing tests**

The `"a published release's terms are visible..."` test currently asserts
`json<{ rows: unknown[] }>(res).rows` has length 1 after listing `?annex=A` with one
seeded root term — this still holds true unchanged (flat listing of one term returns
one row); no edit needed.

The `"switching release id..."` test only reads `.code` off rows — unaffected by the
`TermRow` shape change; no edit needed.

The `"paginates: nextCursor is set..."` test seeds 60 flat root terms and pages
`?annex=A` — unaffected by flattening (there were no children in this seed to begin
with); no edit needed.

The `"renders a documentation reader..."` test was already replaced by Task 6's Step 1
— confirm it's the sidebar/breadcrumb/anchor version, not the old
`imdrf-reader`/`imdrf-toc` one.

- [ ] **Step 3: Run the full integration file**

Run: `pnpm --dir server test:integration -- tests/integration/staff-imdrf-readonly.test.ts`
Expected: every test PASSES.

- [ ] **Step 4: Replace `imdrf-query-pagination.test.ts`'s root/children cases**

In `server/tests/integration/imdrf-query-pagination.test.ts`, replace the four
existing `it(...)` blocks (`"visits every row exactly once..."`,
`"does the same for search results..."`, `"resumes exactly at the boundary..."`,
`"treats a malformed cursor..."`) — all of which call `listTerms(..., { parentId: null,
... })`, a shape `listTerms` no longer accepts — with:

```ts
    it("visits every row exactly once across pages when many rows share one sort_order", async () => {
      const releaseId = await seedRelease();
      const expected = await seedDuplicateSortOrder(releaseId, 9);

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = await listTerms(owner.db, { releaseId, annex: "A", limit: 2, cursor });
        seen.push(...page.rows.map((r) => r.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }

      expect(seen).toHaveLength(9);
      expect(new Set(seen)).toEqual(expected); // no duplicate, no skip
    });

    it("does the same for search results sharing one sort_order", async () => {
      const releaseId = await seedRelease();
      const ids = new Set<string>();
      for (let i = 0; i < 7; i++) {
        const rows = await owner.db.execute(sql`
          INSERT INTO imdrf_terms (release_id, annex, code, term, code_hierarchy, level, sort_order)
          VALUES (${releaseId}, 'A', ${`A${i}`}, ${`Widget ${i}`}, ${`A${i}`}, 1, 0)
          RETURNING id
        `);
        ids.add((rows[0] as { id: string }).id);
      }

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = await searchTerms(owner.db, { releaseId, query: "widget", limit: 2, cursor });
        seen.push(...page.rows.map((r) => r.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }

      expect(seen).toHaveLength(7);
      expect(new Set(seen)).toEqual(ids);
    });

    it("resumes exactly at the boundary a cursor names, including ties on the same sort_order", async () => {
      const releaseId = await seedRelease();
      await seedDuplicateSortOrder(releaseId, 5);

      const first = await listTerms(owner.db, { releaseId, annex: "A", limit: 2 });
      expect(first.rows).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await listTerms(owner.db, {
        releaseId,
        annex: "A",
        limit: 3,
        cursor: first.nextCursor as string,
      });

      const firstIds = new Set(first.rows.map((r) => r.id));
      for (const row of second.rows) expect(firstIds.has(row.id)).toBe(false);
      expect(first.rows.length + second.rows.length).toBe(5);
    });

    it("treats a malformed cursor as the start rather than erroring or skipping rows", async () => {
      const releaseId = await seedRelease();
      await seedDuplicateSortOrder(releaseId, 3);

      const fromStart = await listTerms(owner.db, { releaseId, annex: "A", limit: 10 });
      const withGarbageCursor = await listTerms(owner.db, {
        releaseId,
        annex: "A",
        limit: 10,
        cursor: "not-a-real-cursor",
      });

      expect(new Set(withGarbageCursor.rows.map((r) => r.id))).toEqual(
        new Set(fromStart.rows.map((r) => r.id)),
      );
    });

    it("search-cursor pagination visits every ranked row exactly once, in non-increasing score order", async () => {
      const releaseId = await seedRelease();
      const ids = new Set<string>();
      for (let i = 0; i < 12; i++) {
        const rows = await owner.db.execute(sql`
          INSERT INTO imdrf_terms (release_id, annex, code, term, code_hierarchy, level, sort_order, definition)
          VALUES (${releaseId}, 'A', ${`A${i}`}, ${`Battery Widget ${i}`}, ${`A${i}`}, 1, ${i}, 'A battery-powered widget.')
        `);
        ids.add((rows[0] as { id: string }).id);
      }

      const seen: string[] = [];
      const scores: number[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = await searchTerms(owner.db, { releaseId, query: "battery", limit: 3, cursor });
        seen.push(...page.rows.map((r) => r.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }

      expect(seen).toHaveLength(12);
      expect(new Set(seen)).toEqual(ids);
    });
```

(This file's existing top-level `seedDuplicateSortOrder` helper inserts rows with
`code`s like `A0`, `A1`, ... and `term`s like `Term 0`, `Term 1` — unaffected by
anything in this plan; no change needed to that helper itself.)

- [ ] **Step 5: Run the full pagination test file**

Run: `pnpm --dir server test:integration -- tests/integration/imdrf-query-pagination.test.ts`
Expected: every test PASSES.

- [ ] **Step 6: Run the entire server test suite**

Run: `pnpm --dir server test`
Expected: PASS — this is the unit-test config (`vitest.config.ts`); it also matches
`tests/integration/**` by its glob, but every integration file's
`describe.skipIf(!INTEGRATION_ENABLED)` reports those as skipped here (this config
doesn't load `TEST_DATABASE_URL`/`TEST_APP_DATABASE_URL`), not failed.

Run: `pnpm --dir server test:integration`
Expected: PASS, with every test actually executed (not skipped) — this is the config
that loads the test database env vars. If this run instead reports skips, the test
database isn't configured in this environment; resolve that before treating this task
as done, per this repo's own `requireTestDatabase`/`INTEGRATION_ENABLED` convention.

Run: `pnpm --dir server typecheck`
Expected: no errors anywhere in `server/`.

- [ ] **Step 7: Commit**

```bash
git add server/tests/integration/staff-imdrf-readonly.test.ts server/tests/integration/imdrf-query-pagination.test.ts
git commit -m "test(imdrf): finish updating tests for flat listing and ranked search"
```

---

### Task 10: Verify against the real 2026 dataset, not just seeded mock rows

**Files:** none modified — this task is verification only. If it surfaces a real
problem (a bad ranking case, a slow query, a broken layout at real data volume), open
a follow-up task rather than reopening earlier ones from inside this checklist.

**Interfaces:** none — exercises the whole system built by Tasks 1–9 end-to-end.

The integration tests in Tasks 1–9 all seed a handful of synthetic rows, which proves
correctness but not real-world behavior — the actual 2026 release has thousands of
terms across 7 annexes, per the spec's explicit requirement (§45) not to test only
against one or two mock rows.

- [ ] **Step 1: Import the real workbook into a published test release**

Using the existing (untouched) admin import/staging flow — sign in as an
administrator, go to the IMDRF admin door, upload
`docs/TMDA files for reference/imdrf-tech-ae-terminologies-n43-ReleaseNumber2026-Annexes-revised 1 (1).XLSX`
(the actual source file already in this repo), preview it, confirm the import, then
publish the resulting release. This exercises the untouched import pipeline as a side
effect and gives the reader real volume to test against — do not seed thousands of
synthetic rows by hand instead.

- [ ] **Step 2: Verify the overview page doesn't fetch term data**

Open browser devtools' Network tab, navigate to `/imdrf` (no `annex`/`q` param).
Confirm: no request to `.../terms` or `.../search` fires — the overview page is
release/annex-summary metadata only, never term rows (spec §12, §45).

- [ ] **Step 3: Verify annex browsing pages a large annex correctly**

Open the largest annex (Annex E has ~1000+ rows in the real 2026 workbook). Confirm:
the initial page is small (`TERMS_PAGE_LIMIT`, currently 50 — not the whole annex),
scrolling to the bottom triggers exactly one more request per page reached (watch the
Network tab for duplicate/overlapping requests while scrolling quickly), and no
request ever asks for more than one page's worth of rows.

- [ ] **Step 4: Verify search quality against the real dataset**

Run each of these through the search box and confirm the results are sensible (the
genuinely relevant term appears within the first few results, not buried or absent):
`battery`, `batt`, `batery`, `battery device`, `device battery`, a real code from the
imported data (e.g. `G02002` if present, or any code visible in Annex G), and a very
short query like `a` or `ab` (confirm this does **not** return a huge, low-relevance
result list — this is what `SHORT_QUERY_SCORE_FLOOR` from Task 3 exists to prevent).

If any of these are poor, adjust `SEARCH_SCORE_FLOOR`/`SHORT_QUERY_SCORE_FLOOR`/
`SHORT_QUERY_MAX_LENGTH` in `query-service.ts` and re-test — these constants were
explicitly called out in the spec as needing real-data tuning, not as fixed final
values.

- [ ] **Step 4b: Prove the indexes are actually used, not just present**

Creating a GIN index is not the same claim as "this query uses it" — verify it
directly. Connect to the dev/test database with the real 2026 data loaded (`psql
$DATABASE_URL` or the client of your choice) and run `EXPLAIN (ANALYZE, BUFFERS)` in
front of `searchTerms`'s actual query body (copy it from `query-service.ts`,
substituting a real `release_id` and a representative query like `'battery'`):

```sql
EXPLAIN (ANALYZE, BUFFERS)
WITH q AS (
  SELECT to_tsquery('english', 'battery:*') AS tsq
)
SELECT * FROM (
  SELECT t.id, t.code, t.term,
    round(GREATEST(
      COALESCE(ts_rank(t.search_vector, q.tsq), 0),
      similarity(t.code, 'battery'),
      similarity(t.term, 'battery'),
      word_similarity('battery', coalesce(t.definition, ''))
    )::numeric, 6) AS score
  FROM imdrf_terms t, q
  WHERE t.release_id = '<a real release id>'
    AND (
      (q.tsq IS NOT NULL AND t.search_vector @@ q.tsq)
      OR t.code % 'battery'
      OR t.term % 'battery'
      OR t.definition %> 'battery'
    )
) ranked
WHERE ranked.score > 0.15
ORDER BY ranked.score DESC, ranked.id ASC
LIMIT 26;
```

Confirm the plan shows a **Bitmap Index Scan** (or plain **Index Scan**) against
`imdrf_terms_search_vector_idx`, `imdrf_terms_code_trgm_idx`,
`imdrf_terms_term_trgm_idx`, or `imdrf_terms_definition_trgm_idx` feeding a **BitmapOr**
— not a **Seq Scan** over `imdrf_terms` as the query's first step. A sequential scan
here means the candidate-retrieval predicate isn't actually index-backed for this data
distribution (common causes: `pg_trgm.similarity_threshold`/
`pg_trgm.word_similarity_threshold` GUCs set so permissively that the planner decides a
seq scan is cheaper, or a release small enough that Postgres's own cost estimate
prefers a seq scan regardless — check `EXPLAIN`'s row-count estimate against the
release's actual ~2,133 rows to tell which). If it's a seq scan for the wrong reason,
adjust the query or those GUCs and re-run this step until the plan shows index usage.

- [ ] **Step 5: Verify mobile layout at real content volume**

Resize the browser to a phone-width viewport (or use devtools' device emulation) on
both the overview page and a real annex page. Confirm: no horizontal overflow, the
annex nav is collapsed behind the toggle button and opens/closes correctly, text is
readable without zooming, and cards don't overflow their container.

- [ ] **Step 6: Verify a deep link into the real dataset**

Pick a term several pages deep into a large annex (not on the first page), construct
its `/imdrf?release=<id>&annex=<annex>&term=<uuid>` URL, open it in a fresh tab.
Confirm the term is fetched and scrolled into view even though it wasn't part of the
server-rendered first page.

- [ ] **Step 7: Record findings**

If Steps 1–6 all pass cleanly, note that in this task's commit message. If any tuning
was needed (Step 4's constants, page size, debounce timing), commit that change here
with a message explaining what real-data behavior motivated it.

```bash
git add server/src/domain/imdrf/query-service.ts
git commit -m "test(imdrf): tune search thresholds against the real 2026 dataset"
```

(Only commit if Step 4 actually required a constant change — otherwise this task adds
no diff, and there is nothing to commit.)

---

## Post-implementation check

After Task 9, re-read
`docs/superpowers/specs/2026-09-13-imdrf-docs-search-redesign-design.md` once more and
confirm every numbered correction from the user's review is actually reflected in the
shipped code, not just the spec text:

1. Anchors are `id="term-<uuid>"` in both `views/imdrf.tsx` (Task 6) and
   `imdrf-browser.js` (Task 7) — never `id="<code>"`.
2. `views/imdrf.tsx`'s server render never attempts to read a `#hash` fragment (it
   can't — fragments never reach the server); only `imdrf-browser.js`'s
   `resolveDeepLinkedTerm` (Task 7) reads `?term=<uuid>` client-side.
3. `getTerm` and `GET .../terms/:id` are untouched in `query-service.ts` and
   `routes/imdrf.tsx` — grep both files for `getTerm` and confirm the function body and
   route handler are byte-for-byte what they were before this plan started.
4. `searchTerms`'s SQL rounds its score to 6 decimal places before it's ordered on or
   returned (Task 3), and `SearchCursor`'s `roundScore` (Task 2) applies the identical
   rule client-side.
5. `listTerms`'s cursor is still `Cursor`/`encodeCursor`/`decodeCursor` over
   `(sort_order, id)` — grep confirms these three names and their bodies are unchanged
   from before Task 4.
