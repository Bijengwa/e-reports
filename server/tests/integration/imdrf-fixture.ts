import { sql } from "drizzle-orm";
import type { Database } from "../../src/db/client.js";

/**
 * A minimal, real IMDRF release for the many integration suites that submit an F004 through the
 * actual routes.
 *
 * `domain/imdrf/f004-integration.ts` now resolves and validates every IMDRF item's `_term_id`
 * against a published release, and refuses free text posted with no term id behind it — the whole
 * point of Phase 3. Every one of those suites therefore needs a real release and a real, leaf,
 * correctly-annexed term for each of the seven F004 items before `completeAssessment()`'s payload
 * can submit successfully, which is what this module seeds.
 *
 * One leaf term per annex, at the top of its own tree (`level: 1`, no parent) and carrying no
 * `status`, is enough: `resolveImdrfTerm` only requires that a chosen term belong to the right
 * annex and have no children of its own (and not be marked "Not selectable") — it does not require
 * an exact hierarchy depth, because IMDRF's own real releases do not have one fixed depth
 * per-annex when built from different (consolidated vs. single-annex) import shapes. See its own
 * module comment.
 */

export const IMDRF_ITEM_ANNEX: Record<string, string> = {
  component: "G",
  device_problem: "A",
  health_impact: "F",
  clinical_signs: "E",
  investigation_type: "B",
  investigation_findings: "C",
  investigation_conclusion: "D",
};

export type ImdrfFixture = { releaseId: string; term: Record<string, string> };

/** `imdrf_releases.release_year` is unique, and more than one test in a suite may seed a release
 *  (e.g. to prove a term from one release is refused against another) — each call gets a year of
 *  its own rather than colliding on 2026 every time. */
let nextReleaseYear = 2026;

export async function seedImdrfForF004(owner: Database): Promise<ImdrfFixture> {
  const releaseYear = nextReleaseYear;
  nextReleaseYear += 1;

  const releaseRows = await owner.execute(sql`
    INSERT INTO imdrf_releases (release_year, source_file_name, status, published_at)
    VALUES (${releaseYear}, 'fixture.json', 'published'::imdrf_release_status, now())
    RETURNING id
  `);
  const releaseId = (releaseRows[0] as { id: string }).id;

  const term: Record<string, string> = {};

  for (const [key, annex] of Object.entries(IMDRF_ITEM_ANNEX)) {
    const code = `${annex}01`;
    const rows = await owner.execute(sql`
      INSERT INTO imdrf_terms (release_id, annex, code, term, code_hierarchy, level, sort_order)
      VALUES (${releaseId}, ${annex}, ${code}, ${`Fixture term ${code}`}, ${code}, 1, 0)
      RETURNING id
    `);
    term[key] = (rows[0] as { id: string }).id;
  }

  return { releaseId, term };
}

/**
 * The posted-field spread `completeAssessment()`-style fixtures add for every one of the seven
 * IMDRF items, replacing what used to be hand-typed `imdrf_<key>_l1`/`_code` free text. The
 * `_l1`/`_code` display fields are intentionally not posted at all here — `resolveA1Imdrf`
 * overwrites them from the term id on save regardless of what (if anything) arrives for them, so a
 * fixture no longer needs to pretend to know their authoritative text.
 */
export function imdrfAssessmentFields(fixture: ImdrfFixture): Record<string, string> {
  const fields: Record<string, string> = { imdrf_release_id: fixture.releaseId };
  for (const key of Object.keys(IMDRF_ITEM_ANNEX)) {
    fields[`imdrf_${key}_term_id`] = fixture.term[key] ?? "";
  }
  return fields;
}
