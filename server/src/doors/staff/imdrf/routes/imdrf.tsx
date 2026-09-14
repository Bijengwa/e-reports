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
  annexSummaryCached,
  getReleaseCached,
  getTermCached,
  getTermLineageCached,
} from "../../../../domain/imdrf/cached-query-service.js";
import {
  getTermByCode,
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

/** No IMDRF AE code comes close to this; the bound is here so a lookup cannot be used to hand
 *  Postgres an arbitrarily long string to lower-case and compare against every row. */
const MAX_CODE_LENGTH = 64;

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

  const release = await getReleaseCached(app.db, parsed.data);
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

    const summary = selected ? await annexSummaryCached(app.db, selected.id) : [];

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

    return annexSummaryCached(app.db, release.id);
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

    const query = request.query as { q?: string; cursor?: string; annex?: string };
    // An unrecognised `annex` is dropped rather than rejected: the scope is a narrowing of a
    // search, and the honest answer to "search annex Z" is every annex, not a 400 on a box the
    // officer is still typing into.
    const annex = query.annex !== undefined && isAnnex(query.annex) ? query.annex : undefined;

    return searchTerms(app.db, {
      releaseId: release.id,
      query: query.q ?? "",
      limit: SEARCH_PAGE_LIMIT,
      cursor: query.cursor,
      annex,
    });
  });

  /*
   * Resolve a typed code to the one term that carries it.
   *
   * The handbook's own search box does not need this — it already ranks an exact code first. It
   * exists for F004 section 3, where the coding field is the only thing an officer fills and the
   * three "preferred terminology level" boxes are filled from what comes back. That is a
   * resolve, not a search: either the code names a published term, or the form has nothing to
   * write, and a 404 here is the form's signal to say so rather than to guess.
   */
  app.get("/imdrf/releases/:releaseId/codes/:code", async (request, reply) => {
    const release = await requirePublishedRelease(
      app,
      (request.params as { releaseId: string }).releaseId,
    );
    if (!release) return reply.status(404).send({ error: "Release not found." });

    const code = (request.params as { code: string }).code;
    if (code.length > MAX_CODE_LENGTH) {
      return reply.status(404).send({ error: "Term not found." });
    }

    const term = await getTermByCode(app.db, release.id, code);
    if (!term) return reply.status(404).send({ error: "Term not found." });

    return { ...term, lineage: await getTermLineageCached(app.db, release.id, term.id) };
  });

  app.get("/imdrf/releases/:releaseId/terms/:id", async (request, reply) => {
    const release = await requirePublishedRelease(
      app,
      (request.params as { releaseId: string }).releaseId,
    );
    if (!release) return reply.status(404).send({ error: "Release not found." });

    const termId = TermId.safeParse((request.params as { id: string }).id);
    if (!termId.success) return reply.status(404).send({ error: "Term not found." });

    const term = await getTermCached(app.db, release.id, termId.data);
    if (!term) return reply.status(404).send({ error: "Term not found." });

    // The lineage rides along with the term rather than sitting behind its own route: every
    // consumer of a term detail wants the level names (that is what F004 asks for), so a second
    // round trip would only ever be made immediately after the first.
    return { ...term, lineage: await getTermLineageCached(app.db, release.id, term.id) };
  });
}
