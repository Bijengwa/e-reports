/**
 * IMDRF terminology admin: a release library, a dedicated import page, paste → validate → preview
 * → import, and publish.
 *
 * Registered in the staff door's administrator-only scope (`doors/staff/index.ts`); nothing here
 * re-checks the role, the same discipline `usersRoutes` already follows — the guard on that scope
 * has already run by the time any handler below executes.
 *
 * The workflow is paste-only: an administrator pastes the official IMDRF JSON payload verbatim
 * into a textarea (never a file upload, never a CLI import). The server is the sole source of
 * truth for validation — `previewImdrfImport` parses and validates the pasted text from scratch,
 * exactly as it would any other input, so nothing the browser claims about the payload is trusted.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  confirmImdrfImport,
  previewImdrfImport,
  publishImdrfRelease,
} from "../../../../domain/imdrf/import-service.js";
import { MAX_PAYLOAD_BYTES } from "../../../../domain/imdrf/parser.js";
import { annexSummary, listAllReleases } from "../../../../domain/imdrf/query-service.js";
import { currentSession } from "../../session-guard.js";
import { ImdrfImportPage, ImdrfImportPreviewPage, ImdrfLibraryPage } from "../pages/admin.js";

const ReleaseYear = z.coerce.number().int().min(2000).max(2100);
const TargetId = z.uuid();

const INVALID_YEAR = "Enter a release year between 2000 and 2100.";
const NO_PAYLOAD = "Paste the IMDRF JSON payload before validating.";
const PAYLOAD_TOO_LARGE = `The pasted payload exceeds the ${(MAX_PAYLOAD_BYTES / (1024 * 1024)).toFixed(0)} MB limit.`;
const EXPIRED_TOKEN = "That import link has expired or was already used. Paste the payload again.";
const ALREADY_PUBLISHED = "That release is already published and cannot be replaced.";
const RELEASE_NOT_FOUND = "That release no longer exists.";

async function renderLibrary(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  options: { selectedId?: string; error?: string } = {},
): Promise<void> {
  const session = currentSession(request);
  const releases = await listAllReleases(app.db);

  const query = request.query as { release?: string };
  const requestedId = options.selectedId ?? query.release;
  const selected = releases.find((release) => release.id === requestedId) ?? releases[0] ?? null;

  const summary = selected ? await annexSummary(app.db, selected.id) : [];

  reply
    .status(status)
    .html(
      <ImdrfLibraryPage
        releases={releases}
        selected={selected}
        summary={summary}
        error={options.error}
        viewerRole={session.role}
        viewerName={session.fullName}
      />,
    );
}

function renderImportPage(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  error?: string,
): void {
  const session = currentSession(request);
  reply
    .status(status)
    .html(
      <ImdrfImportPage error={error} viewerRole={session.role} viewerName={session.fullName} />,
    );
}

function nonEmpty(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const UploadBody = z.object({
  release_year: z.string(),
  document_code: z.string().optional(),
  title: z.string().optional(),
  payload: z.string(),
});

/**
 * Everything here lives under `/imdrf/manage/*`, never the bare `/imdrf` the read-only sidebar
 * owns (`routes/imdrf.ts`, registered in the `active` scope every role reaches). Fastify's route
 * table is global regardless of plugin encapsulation, so two scopes cannot both claim `GET
 * /imdrf` — the path split is what keeps "browse" and "administer" from colliding at the router.
 */
export async function imdrfAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/imdrf/manage", async (request, reply) => renderLibrary(app, request, reply, 200));

  app.get("/imdrf/manage/import", async (request, reply) => renderImportPage(request, reply, 200));

  app.post(
    "/imdrf/manage/validate",
    // The pasted JSON payload itself is bounded by `MAX_PAYLOAD_BYTES`; this route-level limit
    // is set a little above that to leave room for the surrounding form fields and encoding
    // overhead, while still cutting a hostile multi-hundred-MB body off while it streams rather
    // than after the whole thing has been buffered.
    { bodyLimit: MAX_PAYLOAD_BYTES + 64 * 1024 },
    async (request, reply) => {
      const body = UploadBody.safeParse(request.body);
      if (!body.success) return renderImportPage(request, reply, 422, NO_PAYLOAD);

      const parsedYear = ReleaseYear.safeParse(body.data.release_year);
      if (!parsedYear.success) return renderImportPage(request, reply, 422, INVALID_YEAR);

      const payload = body.data.payload;
      if (nonEmpty(payload) === null) return renderImportPage(request, reply, 422, NO_PAYLOAD);
      if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) {
        return renderImportPage(request, reply, 413, PAYLOAD_TOO_LARGE);
      }

      const session = currentSession(request);
      const preview = await previewImdrfImport(app.db, {
        payload,
        releaseYear: parsedYear.data,
        documentCode: nonEmpty(body.data.document_code),
        title: nonEmpty(body.data.title),
        sourceFileName: "Pasted IMDRF JSON payload",
        actorUserId: session.userId,
      });

      return reply.html(
        <ImdrfImportPreviewPage
          preview={preview}
          viewerRole={session.role}
          viewerName={session.fullName}
        />,
      );
    },
  );

  app.post("/imdrf/manage/import", async (request, reply) => {
    const body = z.object({ token: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return renderImportPage(request, reply, 422, EXPIRED_TOKEN);

    const outcome = await confirmImdrfImport(app.db, body.data.token);

    if (outcome.status === "imported") {
      return reply.redirect(`/imdrf/manage?release=${outcome.releaseId}`, 303);
    }
    if (outcome.status === "invalid_token") {
      return renderImportPage(request, reply, 410, EXPIRED_TOKEN);
    }
    if (outcome.status === "already_published") {
      return renderImportPage(request, reply, 409, ALREADY_PUBLISHED);
    }
    // validation_failed: re-validating the held payload on confirm found a new problem — rare
    // (the payload cannot have changed between preview and confirm) but never silently ignored.
    return renderImportPage(
      request,
      reply,
      422,
      `The payload failed validation on confirm (${outcome.issues.length} issue${outcome.issues.length === 1 ? "" : "s"}). Paste it again.`,
    );
  });

  app.post("/imdrf/manage/:releaseId/publish", async (request, reply) => {
    const target = TargetId.safeParse((request.params as { releaseId: string }).releaseId);
    if (!target.success) {
      return renderLibrary(app, request, reply, 404, { error: RELEASE_NOT_FOUND });
    }

    const outcome = await publishImdrfRelease(app.db, target.data);

    if (outcome.status === "published") {
      return reply.redirect(`/imdrf/manage?release=${target.data}`, 303);
    }
    if (outcome.status === "not_found") {
      return renderLibrary(app, request, reply, 404, { error: RELEASE_NOT_FOUND });
    }
    return renderLibrary(app, request, reply, 409, {
      selectedId: target.data,
      error: ALREADY_PUBLISHED,
    });
  });
}
