/**
 * The read-only IMDRF terminology sidebar/browser, reachable by every signed-in staff role.
 *
 * Registered in the staff door's `active` scope (`doors/staff/index.ts`) — the same nesting level
 * as `reportsRoutes` — because this is a reference tool, not a vigilance record: nothing here
 * writes, and every function it calls (`domain/imdrf/query-service.ts`) is read-only by
 * construction. `requirePublishedRelease` is what keeps a draft release invisible to this door:
 * called first by every handler below, so "drafts are not exposed to normal read-only consumers"
 * is a property of one function rather than five repeated checks.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  annexSummary,
  getRelease,
  getTerm,
  listPublishedReleases,
  listTerms,
  searchTerms,
} from "../../../../domain/imdrf/query-service.js";
import { isAnnex } from "../../../../domain/imdrf/types.js";
import { currentSession } from "../../session-guard.js";
import { ImdrfBrowserPage } from "../pages/imdrf.js";

const ReleaseId = z.uuid();
const TermId = z.uuid();

const TERMS_PAGE_LIMIT = 50;
const SEARCH_PAGE_LIMIT = 25;

/**
 * The one check every route below makes before touching a release's terms: it must exist and be
 * published. A draft's id 404s here exactly as a nonexistent id would — a non-admin reader cannot
 * tell "no such release" from "that release isn't published yet" apart, which is the point.
 */
async function requirePublishedRelease(
  app: FastifyInstance,
  releaseId: string,
): Promise<{ id: string } | null> {
  const parsed = ReleaseId.safeParse(releaseId);
  if (!parsed.success) return null;

  const release = await getRelease(app.db, parsed.data);
  if (release?.status !== "published") return null;

  return { id: release.id };
}

export async function imdrfBrowserRoutes(app: FastifyInstance): Promise<void> {
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

  app.get("/imdrf/releases/:releaseId/annexes", async (request, reply) => {
    const release = await requirePublishedRelease(
      app,
      (request.params as { releaseId: string }).releaseId,
    );
    if (!release) return reply.status(404).send({ error: "Release not found." });

    return annexSummary(app.db, release.id);
  });

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

  app.get("/imdrf/releases/:releaseId/search", async (request, reply) => {
    const release = await requirePublishedRelease(
      app,
      (request.params as { releaseId: string }).releaseId,
    );
    if (!release) return reply.status(404).send({ error: "Release not found." });

    const query = request.query as { q?: string; cursor?: string };
    return searchTerms(app.db, {
      releaseId: release.id,
      query: query.q ?? "",
      limit: SEARCH_PAGE_LIMIT,
      cursor: query.cursor,
    });
  });

  app.get("/imdrf/releases/:releaseId/terms/:id", async (request, reply) => {
    const release = await requirePublishedRelease(
      app,
      (request.params as { releaseId: string }).releaseId,
    );
    if (!release) return reply.status(404).send({ error: "Release not found." });

    const termId = TermId.safeParse((request.params as { id: string }).id);
    if (!termId.success) return reply.status(404).send({ error: "Term not found." });

    const term = await getTerm(app.db, release.id, termId.data);
    if (!term) return reply.status(404).send({ error: "Term not found." });

    return term;
  });
}



