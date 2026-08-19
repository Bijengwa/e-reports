import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  type Answers,
  firstIncompleteStep,
  type Issue,
  parseStep,
  type Step,
  shiftStep,
  validateStep,
} from "../domain/form-schema.js";
import { type Submission, validateSubmission } from "../domain/reports.js";
import { isAllowedMimeType, MAX_ATTACHMENTS, type StoredObject } from "../storage/index.js";
import type { CarriedAttachment } from "./orange-form.js";

/**
 * The orange form's wizard, as both doors need it.
 *
 * The public door files what a reporter typed; the staff door files what an Officer transcribed
 * from an email. Those differ in who may open it, what language it is offered in, and what happens
 * once the row lands — and in nothing else. The parsing below and the rules in `advance` are the
 * part that must not differ, so they live here rather than once per door.
 *
 * There is no second schema: every rule still comes from `form-schema`.
 */

/** Fields that steer the wizard rather than answer a question. */
const CONTROL_FIELDS = new Set(["step", "action", "locale", "attachment_meta", "attachments"]);

export type ParsedForm = {
  fields: Record<string, string | string[]>;
  uploaded: StoredObject[];
  /** Names of files that were rejected, so the filer is told rather than left guessing. */
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
 * does not make the filer pick their photographs again — the keys are carried forward instead.
 */
export async function parseForm(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<ParsedForm> {
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
 * Everything that was typed, minus the fields that steer the wizard.
 *
 * Values are taken as they arrive and are never trusted as markup — the view escapes them on the
 * way back out.
 */
export function collectAnswers(fields: Record<string, string | string[]>): Answers {
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
 * key containing a uuid we generated, so a client cannot name its way to another filer's file.
 */
export function carriedAttachments(fields: Record<string, string | string[]>): CarriedAttachment[] {
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

/**
 * What one press of a wizard button means.
 *
 * `step` is somewhere to render, with the reasons it is not finished and the status to answer
 * with. `ready` is a submission that has passed every rule. `rejected` is one that reached the end
 * and still failed, which is a hand-written POST or a bug rather than a filer's mistake.
 */
export type Turn =
  | { kind: "step"; step: Step; issues: readonly Issue[]; status: 200 | 422 }
  | { kind: "ready"; submission: Submission }
  | { kind: "rejected"; errors: string[] };

/** Somewhere to render, with nothing wrong on it. */
function at(step: Step): Turn {
  return { kind: "step", step, issues: [], status: 200 };
}

/** Somewhere to render, with the reasons it is not finished. */
function blockOn(step: Step, answers: Answers): Turn {
  return { kind: "step", step, issues: validateStep(step, answers), status: 422 };
}

/**
 * The wizard's rules, with no I/O in them.
 *
 * Language switching is not here: only the public door offers it, and it changes what is rendered
 * rather than where the filer stands. Everything that decides whether a report may be filed is, so
 * neither door can be lenient where the other is strict.
 */
export function advance(rawStep: unknown, action: string, answers: Answers): Turn {
  const step = parseStep(rawStep);

  if (action === "back") return at(shiftStep(step, -1));

  if (action.startsWith("goto:")) {
    const target = parseStep(action.slice("goto:".length));

    // Going back to re-read or correct something is always allowed. Skipping ahead is not: every
    // step before the target has to be complete first.
    if (target <= step) return at(target);

    const blocking = firstIncompleteStep(answers, shiftStep(target, -1));
    return blocking === null ? at(target) : blockOn(blocking, answers);
  }

  const issues = validateStep(step, answers);
  if (issues.length > 0) return { kind: "step", step, issues, status: 422 };

  if (action !== "submit") return at(shiftStep(step, 1));

  // Every step, not just the last: `required` in the browser is a convenience for whoever is
  // typing, never a guarantee to us, and nothing stops a client posting straight here.
  const blocking = firstIncompleteStep(answers);
  if (blocking !== null) return blockOn(blocking, answers);

  const validation = validateSubmission(answers);

  return validation.ok
    ? { kind: "ready", submission: validation.submission }
    : { kind: "rejected", errors: validation.errors };
}
