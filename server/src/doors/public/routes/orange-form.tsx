import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  type Answers,
  FIRST_STEP,
  firstIncompleteStep,
  type Issue,
  LAST_STEP,
  parseStep,
  pruneDependents,
  type Step,
  shiftStep,
  validateStep,
} from "../../../domain/form-schema.js";
import { storeReport, validateSubmission } from "../../../domain/reports.js";
import { LOCALE_COOKIE, type Locale, parseLocale, t } from "../../../i18n/index.js";
import { isAllowedMimeType, MAX_ATTACHMENTS, type StoredObject } from "../../../storage/index.js";
import { type CarriedAttachment, MAX_UPLOAD_MB, OrangeFormPage } from "../views/orange-form.js";

/** Fields that steer the wizard rather than answer a question. */
const CONTROL_FIELDS = new Set(["step", "action", "locale", "attachment_meta", "attachments"]);

type ParsedForm = {
  fields: Record<string, string | string[]>;
  uploaded: StoredObject[];
  /** Names of files that were rejected, so the reporter is told rather than left guessing. */
  rejected: string[];
};

function pushField(fields: Record<string, string | string[]>, name: string, value: string): void {
  const existing = fields[name];

  if (existing === undefined) {
    fields[name] = value;
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    fields[name] = [existing, value];
  }
}

/**
 * Read the submission, whichever encoding it arrived in.
 *
 * Steps 1-4 post url-encoded; only the last step carries files and therefore multipart. Files are
 * written to storage as they arrive rather than at the end, so a submission that fails validation
 * does not make the reporter pick their photographs again — the keys are carried forward instead.
 */
async function parseForm(app: FastifyInstance, request: FastifyRequest): Promise<ParsedForm> {
  const fields: Record<string, string | string[]> = {};
  const uploaded: StoredObject[] = [];
  const rejected: string[] = [];

  if (!request.isMultipart()) {
    const body = (request.body ?? {}) as Record<string, unknown>;

    for (const [name, raw] of Object.entries(body)) {
      if (typeof raw === "string") {
        fields[name] = raw;
      } else if (Array.isArray(raw)) {
        fields[name] = raw.filter((entry): entry is string => typeof entry === "string");
      }
    }

    return { fields, uploaded, rejected };
  }

  for await (const part of request.parts()) {
    if (part.type === "field") {
      if (typeof part.value === "string") pushField(fields, part.fieldname, part.value);
      continue;
    }

    // An empty file input still sends one part, with a blank filename.
    if (part.filename === "") {
      await part.toBuffer();
      continue;
    }

    if (!isAllowedMimeType(part.mimetype) || uploaded.length >= MAX_ATTACHMENTS) {
      rejected.push(part.filename);
      await part.toBuffer();
      continue;
    }

    try {
      const data = await part.toBuffer();
      uploaded.push(
        await app.storage.put({ data, filename: part.filename, mimeType: part.mimetype }),
      );
    } catch (error) {
      // Almost always the per-file size limit. The report itself must still go through.
      request.log.warn({ err: error, filename: part.filename }, "attachment rejected");
      rejected.push(part.filename);
    }
  }

  return { fields, uploaded, rejected };
}

/**
 * Everything the reporter typed, minus the fields that steer the wizard.
 *
 * Values are taken as they arrive and are never trusted as markup — the view escapes them on the
 * way back out.
 */
function collectAnswers(fields: Record<string, string | string[]>): Answers {
  const answers: Answers = {};

  for (const [name, value] of Object.entries(fields)) {
    if (CONTROL_FIELDS.has(name)) continue;
    answers[name] = value;
  }

  return answers;
}

/**
 * Attachments already in storage, restored from the hidden fields that carried them.
 *
 * The metadata is client-supplied and therefore untrusted: the MIME type is re-checked against the
 * allow-list and anything malformed is dropped. The bytes themselves were written by us under a
 * key containing a uuid we generated, so a client cannot name its way to another reporter's file.
 */
function carriedAttachments(fields: Record<string, string | string[]>): CarriedAttachment[] {
  const raw = fields.attachment_meta;
  if (raw === undefined) return [];

  const entries = Array.isArray(raw) ? raw : [raw];
  const restored: CarriedAttachment[] = [];

  for (const entry of entries) {
    try {
      const parsed: unknown = JSON.parse(entry);
      if (typeof parsed !== "object" || parsed === null) continue;

      const file = parsed as Record<string, unknown>;

      if (
        typeof file.objectKey === "string" &&
        typeof file.filename === "string" &&
        typeof file.mimeType === "string" &&
        typeof file.checksumSha256 === "string" &&
        typeof file.sizeBytes === "number" &&
        isAllowedMimeType(file.mimeType)
      ) {
        restored.push({
          objectKey: file.objectKey,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          checksumSha256: file.checksumSha256,
        });
      }
    } catch {
      // A metadata field we cannot read is a field we do not honour.
    }
  }

  return restored;
}

export async function orangeFormRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request, reply) => {
    const locale = parseLocale(request.cookies[LOCALE_COOKIE]);
    return reply.html(<OrangeFormPage step={FIRST_STEP} locale={locale} />);
  });

  app.post("/orange-form", async (request, reply) => {
    const { fields, uploaded, rejected } = await parseForm(app, request);

    const step = parseStep(fields.step);
    const action = typeof fields.action === "string" ? fields.action : "next";
    const locale = parseLocale(typeof fields.locale === "string" ? fields.locale : undefined);

    // Dropping answers whose controlling question no longer selects them is what makes the
    // greyed-out input on screen true of the record, not merely true of the screen.
    const answers = pruneDependents(collectAnswers(fields));
    const attachments = [...carriedAttachments(fields), ...uploaded].slice(0, MAX_ATTACHMENTS);

    const uploadNotice =
      rejected.length > 0
        ? t(locale, "error.upload", { name: rejected.join(", "), size: MAX_UPLOAD_MB })
        : undefined;

    /** Re-render some step, carrying everything the reporter has given us so far. */
    const page = (target: Step, issues: readonly Issue[] = [], notice = uploadNotice) => (
      <OrangeFormPage
        step={target}
        answers={answers}
        issues={issues}
        locale={locale}
        attachments={attachments}
        notice={notice}
      />
    );

    /** Send the reporter to the first step that is not finished, with the reasons on it. */
    const blockOn = (blocking: Step) =>
      reply.status(422).html(page(blocking, validateStep(blocking, answers)));

    // ---- Language ------------------------------------------------------------
    if (action.startsWith("lang:")) {
      const chosen: Locale = parseLocale(action.slice("lang:".length));

      reply.setCookie(LOCALE_COOKIE, chosen, {
        path: "/",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
      });

      return reply.html(
        <OrangeFormPage
          step={step}
          answers={answers}
          locale={chosen}
          attachments={attachments}
          notice={uploadNotice}
        />,
      );
    }

    // ---- Navigation ----------------------------------------------------------
    if (action === "back") {
      return reply.html(page(shiftStep(step, -1)));
    }

    if (action.startsWith("goto:")) {
      const target = parseStep(action.slice("goto:".length));

      // Going back to re-read or correct something is always allowed. Skipping ahead is not:
      // every step before the target has to be complete first.
      if (target <= step) return reply.html(page(target));

      const blocking = firstIncompleteStep(answers, shiftStep(target, -1));
      return blocking === null ? reply.html(page(target)) : blockOn(blocking);
    }

    // ---- Forwards, and final submission --------------------------------------
    const issues = validateStep(step, answers);
    if (issues.length > 0) {
      return reply.status(422).html(page(step, issues));
    }

    if (action !== "submit") {
      return reply.html(page(shiftStep(step, 1)));
    }

    // Every step, not just the last: `required` in the browser is a convenience for the reporter,
    // never a guarantee to us, and nothing stops a client posting straight here.
    const blocking = firstIncompleteStep(answers);
    if (blocking !== null) return blockOn(blocking);

    const validation = validateSubmission(answers);
    if (!validation.ok) {
      return reply.status(422).html(page(LAST_STEP, [], validation.errors.join("; ")));
    }

    try {
      const number = await storeReport(app.db, validation.submission, attachments);
      request.log.info({ number, attachments: attachments.length }, "public report stored");

      return reply.html(<OrangeFormPage reportNumber={number} locale={locale} />);
    } catch (error) {
      // The reporter must not be told this succeeded, and must not lose what they typed.
      request.log.error({ err: error }, "could not store public report");

      return reply.status(503).html(page(LAST_STEP, [], t(locale, "error.notFiled")));
    }
  });

  // Unauthenticated liveness probe, scoped to this door.
  app.get("/healthz", async () => ({ status: "ok", door: "public" }));
}
