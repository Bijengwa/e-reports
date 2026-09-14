/**
 * Turns a pasted IMDRF JSON payload into rows, without trusting its shape.
 *
 * This module owns exactly one job: parse the JSON text an administrator pasted, confirm it has
 * the shape IMDRF's own exports actually use, and map each terminology record to a flat row by
 * field name. Nothing here judges whether the *data* is sound — a hierarchy whose parent is
 * missing, a duplicate tree position, a record that belongs to the wrong annex — that is
 * `validate.ts`'s job, over the flat rows this module hands it.
 *
 * The real IMDRF export (verified against the official 2026 JSON, all 8 published payload
 * variants — the consolidated Annexes A-G file and each of the 7 single-annex files) is a bare
 * top-level JSON ARRAY, never an object with a `releaseYear`/`annexes` wrapper. Each element
 * looks like:
 * ```json
 * {
 *   "code": "A0101",
 *   "term": "Patient-Device Incompatibility",
 *   "definition": "...",
 *   "non-IMDRF code": "MedDRA:10092649:...",
 *   "status": "",
 *   "status description": "",
 *   "primary category": "",
 *   "secondary category": "",
 *   "codehierarchy": "A|A01|A0101"
 * }
 * ```
 * Field names use spaces, and casing is inconsistent between the consolidated export
 * (`"non-IMDRF code"`) and the single-annex exports (`"non-imdrf code"`) — this module matches
 * field names case-insensitively rather than trusting one spelling.
 *
 * `codehierarchy` is pipe-separated, and its segments are the progressive chain of codes from the
 * annex root down to the record; the last segment always equals the record's own `code`. Two
 * distinct shapes appear in the real exports:
 *  - The **consolidated** file includes a bare annex-root record for each annex (`code: "A"`,
 *    `codehierarchy: "A"`), and every other record's hierarchy begins with that same bare letter
 *    (e.g. `"A|A01|A0101"`).
 *  - Each **single-annex** file omits that root record entirely — its hierarchies start directly
 *    at the first real code (e.g. `"A01|A0101"`, `"G01"`), never with a bare letter segment.
 * A payload is therefore classified as "consolidated" if any record's `codehierarchy` is exactly
 * a bare annex letter (A-G) equal to its own `code`, and as "single-annex" otherwise. This is a
 * fact discoverable in the data itself, not a wrapper field — there is no metadata field in any
 * of the 8 real payloads that states which shape it is.
 *
 * Every record's own annex is derived from the first character of its `code` (A-G), which is
 * true of both shapes: `"A"` and `"A0101"` both start with `A`, `"G07003"` starts with `G`.
 */

import { ANNEXES, type Annex, isAnnex } from "./types.js";

export type ParsedRow = {
  /** 1-based position of this record within the top-level array — used in every error message
   *  and in the preview's "index/row" column. */
  index: number;
  /** Derived from the first character of `code`. `null` when `code` is missing/invalid, in which
   *  case `validate.ts` reports the row as unresolvable rather than this module guessing. */
  annex: Annex | null;
  term: string | null;
  code: string | null;
  definition: string | null;
  nonImdrfCode: string | null;
  status: string | null;
  statusDescription: string | null;
  primaryCategory: string | null;
  secondaryCategory: string | null;
  codeHierarchy: string | null;
};

export type ParseIssue = {
  severity: "error" | "warning";
  annex: Annex | null;
  /** 1-based position of the offending record in the top-level array, or `null` for a
   *  payload-level problem (not-JSON, not-an-array, empty array). */
  index: number | null;
  field: string | null;
  message: string;
};

/** How the parser classified the payload, from the data itself — see the module comment. `null`
 *  when the payload is empty or too malformed to classify. */
export type PayloadShape = "consolidated" | "single-annex";

export type ParsedPayload = {
  rows: ParsedRow[];
  issues: ParseIssue[];
  /** Every annex any row resolved to, regardless of whether that row later fails validation. */
  annexesFound: Set<Annex>;
  shape: PayloadShape | null;
};

/** Hard ceiling on the pasted payload's byte size, enforced before `JSON.parse` ever runs — a
 *  malicious or accidental multi-hundred-MB paste is rejected on size alone, never parsed. */
export const MAX_PAYLOAD_BYTES = 15 * 1024 * 1024; // 15 MB — generous for ~2,100 terms/annex.

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return String(value).trim() === "" ? null : String(value).trim();
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed === "" ? null : trimmed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Case-insensitive field lookup: IMDRF's own exports spell `"non-IMDRF code"` in the
 *  consolidated file and `"non-imdrf code"` in the single-annex files. Every key is folded to a
 *  trimmed lowercase form once per record rather than trying every known spelling per field. */
function lowerKeyed(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key.trim().toLowerCase()] = value;
  }
  return out;
}

function annexOf(code: string | null): Annex | null {
  if (code === null || code.length === 0) return null;
  const letter = code.charAt(0).toUpperCase();
  return isAnnex(letter) ? letter : null;
}

function payloadIssue(message: string, field: string | null = null): ParseIssue {
  return { severity: "error", annex: null, index: null, field, message };
}

/**
 * Parses a pasted JSON payload. Never throws for malformed content — every structural problem
 * becomes an `error`-severity `ParseIssue` instead, and parsing stops as soon as the shape is too
 * broken to say anything more specific (not valid JSON, not a top-level array, an empty array). A
 * `bytesLength` over `MAX_PAYLOAD_BYTES` is rejected before `JSON.parse` is attempted at all.
 */
export function parseImdrfPayload(payloadText: string): ParsedPayload {
  const issues: ParseIssue[] = [];
  const rows: ParsedRow[] = [];
  const annexesFound = new Set<Annex>();

  const byteLength = Buffer.byteLength(payloadText, "utf8");
  if (byteLength > MAX_PAYLOAD_BYTES) {
    issues.push(
      payloadIssue(
        `The pasted payload is ${(byteLength / (1024 * 1024)).toFixed(1)} MB, which exceeds the ${(MAX_PAYLOAD_BYTES / (1024 * 1024)).toFixed(0)} MB limit.`,
      ),
    );
    return { rows, issues, annexesFound, shape: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadText);
  } catch (error) {
    issues.push(
      payloadIssue(
        `The pasted text is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return { rows, issues, annexesFound, shape: null };
  }

  if (!Array.isArray(parsed)) {
    issues.push(
      payloadIssue(
        "The payload must be a JSON array of terminology records — the official IMDRF export is a " +
          "bare array, not an object with a wrapper key.",
      ),
    );
    return { rows, issues, annexesFound, shape: null };
  }

  if (parsed.length === 0) {
    issues.push(payloadIssue("The payload is an empty array; it contains no terminology records."));
    return { rows, issues, annexesFound, shape: null };
  }

  parsed.forEach((record, arrayIndex) => {
    const index = arrayIndex + 1;
    if (!isPlainObject(record)) {
      issues.push({
        severity: "error",
        annex: null,
        index,
        field: null,
        message: `Record at index ${index} is not a JSON object.`,
      });
      return;
    }

    const f = lowerKeyed(record);
    const code = textOrNull(f["code"]);
    const codeHierarchy = textOrNull(f["codehierarchy"]);
    const annex = annexOf(code);
    if (annex) annexesFound.add(annex);

    rows.push({
      index,
      annex,
      code,
      term: textOrNull(f["term"]),
      definition: textOrNull(f["definition"]),
      nonImdrfCode: textOrNull(f["non-imdrf code"]),
      status: textOrNull(f["status"]),
      statusDescription: textOrNull(f["status description"]),
      primaryCategory: textOrNull(f["primary category"]),
      secondaryCategory: textOrNull(f["secondary category"]),
      codeHierarchy,
    });
  });

  // Classify the payload's shape from the data itself (see module comment): a "consolidated"
  // payload carries at least one bare annex-root record whose codehierarchy is just its own
  // single-letter code.
  const isConsolidated = rows.some(
    (row) => row.code !== null && row.code.length === 1 && row.codeHierarchy === row.code,
  );
  const shape: PayloadShape | null =
    annexesFound.size === 0 ? null : isConsolidated ? "consolidated" : "single-annex";

  // A single-annex payload (no root markers found) is expected to hold exactly one annex. Real
  // IMDRF exports never mix annexes without the root markers, so any record whose own annex
  // differs from the first resolvable row's annex is flagged rather than silently accepted or
  // silently dropped.
  if (shape === "single-annex") {
    const expected = rows.find((row) => row.annex !== null)?.annex ?? null;
    if (expected) {
      for (const row of rows) {
        if (row.annex !== null && row.annex !== expected) {
          issues.push({
            severity: "error",
            annex: row.annex,
            index: row.index,
            field: "codehierarchy",
            message: `Record at index ${row.index} belongs to Annex ${row.annex}, but this payload was detected as a single-annex Annex ${expected} payload (from its first record). A single-annex payload must not mix annexes.`,
          });
        }
      }
    }
  }

  return { rows, issues, annexesFound, shape };
}

/** Human-readable label for a parsed payload's detected shape, for the preview UI. */
export function describePayloadShape(shape: PayloadShape | null, annexesFound: Set<Annex>): string {
  if (shape === "consolidated") {
    const letters = ANNEXES.filter((a) => annexesFound.has(a));
    return `Consolidated Annexes ${letters.length > 0 ? letters.join("-") : "A-G"}`;
  }
  if (shape === "single-annex") {
    const [only] = annexesFound;
    return only ? `Annex ${only}` : "Single annex";
  }
  return "Unrecognized payload";
}
