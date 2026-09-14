/**
 * Turns a pasted IMDRF JSON payload into rows, without trusting its shape.
 *
 * This module owns exactly one job: parse the JSON text an administrator pasted, confirm it has
 * the expected top-level release/annex structure, and map each terminology record to a flat row
 * by field name. Nothing here judges whether the *data* is sound — a code that duplicates another
 * annex's, a hierarchy whose parent is missing, a level that does not match its own segment count
 * — that is `validate.ts`'s job, over the flat rows this module hands it. Splitting the two means
 * a payload with a broken shape (invalid JSON, missing `annexes`, an annex that isn't an array)
 * fails here with a structural error, and a payload with a sound shape but bad data fails there
 * with a data error.
 *
 * Expected payload shape (the "official IMDRF payload" administrators paste verbatim):
 * ```json
 * {
 *   "releaseYear": 2026,
 *   "documentCode": "IMDRF/AE WG/N43",
 *   "title": "IMDRF Adverse Event Terminology",
 *   "annexes": {
 *     "A": [
 *       {
 *         "term": "...", "code": "...", "codeHierarchy": "A01|A0101",
 *         "definition": "...", "nonImdrfCode": "...", "status": "...",
 *         "statusDescription": "...", "primaryCategory": "...", "secondaryCategory": "..."
 *       }
 *     ],
 *     "B": [ ... ], "C": [ ... ], "D": [ ... ], "E": [ ... ], "F": [ ... ], "G": [ ... ]
 *   }
 * }
 * ```
 * Only `term`, `code` and `codeHierarchy` are required per record; every other field is optional
 * and stored verbatim (or `null`) exactly as `validate.ts` already expects from the old workbook
 * parser, so the rest of the pipeline (validate → import-service → schema) is unchanged.
 */

import { ANNEXES, type Annex, isAnnex } from "./types.js";

export type ParsedRow = {
  annex: Annex;
  /** 1-based position of this record within its annex's array, for error messages. */
  rowNumber: number;
  /** 0-based order among the rows emitted for this annex, independent of gaps. */
  sourceOrder: number;
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
  /** Kept as "sheet" for compatibility with the validator/admin views built for the old workbook
   *  parser; for a JSON payload this is always "(payload)" or an annex letter. */
  sheet: string;
  row: number | null;
  field: string | null;
  message: string;
};

export type ParsedWorkbook = {
  rows: ParsedRow[];
  issues: ParseIssue[];
  /** The release year the payload itself declares, for the caller to cross-check. */
  releaseYearsFound: Set<number>;
  /** Every annex key present in `annexes`, whether or not its array held any valid records. */
  annexesFound: Set<Annex>;
};

/** Hard ceiling on the pasted payload's byte size, enforced before `JSON.parse` ever runs — a
 *  malicious or accidental multi-hundred-MB paste is rejected on size alone, never parsed. */
export const MAX_PAYLOAD_BYTES = 15 * 1024 * 1024; // 15 MB — generous for ~2,100 terms/release.

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return String(value).trim() === "" ? null : String(value).trim();
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed === "" ? null : trimmed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structuralIssue(message: string, field: string | null = null): ParseIssue {
  return { severity: "error", annex: null, sheet: "(payload)", row: null, field, message };
}

/**
 * Parses a pasted JSON payload. Never throws for malformed content — every structural problem
 * becomes an `error`-severity `ParseIssue` instead, and parsing stops as soon as the shape is too
 * broken to say anything more specific (e.g. the payload isn't even an object). A `bytesLength`
 * over `MAX_PAYLOAD_BYTES` is rejected before `JSON.parse` is attempted at all.
 */
export function parseImdrfPayload(payloadText: string): ParsedWorkbook {
  const issues: ParseIssue[] = [];
  const rows: ParsedRow[] = [];
  const releaseYearsFound = new Set<number>();
  const annexesFound = new Set<Annex>();

  const byteLength = Buffer.byteLength(payloadText, "utf8");
  if (byteLength > MAX_PAYLOAD_BYTES) {
    issues.push(
      structuralIssue(
        `The pasted payload is ${(byteLength / (1024 * 1024)).toFixed(1)} MB, which exceeds the ${(MAX_PAYLOAD_BYTES / (1024 * 1024)).toFixed(0)} MB limit.`,
      ),
    );
    return { rows, issues, releaseYearsFound, annexesFound };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadText);
  } catch (error) {
    issues.push(
      structuralIssue(
        `The pasted text is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return { rows, issues, releaseYearsFound, annexesFound };
  }

  if (!isPlainObject(parsed)) {
    issues.push(structuralIssue("The payload must be a JSON object, not an array or scalar."));
    return { rows, issues, releaseYearsFound, annexesFound };
  }

  const releaseYearRaw = parsed.releaseYear;
  if (typeof releaseYearRaw !== "number" || !Number.isInteger(releaseYearRaw)) {
    issues.push(
      structuralIssue('"releaseYear" is required and must be a whole number.', "releaseYear"),
    );
  } else {
    releaseYearsFound.add(releaseYearRaw);
  }

  const annexesRaw = parsed.annexes;
  if (!isPlainObject(annexesRaw)) {
    issues.push(
      structuralIssue(
        '"annexes" is required and must be an object keyed by annex letter (A-G).',
        "annexes",
      ),
    );
    return { rows, issues, releaseYearsFound, annexesFound };
  }

  for (const key of Object.keys(annexesRaw)) {
    const normalized = key.trim().toUpperCase();
    if (!isAnnex(normalized)) {
      issues.push(
        structuralIssue(
          `"annexes" has an unrecognized key "${key}"; expected one of ${ANNEXES.join(", ")}.`,
          "annexes",
        ),
      );
      continue;
    }

    const list = annexesRaw[key];
    annexesFound.add(normalized);

    if (!Array.isArray(list)) {
      issues.push(
        structuralIssue(
          `"annexes.${key}" must be an array of terminology records.`,
          `annexes.${key}`,
        ),
      );
      continue;
    }

    let sourceOrder = 0;
    list.forEach((record, index) => {
      const rowNumber = index + 1;
      if (!isPlainObject(record)) {
        issues.push({
          severity: "error",
          annex: normalized,
          sheet: normalized,
          row: rowNumber,
          field: null,
          message: `Record ${rowNumber} in annex ${normalized} is not a JSON object.`,
        });
        return;
      }

      rows.push({
        annex: normalized,
        rowNumber,
        sourceOrder: sourceOrder++,
        term: textOrNull(record.term),
        code: textOrNull(record.code),
        definition: textOrNull(record.definition),
        nonImdrfCode: textOrNull(record.nonImdrfCode ?? record.non_imdrf_code),
        status: textOrNull(record.status),
        statusDescription: textOrNull(record.statusDescription ?? record.status_description),
        primaryCategory: textOrNull(record.primaryCategory ?? record.primary_category),
        secondaryCategory: textOrNull(record.secondaryCategory ?? record.secondary_category),
        codeHierarchy: textOrNull(record.codeHierarchy ?? record.code_hierarchy),
      });
    });
  }

  return { rows, issues, releaseYearsFound, annexesFound };
}
