# IMDRF reader redesign: flat, sticky-bar, infinite-scroll

## Goal

Replace the two-pane tree/detail IMDRF terminology reader (shipped in commit `3c7015c`,
"the UI of the imdrf") with a single flowing column of term cards under a sticky
annex+search bar. No expand/collapse, no side detail pane — every term for the active
annex (or search) renders in full, in document order, loaded a page at a time via
infinite scroll.

This replaces that UI outright, not alongside it. Confirmed with the user.

## Stack (do not deviate)

This app is Fastify + server-rendered TSX + vanilla JS, Postgres via Drizzle's
`db.execute(sql\`...\`)` tagged templates — no client-side React, no Hono, no
Cloudflare D1/Workers bindings. Any code written against `D1Database`,
`.prepare().bind().all()`, or a Hono `router.get` does not belong in this repo; it was a
mismatch introduced by an earlier draft of this plan and must be translated to this
stack's conventions (matching `domain/imdrf/query-service.ts` and
`doors/staff/routes/imdrf.tsx` as they exist today).

## Backend: `domain/imdrf/query-service.ts`

- **`listTerms` becomes annex-only and flat.** Drop the `parentId` parameter and its SQL
  branch entirely — grep confirms the admin door never calls `listTerms`, so the tree
  branch has exactly one consumer (the reader being replaced). The remaining query drops
  `t.parent_term_id IS NULL` and returns every term in the annex:

  ```sql
  SELECT t.id, t.annex, t.code, t.term, t.level, t.sort_order,
         t.definition, t.code_hierarchy, t.status, t.status_description,
         t.non_imdrf_code, t.primary_category, t.secondary_category
    FROM imdrf_terms t
   WHERE t.release_id = ${releaseId}
     AND t.annex = ${annex}
     AND (
       ${afterSortOrder}::int IS NULL
       OR t.sort_order > ${afterSortOrder}
       OR (t.sort_order = ${afterSortOrder} AND t.id > ${afterId})
     )
   ORDER BY t.sort_order, t.id
   LIMIT ${limit + 1}
  ```

  `sort_order` is the workbook's own row order per annex (parser.ts:
  `sourceOrder = 0; … sourceOrder++`), which already interleaves each parent with its
  children in document order — so this is a plain `ORDER BY`, no recursive CTE.
  Pagination keeps the existing composite `(sortOrder, id)` cursor tuple exactly as it
  is today (`encodeCursor`/`decodeCursor` unchanged) — `sort_order` is documented as
  unique only within one annex, not globally, so the tuple comparison stays.

- **`TermRow` grows.** Today's shape (`id/annex/code/term/level/hasChildren`) can't
  render a card. New shape:

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

  `hasChildren` is dropped — nothing expands anymore. `searchTerms` returns the same
  shape (it already searches `code`/`term`/`definition` via `ILIKE`; no query changes
  needed there beyond the wider `SELECT` list and dropping `has_children`).

- **`getTerm` and `GET /imdrf/releases/:releaseId/terms/:id` are deleted together.**
  They're the only two places that serve a single term by id, and both existed solely
  for the detail pane / click-to-expand flow that no longer exists. Grep confirms no
  other file references either.

## Backend: `doors/staff/routes/imdrf.tsx`

- `GET /imdrf/releases/:releaseId/terms`: `parentId` query param removed; `annex` stays
  required. Same `requirePublishedRelease` guard, same 400 on a missing/invalid annex.
- `GET /imdrf/releases/:releaseId/search`: unchanged shape (still `q` + `cursor`), rows
  now carry the fuller `TermRow`.
- `GET /imdrf/releases/:releaseId/terms/:id`: removed.

## Frontend: `doors/staff/views/imdrf.tsx`

Layout top to bottom, following this door's existing conventions (`StaffShell`,
`.staff-head`, `.wl-tabs` release switcher untouched):

1. `.staff-head` (title/eyebrow/term count) — unchanged.
2. Release-year tabs (`.wl-tabs`), only when more than one published release — unchanged,
   stays where it is today, above the reader.
3. New sticky bar: annex buttons (A–G, same labels/counts as today) + one search input.
4. A single `.imdrf-content` container the client fills with cards, plus a sentinel div
   for the `IntersectionObserver`.

The old two-column `.imdrf-reader`/`.imdrf-toc`/`.imdrf-doc` structure is removed.

## Frontend: `public/imdrf-browser.js` (rewritten in place, same filename/opt-in pattern)

- `loadAnnex(annex)`: resets cursor, clears search, fetches page 1, scrolls the content
  container back to its top (small addition beyond the original pasted plan — avoids
  landing mid-list after switching annexes).
- `IntersectionObserver` on the sentinel appends the next page while a `nextCursor`
  exists and no fetch is in flight.
- Search: same 300ms debounce; empty query restores the current annex at page 1 rather
  than clearing to nothing.
- Card rendering includes: code badge, term, status tag (muted styling preserved for
  retired/not-selectable, same condition as today), crumb line (`codeHierarchy` split on
  `|`, shown only when it differs from the bare code — same condition the old detail
  view used), definition, status description, and the metadata `dl` (non-IMDRF code /
  primary / secondary category) when any of those three fields is present — carried over
  unchanged from today's detail view so nothing currently visible is lost.
- All HTML built through the existing `escapeHtml` helper; no inline styles anywhere
  (CSP is `style-src 'self'`).

## CSS: `public/app.css`

- Remove: `.imdrf-reader`, `.imdrf-toc`, `.imdrf-annexes` (old grid version),
  `.imdrf-list`, `.imdrf-row` and its `data-depth` variables, `.imdrf-toggle`,
  `.imdrf-caret`, `.imdrf-children`, `.imdrf-term-btn`, `.imdrf-doc`,
  `.imdrf-entry-code/-term/-crumb/-def/-meta`, and the bounded-height rules
  `.shell:has(.imdrf-page)` / `.main:has(.imdrf-page)` / `.staff-main:has(.imdrf-page)`
  (no more inner scroll pane to bound — the page scrolls normally).
- Add: `.imdrf-topbar` (`position: sticky; top: 56px; z-index: 20`, matching the existing
  `.f4-jump` convention for a second sticky layer under the 56px staff header at
  z-index 30), `.imdrf-annex` buttons, `.imdrf-search`, `.imdrf-content`, `.imdrf-card`
  and its sub-elements, `.imdrf-meta` (renamed/adapted from `.imdrf-entry-meta`),
  `.imdrf-loading`/`.imdrf-empty`, `.imdrf-sentinel`.
- Existing responsive (`@media`) rules for the old layout get replaced with equivalents
  for the new one (narrower search field, single-column card padding).

## Tests

`server/tests/integration/staff-imdrf-readonly.test.ts`:
- Remove: "lists only root terms with parentId absent, and exactly a term's own children
  with parentId set", "retrieves a hierarchy deeper than 3 levels…" (both exercised the
  now-deleted `parentId`/`getTerm` paths).
- Add: a case asserting a flat annex listing returns parents and children together in
  `sort_order` document order (reusing the existing 4-level-deep seed data), and a
  pagination case for the flat query mirroring the existing 60-row one.
- Keep, re-pointed at the new response shape: draft-release 404, cross-release
  isolation, search-within-release, retired-term visibility in browse and search,
  empty/whitespace-query handling, "no inline styles" page-shape assertion (drop its
  `data-imdrf-browser`/`imdrf-reader` string checks if those attribute names change,
  otherwise keep as-is).

`server/tests/integration/imdrf-query-pagination.test.ts`:
- Replace the root-vs-children pagination cases with flat-per-annex cases: page 1 → full
  cursor → page 2 with no overlap → `nextCursor: null` on the last page.

No changes needed in `imdrf-admin.tsx`/`imdrf-admin.test.ts` or
`imdrf-query-service.test.ts` (cursor-helper unit tests are shape-agnostic).

## Explicitly out of scope

- The admin import/staging subsystem (`imdrf-admin.tsx` and friends) — untouched.
- Multi-release switching — untouched, stays exactly as it is today.
- Any full-text-search infrastructure (FTS5/tsvector) — current `ILIKE` scan carries
  over unchanged; only worth revisiting if search latency becomes a real problem on a
  large release.
