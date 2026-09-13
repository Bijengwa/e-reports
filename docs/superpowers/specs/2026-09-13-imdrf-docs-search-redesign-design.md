# IMDRF terminology: documentation-app navigation + indexed fuzzy search

## Status

**Supersedes** `2026-09-13-imdrf-reader-redesign-design.md` (the flat, infinite-scroll,
no-permalink reader). That spec was never implemented — the live app is still the
two-pane tree/detail browser from commit `3c7015c`. This spec replaces both the live
two-pane browser and the unimplemented flat-reader plan with a documentation-app-style
layout, and separately overhauls search from `ILIKE` to a ranked, typo-tolerant query.

## Goal

Two independent but co-shipped changes to the read-only IMDRF terminology door
(`/imdrf`, staff-only, every signed-in role):

1. **Navigation model**: replace the two-pane tree/detail browser with a
   documentation-site-style layout — sticky annex sidebar, breadcrumb context, a
   flowing per-annex reading document, and deep-linkable anchors — built entirely from
   e-reports' existing design system (`StaffShell`, existing CSS custom properties,
   `.wl-tabs`). No OpenAI/Claude/Anthropic branding, colors, or components are copied;
   only the *structural* patterns (search-first, breadcrumbs, progressive disclosure,
   clean reading area, fast related-content navigation) are borrowed.
2. **Search**: replace the plain `ILIKE '%q%'` scan with a ranked, indexed search that
   tolerates partial words, missing words, reordered words, minor typos, and matches by
   code, term, or definition — without loading the release into the browser and without
   changing the release-isolation or performance guarantees `query-service.ts` already
   documents.

## Framing

This is not "turn the tree into a prettier infinite-scroll list." It's turning IMDRF
into a documentation/reference application. Infinite scroll is an implementation detail
of pagination underneath the reader — not the point. The experience being built is
**navigation → context → terminology → search → reading**, not **database → rows →
expand → rows**. Every decision below (sidebar nav, breadcrumbs, deep links, ranked
search) serves that experience; none of it is decoration on top of the old tree browser.

## Explicitly out of scope

- Status / MedDRA-mapping / "hide retired" sidebar filters from the reference mockup.
  Confirmed with the user: this pass ships navigation + search only; filters are a
  follow-up.
- The admin import/staging subsystem (`imdrf-admin.tsx` and friends) — untouched.
- Multi-release switching — untouched, stays exactly as it is today (`.wl-tabs`).
- Any external search infrastructure (Elasticsearch, Meilisearch, Algolia, Redis) — not
  needed; Postgres's own `pg_trgm` + full-text search cover every stated requirement.
- Surfacing the source workbook's own per-annex "Annex Description"/"Annex
  Instructions" text (present in every sheet's header rows but currently discarded by
  `parser.ts`) in the new breadcrumb/annex header. The hardcoded `ANNEX_TITLES` map
  stays as-is for this pass; pulling in the workbook's own copy is a natural follow-up,
  confirmed deferred with the user.

## Part 1 — Navigation & page architecture

### Layout, top to bottom

1. `.staff-head` (title/eyebrow/term count) — unchanged.
2. Release-year tabs (`.wl-tabs`), only when more than one published release —
   unchanged, stays above the reader.
3. Search box, prominent, in the sticky top region — the primary entry point into the
   page (search-first), not a secondary filter buried in a sidebar.
4. Below that: a two-column region —
   - **Left**: sticky annex sidebar (A–G), same labels/counts as today
     (`ANNEX_TITLES`), docs-style left nav. Clicking an annex navigates to
     `?annex=X` (server-rendered initial state) and highlights the active entry.
   - **Right**: the reading pane. In **browse mode**, this is one annex rendered as a
     flowing document in `sort_order` order (the workbook's own document order,
     already interleaving parents with children — see `parser.ts`). In **search
     mode** (a non-empty `q`), this becomes a ranked results list instead, each result
     annotated with its annex + hierarchy breadcrumb so its context is clear even
     outside its home annex page.
5. A breadcrumb line (`Annex X · Section title`) above the reading pane, reflecting
   either the active annex (browse mode) or "Search results for '…'" (search mode).

### Content model

- **One page per annex, not per term.** A term is a position within its annex's
  document, not a standalone routable concept — matching how IMDRF itself structures
  the workbook (per-annex sheets, hierarchical rows).
- **`GET /imdrf/releases/:releaseId/terms/:id` and `getTerm` are kept, unchanged.**
  The new reading pane doesn't call them — a term is rendered as part of its annex
  document, not fetched singly — but they stay as a working, isolated, read-only API:
  useful for future F004 integration, links from other e-reports modules, direct term
  retrieval, or export/reporting features. There is no cost to keeping a working
  endpoint the new UI simply doesn't happen to use, and deleting it would foreclose
  those uses for no benefit to this change. (This reverses this spec's earlier
  position, which proposed deleting both — corrected after review.)
- **Progressive disclosure via typography, not JS collapse/expand.** Level-1/2 category
  headers render with heavier weight/less indent than leaf terms, so the hierarchy
  reads as a document outline. Nothing expands or collapses — simpler than the old
  tree's toggle state, and matches "clean reading area" over interactive-widget
  chrome.
- **Anchors are keyed by term id, not by `code`.** IMDRF's own data reuses a code
  across more than one hierarchy position within an annex — Annex E alone cross-lists
  roughly 200 terms under multiple category branches, e.g. `E0104` appears at two
  different positions deliberately (see migration `0020`'s rationale; that's exactly
  why `(release_id, code, code_hierarchy)` rather than `(release_id, code)` is this
  table's real uniqueness key). A DOM anchor of literal `#E0104` would be ambiguous —
  it could resolve to either occurrence. Each term's rendered block instead gets
  `id="term-<uuid>"` (the term's own primary key, always unique), with the human-
  readable code shown as visible text alongside it, not as the identity the anchor
  relies on.
- **Deep links.** The `release` and `annex` query params are ordinary query params, so
  the server renders the correct initial annex document from the URL alone. A `#hash`
  fragment is *not* sent to the server by the browser — this is not "server-rendered
  from the URL alone" for the fragment part, and the spec's earlier wording claiming
  that was wrong. Concretely:
  - `/imdrf?release=<id>&annex=A` — server renders annex A's first page directly.
  - `/imdrf?release=<id>&annex=E&term=<term-uuid>#E0104` — server still renders from
    `release`/`annex` alone (the fragment plays no part in that render); client-side JS
    reads `term` (a real, unambiguous database id) on page load, and if that term
    isn't already in the loaded page(s), fetches it via the kept `GET
    .../terms/:id` and either inserts/scrolls it into view or fetches subsequent
    annex pages until it's present, then scrolls `#term-<uuid>` into view. The `#E0104`
    hash is purely a human-readable label alongside `term=<uuid>` for shareable-link
    readability — resolution always goes through the id, never the hash text.
  - `/imdrf?release=<id>&q=battery` — search mode, results ranked and rendered
    server-side on first load; client JS takes over for the debounced typeahead
    thereafter.
- **Infinite scroll retained** for the per-annex document and for search results,
  using the existing pattern (`IntersectionObserver` on a sentinel, `nextCursor`-driven
  page fetches) — annexes still run into the thousands of rows, so nothing here loads
  a full annex at once. This is pagination plumbing in service of the reading
  experience, not the feature itself.

## Part 2 — Search algorithm

### Why a hybrid of full-text search and trigram similarity

Requirements: partial words, missing words, reordered words, minor typos, search by
code/term/definition, ranked relevance, no client-side dataset download, respects
existing pagination/release-isolation architecture.

- **Full-text search alone** (`tsvector`/`tsquery`) handles missing/reordered words and
  gives a principled relevance rank (`ts_rank`), but has **no typo tolerance** —
  "batery" matches nothing.
- **Trigram similarity alone** (`pg_trgm`) handles typos and partial words well, but its
  score degrades against long definition text and it has no native concept of "matched
  3 of 3 query words" outranking "matched 1 of 3."
- **Together**: FTS finds and ranks genuine multi-word matches; trigram similarity is
  the fallback signal that catches what FTS's exact-lexeme matching misses (typos,
  very short/partial fragments). Both ship in stock PostgreSQL — no new infrastructure.

### Schema (new migration, `00xx_imdrf_terms_search.sql`)

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE imdrf_terms
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(term, '') || ' ' || coalesce(definition, '')), 'A') ||
    setweight(to_tsvector('simple',  coalesce(code, '') || ' ' || coalesce(non_imdrf_code, '')), 'B')
  ) STORED;

CREATE INDEX imdrf_terms_search_vector_idx ON imdrf_terms USING gin (search_vector);
CREATE INDEX imdrf_terms_code_trgm_idx ON imdrf_terms USING gin (code gin_trgm_ops);
CREATE INDEX imdrf_terms_term_trgm_idx ON imdrf_terms USING gin (term gin_trgm_ops);
```

A generated column backfills itself on creation — no data migration step, no importer
change (`import-service.ts` doesn't write this column; Postgres computes it). A
follow-up grants migration (matching `0019`'s pattern) is **not** needed: generated
columns are read through the same `SELECT` grant `ereports_app` already has, and
`similarity()`/`to_tsvector()`/`ts_rank()` are ordinary functions granted to `PUBLIC`
by `pg_trgm`/core Postgres — no new GRANT statements required.

`CREATE EXTENSION` needs a DB role with that privilege; this runs as part of the normal
migration path the same as every `CREATE TABLE` in this history, not through the
restricted `ereports_app` runtime role.

### Query (`domain/imdrf/query-service.ts`, `searchTerms` rewritten)

1. Trim the query; empty/whitespace still short-circuits to `{ rows: [], nextCursor:
   null }` before touching any index — unchanged behavior, still prevents an
   accidental full-release load.
2. Tokenize into up to 8 words (split on whitespace, drop empties). Build a `tsquery`
   that OR's the tokens together, each as a prefix match (`token:*`), so a partial word
   like "batt" prefix-matches "battery" and providing only some of a multi-word term's
   words still returns it — OR (not AND) is what makes "missing words" tolerable,
   while `ts_rank` naturally scores a row matching more of the tokens higher than one
   matching fewer.
3. Compute a per-row score as the greatest of:
   - `ts_rank(search_vector, tsquery)` (normalized to a comparable range) — the
     primary signal for genuine word/prefix matches.
   - `similarity(code, :query)` — catches exact-ish code lookups and typos in codes.
   - `similarity(term, :query)` — catches typos in the term itself (e.g. "batery").
   - `word_similarity(:query, definition)` — catches typos/fragments that only appear
     in the definition text.
4. Keep only rows whose combined score clears a small floor (tuned during
   implementation, starting point `0.15`) so irrelevant rows aren't returned just
   because every row has *some* nonzero trigram similarity to any string.
5. Order by score descending, `id` ascending as the tiebreak.

### Pagination — new cursor shape for search only

`listTerms`'s existing `(sort_order, id)` cursor is **absolutely untouched** — browsing
stays strict document order, no change to its shape, its SQL, or its semantics.
Relevance-ranked search needs its own, separate cursor:

```ts
type SearchCursor = { score: number; id: string };
```

Same opaque base64url encode/decode pattern as today's `Cursor`, just a different
tuple — **but the score must be stored and compared as a fixed-precision value, not a
raw float**, so that JSON-round-tripping the cursor and re-running the same SQL
expression can never disagree about whether two scores are "equal." Concretely: the SQL
that computes the score rounds it to a fixed number of decimal places (e.g.
`round(score::numeric, 6)`), and that rounded value — not an unrounded intermediate —
is both what's ordered on and what's encoded into the cursor. Because the scoring
expression is a pure function of the query text and immutable row data, the same query
re-run with the same rounding always reproduces the identical value for a given row, so
comparing rounded values for equality is safe and introduces no overlap or skipped
rows. The `WHERE` clause for page N+1 is `(score < :afterScore) OR (score =
:afterScore AND id > :afterId)`, using that same rounded score — matching the existing
"total order via a tiebreak" reasoning already documented for the browse cursor.
`release_id = :releaseId` is still the first predicate in every branch, preserving
release isolation exactly as it is today.

### API surface

- `GET /imdrf/releases/:releaseId/search?q=…&cursor=…` — same route, same query
  params, richer ranking under the hood. Response shape (`TermRow[]` + `nextCursor`)
  unchanged in shape, though `TermRow` gains the fields the new reading-pane rendering
  needs (see below).
- `GET /imdrf/releases/:releaseId/terms/:id` (`getTerm`) — **kept, unchanged**. See
  "Content model" above for why; also used by the client to resolve a `term=<uuid>`
  deep link that lands outside the currently-loaded annex page(s).

### `TermRow` grows

Today's shape (`id/annex/code/term/level/hasChildren`) can't render a document-style
entry. New shape, used by both `listTerms` and `searchTerms`:

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

`hasChildren` is dropped — nothing expands/collapses in the new layout. `listTerms`
drops its `parentId` branch entirely (grep confirms the admin door never calls
`listTerms`; the tree branch's only consumer is the browser being replaced) and
becomes annex-only and flat, same as the superseded spec proposed — flat here means
"one `ORDER BY sort_order, id` query," not "no hierarchy shown," since document order
already interleaves parents with children and the new view renders that hierarchy
typographically.

## Frontend

`doors/staff/views/imdrf.tsx`: replace `.imdrf-reader`/`.imdrf-toc`/`.imdrf-doc`
two-pane markup with the sidebar + breadcrumb + reading-pane structure from Part 1.
Server-rendered initial state from the URL's `annex`/`q`/`cursor` params (so a shared
link works without JS, modulo the `term`/`#hash` resolution below, which is
client-side by nature); `public/imdrf-browser.js` rewritten to drive the debounced
search-vs-browse toggle, infinite scroll (two independent cursors — one for the active
annex, one for the active search — never conflated), and — on load, when a `term=<uuid>`
param is present — resolving that id to its `#term-<uuid>` anchor (fetching the term via
the kept `GET .../terms/:id` if it isn't already in a loaded page) and scrolling it into
view.

`public/app.css`: remove `.imdrf-reader`, `.imdrf-toc`, `.imdrf-list`, `.imdrf-row`
(and its `data-depth` variables), `.imdrf-toggle`, `.imdrf-caret`, `.imdrf-children`,
`.imdrf-term-btn`, `.imdrf-doc`, `.imdrf-entry-*`, and the bounded-height
`:has(.imdrf-page)` rules (no inner scroll pane to bound — the page scrolls normally
now). Add the sidebar/breadcrumb/reading-pane/card equivalents, reusing existing
color/spacing tokens — no new palette.

## Tests

`server/tests/unit/imdrf-query-service.test.ts`: add cases for the new
`SearchCursor` encode/decode (mirroring the existing `Cursor` tests), including a case
asserting that two computations of the same score for the same query round to an
identical cursor value (guards the fixed-precision rounding above).

`server/tests/unit/imdrf-query-service.test.ts` or a new
`imdrf-search-ranking.test.ts`: cases proving the ranking behavior against seeded
terms — partial word ("batt" finds "Battery"), typo ("batery" finds "Battery"),
reordered/extra words ("battery device" still surfaces "Battery"-named terms), search
by bare code, empty query returns nothing without a DB scan assertion if feasible.

`server/tests/integration/staff-imdrf-readonly.test.ts`:
- Remove: tree/`parentId`-listing cases (the `listTerms` tree branch is going away).
  The `getTerm`/`GET .../terms/:id` tests are **kept** — that endpoint isn't changing.
- Add: flat annex listing returns parents and children together in `sort_order`
  document order; each rendered term's anchor `id` is `term-<uuid>` (its own id), not
  its `code` — including a case with an Annex-E-style repeated code at two hierarchy
  positions, asserting both occurrences get distinct anchors.
- Keep, re-pointed at the new response shape and ranking: draft-release 404,
  cross-release isolation, search-within-release, retired-term visibility, no-inline-
  styles page-shape assertion.

`server/tests/integration/imdrf-query-pagination.test.ts`: replace root-vs-children
pagination cases with flat-per-annex cases (unchanged from the superseded spec) plus
new search-cursor pagination cases (page 1 → cursor → page 2, no overlap, `nextCursor:
null` on the last page, ordering strictly non-increasing by score across the boundary).

No changes needed in `imdrf-admin.tsx`/`imdrf-admin.test.ts` or the parser/validator
tests — the admin import/staging subsystem does not read `search_vector` or change
based on this work. More generally: this spec touches only the read-only browser door
(`routes/imdrf.tsx`, `views/imdrf.tsx`, `imdrf-browser.js`, `query-service.ts`'s
`listTerms`/`searchTerms`) and one additive migration. The import/staging/admin
pipeline, and anything in F004 or other e-reports workflow modules, is untouched by
this work.
