/**
 * A caching layer in front of `query-service.ts`, for the reads every signed-in assessor makes
 * against the same handful of published releases: the release row itself, its annex counts, and
 * term/lineage lookups (the exact path an F004 IMDRF selection resolves through on every save —
 * see `f004-integration.ts` — and what the read-only sidebar's term document reads).
 *
 * Every function here is a drop-in replacement for its `query-service.ts` namesake and never
 * caches a draft: it only ever writes to the cache once it has itself observed
 * `status = 'published'` on the release a result came from, so an administrator's in-progress
 * corrections to a draft are always read fresh, however many times this is called. A published
 * release is immutable, so once a key is written it is correct for as long as it lives.
 *
 * `listTerms`/`searchTerms` are deliberately not wrapped here. Their result space (arbitrary query
 * text, cursors, annex, limit) is far larger and far less repeated than "the release row" or "this
 * one term", so caching them would spend memory on entries an assessor is unlikely to ask for
 * twice, for a smaller win than the four functions below already capture — the server-side
 * pagination itself, not a cache, is what keeps that path scalable.
 */

import type { Database } from "../../db/client.js";
import { getCached, setCached } from "./cache.js";
import {
  annexSummary,
  getRelease,
  getTerm,
  getTermLineage,
  type LineageStep,
  type ReleaseSummary,
  type TermDetail,
} from "./query-service.js";
import type { AnnexSummary } from "./types.js";

export async function getReleaseCached(
  db: Database,
  releaseId: string,
): Promise<ReleaseSummary | null> {
  const key = `imdrf:${releaseId}:release`;
  const hit = getCached<ReleaseSummary | null>(key);
  if (hit !== undefined) return hit;

  const release = await getRelease(db, releaseId);
  if (release?.status === "published") setCached(key, release);
  return release;
}

export async function annexSummaryCached(db: Database, releaseId: string): Promise<AnnexSummary[]> {
  const key = `imdrf:${releaseId}:annex-summary`;
  const hit = getCached<AnnexSummary[]>(key);
  if (hit !== undefined) return hit;

  const [release, summary] = await Promise.all([
    getReleaseCached(db, releaseId),
    annexSummary(db, releaseId),
  ]);
  if (release?.status === "published") setCached(key, summary);
  return summary;
}

export async function getTermCached(
  db: Database,
  releaseId: string,
  termId: string,
): Promise<TermDetail | null> {
  const key = `imdrf:${releaseId}:term:${termId}`;
  const hit = getCached<TermDetail | null>(key);
  if (hit !== undefined) return hit;

  const [release, term] = await Promise.all([
    getReleaseCached(db, releaseId),
    getTerm(db, releaseId, termId),
  ]);
  if (release?.status === "published") setCached(key, term);
  return term;
}

export async function getTermLineageCached(
  db: Database,
  releaseId: string,
  termId: string,
): Promise<LineageStep[]> {
  const key = `imdrf:${releaseId}:lineage:${termId}`;
  const hit = getCached<LineageStep[]>(key);
  if (hit !== undefined) return hit;

  const [release, lineage] = await Promise.all([
    getReleaseCached(db, releaseId),
    getTermLineage(db, releaseId, termId),
  ]);
  if (release?.status === "published") setCached(key, lineage);
  return lineage;
}
