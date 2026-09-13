import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.js";
import { listTerms, searchTerms } from "../../src/domain/imdrf/query-service.js";
import { INTEGRATION_ENABLED, openOwner, truncateAll } from "./helpers.js";

let owner: DatabaseHandle;

afterAll(async () => {
  await owner?.close();
});

/**
 * Pagination correctness when `sort_order` is not unique — the case the composite `(sort_order,
 * id)` cursor exists for. `sort_order` is the workbook's own per-annex row order (see
 * `parser.ts`), so two rows can legitimately share a value; a cursor over `sort_order` alone would
 * either skip or repeat rows the moment a page boundary landed on one of those ties.
 */
describe.skipIf(!INTEGRATION_ENABLED)(
  "imdrf query-service pagination with duplicate sort_order",
  () => {
    beforeEach(async () => {
      owner ??= openOwner();
      await truncateAll(owner.db);
    });

    async function seedRelease(): Promise<string> {
      const rows = await owner.db.execute(sql`
      INSERT INTO imdrf_releases (release_year, source_file_name, status, published_at)
      VALUES (2026, 'seed.xlsx', 'published', now())
      RETURNING id
    `);
      return (rows[0] as { id: string }).id;
    }

    /** Root terms in Annex A, all sharing sort_order 0 — a deliberate collision. */
    async function seedDuplicateSortOrder(releaseId: string, count: number): Promise<Set<string>> {
      const ids = new Set<string>();
      for (let i = 0; i < count; i++) {
        const rows = await owner.db.execute(sql`
          INSERT INTO imdrf_terms (release_id, annex, code, term, code_hierarchy, level, sort_order)
          VALUES (${releaseId}, 'A', ${`A${i}`}, ${`Term ${i}`}, ${`A${i}`}, 1, 0)
          RETURNING id
        `);
        ids.add((rows[0] as { id: string }).id);
      }
      return ids;
    }

    it("visits every row exactly once across pages when many rows share one sort_order", async () => {
      const releaseId = await seedRelease();
      const expected = await seedDuplicateSortOrder(releaseId, 9);

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = await listTerms(owner.db, {
          releaseId,
          annex: "A",
          parentId: null,
          limit: 2,
          cursor,
        });
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

      const first = await listTerms(owner.db, {
        releaseId,
        annex: "A",
        parentId: null,
        limit: 2,
      });
      expect(first.rows).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await listTerms(owner.db, {
        releaseId,
        annex: "A",
        parentId: null,
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

      const fromStart = await listTerms(owner.db, {
        releaseId,
        annex: "A",
        parentId: null,
        limit: 10,
      });
      const withGarbageCursor = await listTerms(owner.db, {
        releaseId,
        annex: "A",
        parentId: null,
        limit: 10,
        cursor: "not-a-real-cursor",
      });

      expect(new Set(withGarbageCursor.rows.map((r) => r.id))).toEqual(
        new Set(fromStart.rows.map((r) => r.id)),
      );
    });
  },
);
