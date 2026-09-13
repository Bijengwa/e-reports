/**
 * IMDRF terminology admin: list/detail, upload → preview → confirm, and publish.
 *
 * Registered in the staff door's administrator-only scope (`doors/staff/index.ts`); nothing here
 * re-checks the role, the same discipline `usersRoutes` already follows — the guard on that scope
 * has already run by the time any handler below executes.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  confirmImdrfImport,
  previewImdrfImport,
  publishImdrfRelease,
} from "../../../../domain/imdrf/import-service.js";
import { annexSummary, listAllReleases } from "../../../../domain/imdrf/query-service.js";
import { currentSession } from "../../session-guard.js";
import { ImdrfAdminPage, ImdrfImportPreviewPage } from "../pages/admin.js";

const ReleaseYear = z.coerce.number().int().min(2000).max(2100);
const TargetId = z.uuid();

const INVALID_YEAR = "Enter a release year between 2000 and 2100.";
const NO_FILE = "Choose a workbook (.xlsx file) to upload.";
const NOT_XLSX = "That file does not look like an .xlsx workbook.";
const EXPIRED_TOKEN =
  "That import link has expired or was already used. Upload the workbook again.";
const ALREADY_PUBLISHED = "That release is already published and cannot be replaced.";
const RELEASE_NOT_FOUND = "That release no longer exists.";

async function renderImdrfAdmin(
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
      <ImdrfAdminPage
        releases={releases}
        selected={selected}
        summary={summary}
        error={options.error}
        viewerRole={session.role}
        viewerName={session.fullName}
      />,
    );
}

type UploadFields = {
  releaseYear: string | null;
  documentCode: string | null;
  title: string | null;
  fileName: string | null;
  fileBuffer: Buffer | null;
};

/**
 * Reads the upload form, whatever order the browser sent its parts in. Every part is consumed
 * (even a rejected file) so the request body is always fully drained.
 */
async function readUploadForm(request: FastifyRequest): Promise<UploadFields> {
  const fields: UploadFields = {
    releaseYear: null,
    documentCode: null,
    title: null,
    fileName: null,
    fileBuffer: null,
  };

  for await (const part of request.parts()) {
    if (part.type === "field") {
      if (typeof part.value !== "string") continue;
      if (part.fieldname === "release_year") fields.releaseYear = part.value;
      else if (part.fieldname === "document_code") fields.documentCode = part.value;
      else if (part.fieldname === "title") fields.title = part.value;
      continue;
    }

    if (part.filename === "") {
      await part.toBuffer();
      continue;
    }

    if (fields.fileBuffer !== null) {
      // A second file part: keep the first, drain the rest.
      await part.toBuffer();
      continue;
    }

    fields.fileName = part.filename;
    fields.fileBuffer = await part.toBuffer();
  }

  return fields;
}

function nonEmpty(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Everything here lives under `/imdrf/manage/*`, never the bare `/imdrf` the read-only sidebar
 * owns (`routes/imdrf.ts`, registered in the `active` scope every role reaches). Fastify's route
 * table is global regardless of plugin encapsulation, so two scopes cannot both claim `GET
 * /imdrf` — the path split is what keeps "browse" and "administer" from colliding at the router.
 */
export async function imdrfAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/imdrf/manage", async (request, reply) => renderImdrfAdmin(app, request, reply, 200));

  app.post("/imdrf/manage/upload", async (request, reply) => {
    const fields = await readUploadForm(request);

    const parsedYear = ReleaseYear.safeParse(fields.releaseYear ?? undefined);
    if (!parsedYear.success) {
      return renderImdrfAdmin(app, request, reply, 422, { error: INVALID_YEAR });
    }

    if (fields.fileBuffer === null || fields.fileName === null) {
      return renderImdrfAdmin(app, request, reply, 422, { error: NO_FILE });
    }
    if (!fields.fileName.toLowerCase().endsWith(".xlsx")) {
      return renderImdrfAdmin(app, request, reply, 422, { error: NOT_XLSX });
    }

    const session = currentSession(request);
    const preview = await previewImdrfImport(app.db, {
      buffer: fields.fileBuffer,
      releaseYear: parsedYear.data,
      documentCode: nonEmpty(fields.documentCode),
      title: nonEmpty(fields.title),
      sourceFileName: fields.fileName,
      actorUserId: session.userId,
    });

    return reply.html(
      <ImdrfImportPreviewPage
        preview={preview}
        viewerRole={session.role}
        viewerName={session.fullName}
      />,
    );
  });

  app.post("/imdrf/manage/import", async (request, reply) => {
    const body = z.object({ token: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return renderImdrfAdmin(app, request, reply, 422, { error: EXPIRED_TOKEN });

    const outcome = await confirmImdrfImport(app.db, body.data.token);

    if (outcome.status === "imported") {
      return reply.redirect(`/imdrf/manage?release=${outcome.releaseId}`, 303);
    }
    if (outcome.status === "invalid_token") {
      return renderImdrfAdmin(app, request, reply, 410, { error: EXPIRED_TOKEN });
    }
    if (outcome.status === "already_published") {
      return renderImdrfAdmin(app, request, reply, 409, { error: ALREADY_PUBLISHED });
    }
    // validation_failed: re-validating the held buffer on confirm found a new problem — rare
    // (the workbook cannot have changed between preview and confirm) but never silently ignored.
    return renderImdrfAdmin(app, request, reply, 422, {
      error: `The workbook failed validation on confirm (${outcome.issues.length} issue${outcome.issues.length === 1 ? "" : "s"}). Upload it again.`,
    });
  });

  app.post("/imdrf/manage/:releaseId/publish", async (request, reply) => {
    const target = TargetId.safeParse((request.params as { releaseId: string }).releaseId);
    if (!target.success) {
      return renderImdrfAdmin(app, request, reply, 404, { error: RELEASE_NOT_FOUND });
    }

    const outcome = await publishImdrfRelease(app.db, target.data);

    if (outcome.status === "published") {
      return reply.redirect(`/imdrf/manage?release=${target.data}`, 303);
    }
    if (outcome.status === "not_found") {
      return renderImdrfAdmin(app, request, reply, 404, { error: RELEASE_NOT_FOUND });
    }
    return renderImdrfAdmin(app, request, reply, 409, {
      selectedId: target.data,
      error: ALREADY_PUBLISHED,
    });
  });
}

