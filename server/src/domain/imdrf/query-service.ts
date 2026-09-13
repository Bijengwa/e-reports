/**
 * Every read the admin UI and the read-only sidebar make against the IMDRF tables.
 *
 * One rule holds across every function here: a query is always scoped by `releaseId` first — never
 * "every term", always "this release's terms" — so 2026 and 2027 can never bleed into the same
 * result by accident. `listTerms`/`searchTerms` also never load a whole release into memory: they
 * take a `limit` (clamped server-side regardless of what the caller asks for) and return an opaque
 * cursor for the next page, because IMDRF terminology can run into the thousands of rows and
 * neither the sidebar's tree nor its search box ever needs all of them at once.
 */

import { sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { ANNEXES, type Annex, type AnnexSummary, isAnnex } from "./types.js";
import type { ValidatedTerm } from "./validate.js";

export type ReleaseSummary = {
  id: string;
  releaseYear: number;
  documentCode: string | null;
  title: string | null;
  sourceFileName: string;
  status: "draft" | "published";
  createdAt: Date;
  publishedAt: Date | null;
};

export type TermRow = {
  id: string;
  annex: Annex;
  code: string;
  term: string;
  level: number;
  hasChildren: boolean;
};

export type TermDetail = ValidatedTerm & { id: string; hasChildren: boolean };

const MAX_LIST_LIMIT = 200;
const MAX_SEARCH_LIMIT = 100;

function clampLimit(requested: number, max: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return max;
  return Math.min(Math.trunc(requested), max);
}

export type Cursor = { sortOrder: number; id: string };

/**
 * An opaque pagination cursor over `(sort_order, id)`, not `sort_order` alone.
 *
 * `sort_order` is only unique within one annex (it is the workbook's own row order, reset per
 * annex — see `parser.ts`), so a page boundary that landed exactly on a `sort_order` value shared
 * by rows of two different annexes could skip or repeat rows depending on which of them Postgres
 * happened to return last. `id` (the primary key, always unique) is the tiebreak that makes the
 * ordering — and therefore the cursor — total rather than merely usually sufficient. A malformed
 * or tampered cursor degrades to "from the start" rather than throwing.
 */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "sortOrder" in decoded &&
      "id" in decoded &&
      typeof (decoded as { sortOrder: unknown }).sortOrder === "number" &&
      Number.isInteger((decoded as { sortOrder: unknown }).sortOrder) &&
      typeof (decoded as { id: unknown }).id === "string"
    ) {
      return decoded as Cursor;
    }
    return null;
  } catch {
    return null;
  }
}

type ReleaseRow = {
  id: string;
  release_year: number;
  document_code: string | null;
  title: string | null;
  source_file_name: string;
  status: "draft" | "published";
  created_at: Date;
  published_at: Date | null;
};

function releaseOf(row: ReleaseRow): ReleaseSummary {
  return {
    id: row.id,
    releaseYear: row.release_year,
    documentCode: row.document_code,
    title: row.title,
    sourceFileName: row.source_file_name,
    status: row.status,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

export async function listPublishedReleases(db: Database): Promise<ReleaseSummary[]> {
  const rows = await db.execute<ReleaseRow>(sql`
    SELECT id, release_year, document_code, title, source_file_name, status, created_at, published_at
      FROM imdrf_releases
     WHERE status = 'published'
     ORDER BY release_year DESC
  `);
  return rows.map(releaseOf);
}

/** Every release, drafts included. The caller is responsible for restricting this to admins. */
export async function listAllReleases(db: Database): Promise<ReleaseSummary[]> {
  const rows = await db.execute<ReleaseRow>(sql`
    SELECT id, release_year, document_code, title, source_file_name, status, created_at, published_at
      FROM imdrf_releases
     ORDER BY release_year DESC
  `);
  return rows.map(releaseOf);
}

export async function getRelease(db: Database, releaseId: string): Promise<ReleaseSummary | null> {
  const rows = await db.execute<ReleaseRow>(sql`
    SELECT id, release_year, document_code, title, source_file_name, status, created_at, published_at
      FROM imdrf_releases
     WHERE id = ${releaseId}
     LIMIT 1
  `);
  return rows[0] ? releaseOf(rows[0]) : null;
}

export async function isReleasePublished(db: Database, releaseId: string): Promise<boolean> {
  const rows = await db.execute<{ status: string }>(sql`
    SELECT status FROM imdrf_releases WHERE id = ${releaseId} LIMIT 1
  `);
  return rows[0]?.status === "published";
}

export async function annexSummary(db: Database, releaseId: string): Promise<AnnexSummary[]> {
  const rows = await db.execute<{ annex: string; count: string }>(sql`
    SELECT annex, count(*) AS count
      FROM imdrf_terms
     WHERE release_id = ${releaseId}
     GROUP BY annex
  `);
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.annex, Number(row.count));
  return ANNEXES.map((annex) => ({ annex, count: counts.get(annex) ?? 0 }));
}

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

export async function listTerms(
  db: Database,
  opts: {
    releaseId: string;
    annex?: Annex;
    parentId: string | null;
    limit: number;
    cursor?: string;
  },
): Promise<{ rows: TermRow[]; nextCursor: string | null }> {
  if (opts.parentId === null && opts.annex === undefined) {
    throw new Error("listTerms: annex is required when listing an annex's top-level terms.");
  }

  const limit = clampLimit(opts.limit, MAX_LIST_LIMIT);
  const after = decodeCursor(opts.cursor);
  const afterSortOrder = after?.sortOrder ?? null;
  const afterId = after?.id ?? null;

  const rows = await db.execute<TermQueryRow>(
    opts.parentId === null
      ? sql`
          SELECT t.id, t.annex, t.code, t.term, t.level, t.sort_order,
                 EXISTS (SELECT 1 FROM imdrf_terms c WHERE c.parent_term_id = t.id) AS has_children
            FROM imdrf_terms t
           WHERE t.release_id = ${opts.releaseId}
             AND t.annex = ${opts.annex}
             AND t.parent_term_id IS NULL
             AND (
               ${afterSortOrder}::int IS NULL
               OR t.sort_order > ${afterSortOrder}
               OR (t.sort_order = ${afterSortOrder} AND t.id > ${afterId})
             )
           ORDER BY t.sort_order, t.id
           LIMIT ${limit + 1}
        `
      : sql`
          SELECT t.id, t.annex, t.code, t.term, t.level, t.sort_order,
                 EXISTS (SELECT 1 FROM imdrf_terms c WHERE c.parent_term_id = t.id) AS has_children
            FROM imdrf_terms t
           WHERE t.release_id = ${opts.releaseId}
             AND t.parent_term_id = ${opts.parentId}
             AND (
               ${afterSortOrder}::int IS NULL
               OR t.sort_order > ${afterSortOrder}
               OR (t.sort_order = ${afterSortOrder} AND t.id > ${afterId})
             )
           ORDER BY t.sort_order, t.id
           LIMIT ${limit + 1}
        `,
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    rows: page.map(termRowOf),
    nextCursor: hasMore && last ? encodeCursor({ sortOrder: last.sort_order, id: last.id }) : null,
  };
}

/** Escapes `%`, `_` and `\` so user-typed text cannot inject LIKE wildcards of its own. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

export async function searchTerms(
  db: Database,
  opts: { releaseId: string; query: string; limit: number; cursor?: string },
): Promise<{ rows: TermRow[]; nextCursor: string | null }> {
  const trimmed = opts.query.trim();
  if (trimmed === "") return { rows: [], nextCursor: null };

  const limit = clampLimit(opts.limit, MAX_SEARCH_LIMIT);
  const after = decodeCursor(opts.cursor);
  const afterSortOrder = after?.sortOrder ?? null;
  const afterId = after?.id ?? null;
  const pattern = likePattern(trimmed);

  const rows = await db.execute<TermQueryRow>(sql`
    SELECT t.id, t.annex, t.code, t.term, t.level, t.sort_order,
           EXISTS (SELECT 1 FROM imdrf_terms c WHERE c.parent_term_id = t.id) AS has_children
      FROM imdrf_terms t
     WHERE t.release_id = ${opts.releaseId}
       AND (t.code ILIKE ${pattern} ESCAPE '\\'
            OR t.term ILIKE ${pattern} ESCAPE '\\'
            OR t.definition ILIKE ${pattern} ESCAPE '\\')
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

type TermDetailRow = {
  id: string;
  annex: string;
  code: string;
  term: string;
  definition: string | null;
  non_imdrf_code: string | null;
  status: string | null;
  status_description: string | null;
  primary_category: string | null;
  secondary_category: string | null;
  code_hierarchy: string;
  parent_term_id: string | null;
  level: number;
  sort_order: number;
  has_children: boolean;
};

export async function getTerm(
  db: Database,
  releaseId: string,
  termId: string,
): Promise<TermDetail | null> {
  const rows = await db.execute<TermDetailRow>(sql`
    SELECT t.id, t.annex, t.code, t.term, t.definition, t.non_imdrf_code, t.status,
           t.status_description, t.primary_category, t.secondary_category, t.code_hierarchy,
           t.parent_term_id, t.level, t.sort_order,
           EXISTS (SELECT 1 FROM imdrf_terms c WHERE c.parent_term_id = t.id) AS has_children
      FROM imdrf_terms t
     WHERE t.release_id = ${releaseId} AND t.id = ${termId}
     LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  if (!isAnnex(row.annex)) {
    throw new Error(`Stored term ${row.id} has an invalid annex "${row.annex}".`);
  }

  return {
    id: row.id,
    annex: row.annex,
    code: row.code,
    term: row.term,
    definition: row.definition,
    nonImdrfCode: row.non_imdrf_code,
    status: row.status,
    statusDescription: row.status_description,
    primaryCategory: row.primary_category,
    secondaryCategory: row.secondary_category,
    codeHierarchy: row.code_hierarchy,
    parentTermId: row.parent_term_id,
    level: row.level,
    sortOrder: row.sort_order,
    hasChildren: row.has_children,
  };
}
