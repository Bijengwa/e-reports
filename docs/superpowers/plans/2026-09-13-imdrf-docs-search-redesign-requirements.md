# IMDRF Documentation Reader & Indexed Search — Final Implementation Plan (source of truth)

> Authored by the user directly, adopted verbatim as the requirements/acceptance-criteria
> document this feature is built against. The task-by-task execution plan in
> `2026-09-13-imdrf-docs-search-redesign.md` is amended to match every section below —
> where the two disagree (CSS class names, overview-mode default, search tiering,
> stale-request protection, mobile nav, migration-privilege check, real-dataset
> performance verification), this document wins and the execution plan is corrected.

## 1. Objective

Redesign the read-only IMDRF terminology door at:

```text
/imdrf
```

from the current database/tree-style browser into a professional documentation/reference application.

The experience should be inspired by the information architecture and interaction patterns of professional documentation systems such as OpenAI and Claude documentation:

* persistent documentation navigation
* search-first workflow
* clear hierarchy
* breadcrumbs/context
* clean reading area
* progressive navigation
* stable links to terminology
* responsive documentation layout

### Important

Do not copy:

* OpenAI colors
* Claude/Anthropic colors
* logos
* branding
* exact typography
* exact components
* exact visual styling
* proprietary UI

Use only the documentation UX model.

The application must continue using the existing e-reports design system, colors, typography, CSS variables, StaffShell, spacing and navigation conventions.

## 2. Non-negotiable architecture boundaries

Before changing anything, inspect the existing implementation.

The existing IMDRF backend foundation is already correct and should be preserved.

Preserve

```text
PostgreSQL
Drizzle ORM
imdrf_releases
imdrf_terms
release isolation
(sort_order, id) browse cursor
import validation
import staging
publish workflow
StaffShell
existing authentication/authorization
```

Do not replace PostgreSQL with:

```text
D1
SQLite
MongoDB
```

Do not introduce:

```text
Elasticsearch
Meilisearch
Algolia
Redis
```

for this feature.

PostgreSQL itself should provide the search capability.

## 3. Strictly out of scope

This work must NOT modify the existing e-reports workflow.

Do not modify:

```text
F004 workflow
reports
assessments
manager decisions
officer workflow
Register
workload
deadlines
notifications
Orange report workflow
admin import/staging behaviour
```

The only exception is adding infrastructure that is strictly internal to the IMDRF reader/search implementation.

The future F004 Section 3 integration is not part of this implementation.

## 4. Releases

The existing release architecture remains unchanged.

Conceptually:

```text
imdrf_releases
│
├── 2026
│   └── imdrf_terms
│
├── 2027
│   └── imdrf_terms
│
└── 2028
    └── imdrf_terms
```

Every query must remain explicitly scoped to:

```text
release_id
```

Never allow a search or browse request to accidentally return terminology from another release.

Draft releases remain inaccessible to normal read-only users.

Published releases remain available according to the existing access rules.

## 5. Existing browse pagination must NOT regress

The existing browse cursor is:

```ts
type Cursor = {
  sortOrder: number;
  id: string;
}
```

and corresponds to:

```sql
ORDER BY sort_order ASC, id ASC
```

This is a working implementation.

Do not replace it with:

```text
sort_order only
```

Do not change its semantics.

Do not remove the UUID tie-breaker.

Do not introduce offset pagination for large annexes.

## 6. Documentation information architecture

The new IMDRF reader should have this structure:

```text
IMDRF Terminology
│
├── Overview
│
├── ANNEXES
│   ├── A — Medical Device Problem
│   ├── B — Type of Investigation
│   ├── C — Investigation Findings
│   ├── D — Investigation Conclusion
│   ├── E — Clinical Signs, Symptoms or Conditions
│   ├── F — Health Impact
│   └── G — Medical Device Component
│
└── Reference
```

The exact existing `ANNEX_TITLES` and counts should be reused.

Do not invent new terminology names when existing application data already provides them.

## 7. Global StaffShell

The existing StaffShell remains the application's global shell.

Do not create another application-wide header.

The existing staff header/top navigation remains unchanged.

The IMDRF documentation navigation exists inside the StaffShell content area.

If an IMDRF internal navigation element needs to become sticky, it must respect the existing StaffShell height rather than incorrectly using:

```css
top: 0;
```

when the global staff header occupies the top of the viewport.

Avoid creating competing sticky headers.

## 8. Main IMDRF layout

Desktop:

```text
┌─────────────────────────────────────────────────────┐
│ Existing StaffShell                                 │
├─────────────────────────────────────────────────────┤
│ IMDRF title / release information                   │
│                                                     │
│ Search                                              │
├───────────────┬─────────────────────────────────────┤
│               │                                     │
│ Documentation │ Breadcrumb                         │
│ Navigation    │                                     │
│               │ Annex title                         │
│ Overview      │                                     │
│               │ Documentation content               │
│ ANNEXES       │                                     │
│ A             │                                     │
│ B             │                                     │
│ C             │                                     │
│ D             │                                     │
│ E             │                                     │
│ F             │                                     │
│ G             │                                     │
│               │                                     │
└───────────────┴─────────────────────────────────────┘
```

The left navigation should behave like documentation navigation.

It should not look like a table of database records.

## 9. Overview page

The initial `/imdrf` page should behave like a documentation landing page.

It should contain:

Title

```text
IMDRF Adverse Event Terminology
```

Release information

For example:

```text
2026 Release
2,133 terms
7 annexes
```

Use the actual release data dynamically.

Description

Briefly explain what the terminology is used for.

Annex navigation

Present the seven annexes as documentation navigation items.

Not huge buttons.

Not cards consuming excessive screen space.

Not a horizontal table.

For example:

```text
Annex A
Medical Device Problem
491 terms

Annex B
Type of Investigation
34 terms

...
```

Clicking an annex should navigate to that annex.

## 10. Annex pages

Each annex is treated as one documentation document.

Example:

```text
/imdrf?release=<releaseId>&annex=G
```

The page contains:

```text
IMDRF
  → Annex G
  → Medical Device Component

Medical Device Component

[description/context]

G01 ...
G02 ...
G02002 Battery
...
```

The terminology is displayed in the official `sort_order`.

## 11. Important: hierarchy must remain visible

The new reader is not supposed to destroy the IMDRF hierarchy.

The data already contains:

```text
code_hierarchy
level
parent_term_id
sort_order
```

Use that information to visually communicate hierarchy.

For example:

```text
G
  G01
    G01001
    G01002

  G02
    G02001
    G02002 Battery
    G02003
```

But do not recreate the old interactive expand/collapse tree.

The hierarchy should read naturally as a documentation outline.

Use:

* typography
* indentation
* spacing
* headings
* subtle separators
* hierarchy breadcrumbs

rather than tree-widget controls.

## 12. Do not load an entire annex

This is extremely important.

The actual dataset contains thousands of terms across the release.

The reader must never load the entire annex into the browser at once.

Use the existing server-side pagination infrastructure.

Initial page:

```text
~25–50 terms
```

or another reasonable small page size determined from actual performance testing.

Then progressively fetch additional pages.

The exact number should be chosen based on measured performance rather than arbitrary assumptions.

## 13. Infinite scroll

Infinite scrolling may be used as the transport/pagination mechanism, but it must not define the UX.

Meaning:

The user sees a documentation document.

Behind the scenes:

```text
page 1
   ↓
cursor
   ↓
page 2
   ↓
cursor
   ↓
page 3
```

Use:

```text
IntersectionObserver
nextCursor
```

only if the existing implementation supports this cleanly.

Prevent:

* duplicate requests
* multiple simultaneous requests for the same cursor
* loading the entire annex immediately
* runaway requests when the sentinel is visible
* unnecessary DOM reconstruction

## 14. Term identity and deep links

Every terminology record has a UUID.

That UUID is the authoritative identity.

Do not assume `code` is globally unique.

This is important because the IMDRF dataset can contain repeated codes in different hierarchy contexts.

Therefore do NOT use:

```html
id="E0104"
```

as the authoritative DOM identity.

Instead use something equivalent to:

```html
id="term-<termUuid>"
data-term-id="<termUuid>"
```

The code may still appear visibly:

```text
E0104
```

but UUID identifies the database record.

## 15. Deep-link design

The documentation reader must support stable links to individual terms.

A recommended form is:

```text
/imdrf?release=<releaseId>&annex=G&term=<termId>#G02002
```

The exact URL format can be adapted to the existing routing conventions.

The important requirements are:

Server receives

```text
release
annex
term
```

and renders the correct release/annex context.

Browser fragment

The browser may additionally contain:

```text
#G02002
```

for documentation-style anchoring.

Remember:

URL fragments (`#...`) are not sent to the server.

Therefore client-side JavaScript must handle fragment navigation.

## 16. Deep-link behaviour

When a user opens a link to a term:

1. Correct release is selected.
2. Correct annex is selected.
3. The page loads.
4. The required term is located or fetched.
5. The term is brought into view.
6. The term is briefly highlighted/focused.
7. The URL remains shareable.
8. Browser Back/Forward works normally.

If the term is not in the first pagination window, the implementation must not assume it exists in the current DOM.

It should use the term identity to resolve the target appropriately.

## 17. Keep `getTerm`

Do NOT delete:

```text
getTerm
GET /imdrf/releases/:releaseId/terms/:id
```

even if the redesigned browser does not need to use the endpoint for every interaction.

Keep it as a stable read API because it can support:

* deep links
* future F004 integration
* other e-reports consumers
* future APIs
* direct terminology lookup

If its implementation needs adjustment for the new reader, make that adjustment backwards-compatible.

## 18. Term presentation

Each term should be visually structured like a documentation/reference entry.

For example:

```text
G02002

Battery

A device component that...

Hierarchy
Medical Device Component
  → Power Source
    → Battery

Status
Active

Non-IMDRF Code
...

Primary Category
...

Secondary Category
...
```

Only display fields that actually exist for the particular term.

Do not invent data.

## 19. Breadcrumbs

The reading area should always communicate context.

Example:

```text
IMDRF
  / Annex G
  / Medical Device Component
```

For a search result:

```text
IMDRF
  / Search results
  / Annex G
  / Medical Device Component
```

For deeper terminology hierarchy, use the existing hierarchy information where available.

## 20. Search becomes a first-class feature

Search is not merely a text filter.

It is the primary mechanism for finding terminology.

The user should not need to know the exact IMDRF wording.

For example, if the term is:

```text
Battery
```

the system should be capable of finding it when the user searches:

```text
battery
batter
batery
batt
device battery
battery device
```

subject to relevance ranking and sensible thresholds.

## 21. Search fields

Search should consider:

```text
code
term
definition
non_imdrf_code
```

and other relevant searchable metadata where appropriate.

Term names should receive stronger ranking weight than definitions.

Codes should receive strong weight for code searches.

## 22. Search technology

Use PostgreSQL-native search.

Preferred combination:

```text
PostgreSQL Full Text Search
+
pg_trgm
```

Create appropriate indexes.

For example:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Then use appropriate:

```text
tsvector
GIN
pg_trgm
similarity
word_similarity
ts_rank
```

Do not blindly copy SQL from another database system.

Inspect the project's existing PostgreSQL/Drizzle migration conventions first.

## 23. Search ranking

Search should combine multiple signals.

Conceptually:

```text
FTS rank
+
term similarity
+
code similarity
+
definition similarity
```

with stronger weight on:

```text
exact/relevant term
code
multi-word relevance
```

and weaker weight on:

```text
definition similarity
```

The exact formula should be tuned against the actual 2026 dataset.

Do not simply hardcode a `0.15` threshold without testing.

Test searches such as:

```text
battery
batt
batery
battery device
device battery
G02002
```

against real imported terminology.

## 24. Search token handling

Support:

* partial words
* missing words
* reordered words
* minor spelling mistakes
* code searches
* phrase fragments

Limit query complexity sensibly.

For example, cap the number of search tokens processed rather than allowing pathological huge queries.

Sanitize/parameterize all database input.

Never interpolate raw search text into SQL.

## 25. Short-query protection

Very short searches can produce poor fuzzy matches.

Do not let:

```text
a
ab
```

produce thousands of irrelevant results.

Use stricter logic for extremely short input.

For example:

* very short query → stronger prefix/code matching
* 3+ characters → fuzzy matching
* multi-word → FTS + fuzzy ranking

The exact thresholds should be validated against the actual data.

## 26. Search pagination

Browsing and searching have different ordering semantics.

Browsing:

```text
sort_order ASC
id ASC
```

Search:

```text
relevance score DESC
id ASC
```

Therefore search gets a separate cursor.

For example:

```ts
type SearchCursor = {
  score: number;
  id: string;
}
```

The existing browse cursor remains untouched.

## 27. Search cursor stability

The search cursor must be deterministic.

If two results have the same score:

```text
score
↓
id
```

must establish a stable order.

Be extremely careful with floating-point score comparisons.

The implementation must not produce:

```text
duplicate results
missing results
pagination loops
```

between page boundaries.

Test:

```text
page 1
→ cursor
→ page 2
→ cursor
→ page 3
```

and verify no overlap.

## 28. Search URL

Search state should be represented in the URL.

For example:

```text
/imdrf?release=<releaseId>&q=battery
```

This allows:

* refresh
* sharing
* browser Back
* browser Forward

The initial search result page should be server-rendered where practical.

Client-side JavaScript can take over for subsequent debounced searches.

## 29. Search interaction

Use a short debounce, approximately:

```text
200–300ms
```

Do not send a request on every keystroke immediately.

Cancel/ignore stale requests where possible.

Example:

```text
User types:
b
ba
bat
batt
batter
battery
```

The browser should not allow old responses to overwrite newer results.

## 30. Search results

Search results should look like documentation/reference results, not database rows.

Example:

```text
Battery
G02002

Medical Device Component
  → Power Source
    → Battery

A device component used...

Annex G
```

The user should immediately understand:

* what matched
* where it belongs
* what the term means
* how to navigate to it

Clicking a result should take the user to its location in the documentation.

## 31. Search mode vs browse mode

Browse mode

```text
/imdrf?release=2026&annex=G
```

shows:

```text
Annex G documentation
```

Search mode

```text
/imdrf?release=2026&q=battery
```

shows:

```text
ranked search results
```

Do not mix both into an unintelligible UI.

The breadcrumb should make the state obvious.

## 32. Mobile layout

Mobile must be treated as a real documentation experience.

Do not simply shrink the desktop layout.

Mobile should become approximately:

```text
StaffShell

IMDRF
Release

Search

[Annex navigation/menu]

Breadcrumb

Annex title

Documentation content
```

Avoid:

* horizontal page overflow
* three columns
* permanently visible desktop sidebar
* nested scroll containers
* tiny text
* giant cards

The annex navigation can collapse into a mobile documentation menu/selector.

## 33. Scrolling

Avoid the current nested-scroll feeling.

The user should primarily scroll the page naturally.

Do not create:

```text
browser page
    ↓
scroll container
    ↓
tree scroll container
    ↓
detail scroll container
```

Instead use a normal documentation page with a sticky navigation column where appropriate.

The documentation content should have enough width to read comfortably.

## 34. Visual design

Reuse the e-reports design system.

Use:

```text
existing CSS variables
existing colors
existing typography
existing spacing
existing borders
existing StaffShell conventions
```

Do not introduce an unrelated palette.

Do not make the UI look like:

```text
database admin
spreadsheet
generic tree widget
three-column dashboard
```

The visual goal is:

professional technical reference/documentation inside e-reports.

## 35. CSS architecture

Do not continue building the new reader with large amounts of inline styles.

Replace the current IMDRF-specific inline layout with semantic CSS classes.

For example:

```text
.imdrf-docs
.imdrf-docs-nav
.imdrf-docs-main
.imdrf-docs-search
.imdrf-docs-breadcrumb
.imdrf-annex
.imdrf-term
.imdrf-term-code
.imdrf-term-definition
.imdrf-term-meta
.imdrf-search-results
```

Use the existing application design tokens.

Remove obsolete tree-specific CSS only after confirming it is not used elsewhere.

## 36. Frontend JavaScript

Rewrite:

```text
server/public/imdrf-browser.js
```

rather than creating unnecessary parallel implementations.

The JavaScript should handle:

* search debounce
* stale-request protection
* search results
* browse pagination
* search pagination
* deep-link resolution
* anchor scrolling
* focus/highlight
* mobile navigation interactions where required

Avoid rebuilding the entire document DOM unnecessarily.

Use event delegation where appropriate.

## 37. Backend query service

Modify:

```text
server/src/domain/imdrf/query-service.ts
```

minimally.

Preserve existing:

```text
release isolation
parameterized queries
browse pagination
composite cursor
limits
```

Extend the service to return the fields required by the documentation reader.

The resulting `TermRow` can include:

```ts
{
  id,
  annex,
  code,
  term,
  level,
  definition,
  codeHierarchy,
  status,
  statusDescription,
  nonImdrfCode,
  primaryCategory,
  secondaryCategory
}
```

Do not remove fields from existing APIs unless there is a demonstrated reason.

## 38. Search indexes

Create a dedicated migration for search support.

It should:

1. enable `pg_trgm`
2. add the appropriate generated/search vector representation
3. create GIN/trigram indexes
4. follow existing migration conventions
5. work on the actual production PostgreSQL environment

Before implementation, verify the privileges of the migration role.

Do not assume extension creation privileges without checking the existing deployment configuration.

## 39. Import system

The existing IMDRF import/staging system remains untouched.

Do not modify:

```text
imdrf-admin.tsx
imdrf-admin routes
staging
SHA-256 token flow
staging expiry
row locking
import transaction
```

unless a search column requires a strictly necessary database migration.

PostgreSQL-generated search data should automatically update when terminology rows are inserted/updated.

The importer should not manually populate a generated search column.

## 40. Release year handling

The workbook's own:

```text
Release Number
```

remains authoritative.

The admin should not require an administrator to manually invent/select a release year that conflicts with the workbook.

This reader redesign must not regress the import validation behaviour.

## 41. Existing term API

Keep:

```text
GET /imdrf/releases/:releaseId/terms/:id
```

and:

```text
getTerm()
```

unless inspection proves the endpoint is broken.

The redesigned frontend may use it for:

* deep-link resolution
* future integration
* targeted term retrieval

but it does not have to use it for ordinary scrolling.

## 42. Tests

Tests must be updated rather than simply deleted.

Query service

Test:

```text
browse cursor encode/decode
search cursor encode/decode
release isolation
empty search
search ranking
```

Search behaviour

Test real examples:

```text
battery → Battery
batt → Battery
batery → Battery
battery device → relevant Battery results
device battery → relevant Battery results
G02002 → Battery
```

Also test irrelevant short queries.

## 43. Pagination tests

Browse:

```text
page 1
→ cursor
→ page 2
```

Verify:

```text
no overlap
correct sort order
correct release
correct nextCursor
```

Search:

```text
page 1
→ SearchCursor
→ page 2
```

Verify:

```text
no overlap
stable relevance ordering
stable ID tie-break
correct release
```

## 44. Integration tests

Test:

Releases

```text
published release → accessible
draft release → 404/not accessible
```

Isolation

Search 2026 must never return 2027 terminology.

Annex

```text
Annex A → only A
Annex G → only G
```

Search

Search results must contain enough information for documentation rendering.

Deep links

A valid term link must resolve correctly.

Retired terms

Retired terminology must remain visible according to the existing IMDRF data rules.

Do not silently hide it.

## 45. Performance verification

Claude must test the implementation against the actual imported dataset.

The 2026 release contains thousands of terminology records, so don't test only with one or two mock rows.

Verify:

* initial page load
* annex navigation
* search latency
* scrolling
* repeated search
* mobile layout
* deep linking
* network request count

Specifically verify that opening `/imdrf` does not download thousands of terms.

## 46. Acceptance criteria

The work is complete only when all of these are true:

UX

* IMDRF feels like a documentation/reference application.
* No three-pane tree/detail database UI.
* Desktop documentation sidebar.
* Mobile documentation navigation.
* Search is prominent.
* Breadcrumbs provide context.
* Annexes are documentation sections.
* Hierarchy remains understandable.
* Term entries are readable.
* Existing e-reports visual identity is preserved.

Search

* Server-side.
* PostgreSQL-native.
* Indexed.
* Ranked.
* Partial-word tolerant.
* Minor typo tolerant.
* Handles reordered/missing words reasonably.
* Searches code.
* Searches term.
* Searches definition.
* Does not load the entire release.
* Search pagination is stable.

Performance

* No full-release client download.
* Small initial page.
* Controlled pagination.
* No duplicate requests.
* No stale search results overwriting newer results.
* No unnecessary DOM rebuild.
* No nested-scroll nightmare.

Deep links

* Stable term identity uses UUID.
* Code is not assumed globally unique.
* Annex context is preserved.
* Term can be opened from search.
* Browser navigation works.
* Refresh works.

Backend safety

* PostgreSQL preserved.
* Drizzle preserved.
* Existing `(sort_order,id)` browse cursor preserved.
* Release isolation preserved.
* `getTerm` preserved.
* `/terms/:id` preserved.
* Import/staging untouched.
* F004/workflow untouched.

## 47. Implementation rule for Claude

Do not blindly implement this plan file-by-file.

First inspect the current repository and identify:

```text
current imdrf.tsx
current imdrf-browser.js
current app.css IMDRF styles
query-service.ts
IMDRF routes
schema
migrations
tests
StaffShell
```

Then implement the smallest coherent change that achieves this architecture.

If something in the current repository differs from this plan, preserve working production behaviour and adapt the implementation rather than replacing working infrastructure.

Do not introduce another database architecture.

Do not use examples from another framework/database literally.

Do not delete APIs merely because the new UI doesn't currently call them.

## Final product we're aiming for

The mental model should be:

```text
                  E-REPORTS
                      │
                StaffShell
                      │
               IMDRF DOCUMENTATION
                      │
          ┌───────────┴────────────┐
          │                        │
      Navigation                 Search
          │                        │
       Overview              ranked results
       Annex A                     │
       Annex B                     │
       Annex C                     │
       Annex D                     │
       Annex E                     │
       Annex F                     │
       Annex G                     │
          │                        │
          └───────────┬────────────┘
                      │
                Documentation
                    entry
                      │
          ┌───────────┴───────────┐
          │                       │
        Code                    Term
          │                       │
      Hierarchy               Definition
                                  │
                              Metadata
                                  │
                           Stable UUID anchor
```

This is the plan the user would use. It resolves the contradictions in the previous
plans while keeping the important backend work already completed safe.

And importantly: this is a reader redesign, not another rewrite of the IMDRF ingestion
system. The database/import foundation stays intact; the part users interact with
finally behaves like a serious documentation/reference product.
