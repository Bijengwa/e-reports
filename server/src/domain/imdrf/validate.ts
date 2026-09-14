/**
 * Turns the parser's flat rows into terms ready to insert, or refuses the whole payload.
 *
 * Everything about *data* soundness lives here rather than in the parser: annex resolvability,
 * required fields present, a hierarchy whose last segment is the row's own code, a `codeHierarchy`
 * unique across the payload, and a resolvable parent for every non-root row. A single error
 * anywhere means zero terms come out — "failed validation performs zero database writes" starts
 * here, one layer before the import service's transaction ever opens.
 *
 * `level` is always `codeHierarchy.split("|").length`, a fact about that record's own hierarchy
 * string, never a fixed number.
 *
 * `code` alone is deliberately not treated as unique, and duplicates are NOT rejected on `code`
 * alone. IMDRF's own Annex E cross-lists roughly 200 terms under more than one category branch,
 * reusing the same code at each hierarchy position it appears at (confirmed in the real 2026
 * export: code `E0104` appears at four distinct `codehierarchy` positions, e.g. under both the
 * Nervous System and Vascular System branches — the same term, deliberately shown in two places).
 * `codeHierarchy` is what is actually unique, so duplicate detection and parent resolution both
 * key on it rather than on `code`.
 */

import type { ParsedPayload, ParseIssue } from "./parser.js";
import { ANNEXES, type Annex, type AnnexSummary, isAnnex } from "./types.js";

export type ValidatedTerm = {
  id: string;
  annex: Annex;
  code: string;
  term: string;
  definition: string | null;
  nonImdrfCode: string | null;
  status: string | null;
  statusDescription: string | null;
  primaryCategory: string | null;
  secondaryCategory: string | null;
  codeHierarchy: string;
  parentTermId: string | null;
  level: number;
  sortOrder: number;
};

export type ValidationIssue = ParseIssue;

export type ValidationResult =
  | {
      ok: true;
      terms: ValidatedTerm[];
      summary: AnnexSummary[];
      total: number;
      issues: ValidationIssue[];
    }
  | { ok: false; issues: ValidationIssue[] };

function summarize(terms: ValidatedTerm[]): AnnexSummary[] {
  const counts = new Map<Annex, number>();
  for (const annex of ANNEXES) counts.set(annex, 0);
  for (const term of terms) counts.set(term.annex, (counts.get(term.annex) ?? 0) + 1);
  return ANNEXES.map((annex) => ({ annex, count: counts.get(annex) ?? 0 }));
}

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/**
 * Validates a parsed payload. `expectedReleaseYear` is release-level metadata the administrator
 * supplies via the import form — the real IMDRF JSON export carries no release year field of its
 * own, so there is nothing in the payload to cross-check it against; this function only confirms
 * the year itself is sane (the route layer already enforces this with `zod`, but the domain layer
 * does not trust that every caller goes through that route).
 *
 * Structural checks (annex resolvable, required fields, hierarchy tail matches code) run first and
 * collect every failure before parent resolution ever starts, so a payload with five unrelated bad
 * records is reported with five issues in one pass rather than one at a time across five re-pastes.
 */
export function validateParsedPayload(
  parsed: ParsedPayload,
  expectedReleaseYear: number,
): ValidationResult {
  const issues: ValidationIssue[] = [...parsed.issues];

  if (
    !Number.isInteger(expectedReleaseYear) ||
    expectedReleaseYear < MIN_YEAR ||
    expectedReleaseYear > MAX_YEAR
  ) {
    issues.push({
      severity: "error",
      annex: null,
      index: null,
      field: "releaseYear",
      message: `Release year ${expectedReleaseYear} is not a valid year (expected ${MIN_YEAR}-${MAX_YEAR}).`,
    });
  }

  if (parsed.rows.length === 0 && !issues.some((issue) => issue.severity === "error")) {
    issues.push({
      severity: "error",
      annex: null,
      index: null,
      field: null,
      message: "The payload contains no terminology records.",
    });
  }

  // Structural pass: every row that can be a term at all gets an id here; a row that fails any
  // structural check is excluded from `candidates` (and therefore never becomes a parent target
  // or an inserted term), and its problem is recorded as an issue naming the exact index/field.
  //
  // Keyed on `codeHierarchy`, not `code`: `code` alone can legitimately repeat (see the module
  // comment), but the same hierarchy string appearing twice would mean two records claiming the
  // exact same position in the tree, which is a genuine conflict.
  const candidates: { id: string; row: (typeof parsed.rows)[number] }[] = [];
  const hierarchyToId = new Map<string, string>();
  const hierarchySeenAt = new Map<string, number>();

  for (const row of parsed.rows) {
    const where = { annex: row.annex, index: row.index };

    if (row.annex === null || !isAnnex(row.annex)) {
      issues.push({
        ...where,
        severity: "error",
        field: "code",
        message: `Record at index ${row.index} has code "${row.code ?? ""}", which does not resolve to a known Annex (A-G).`,
      });
      continue;
    }
    if (row.code === null) {
      issues.push({
        ...where,
        severity: "error",
        field: "code",
        message: 'Field "code" is missing.',
      });
      continue;
    }
    if (row.term === null) {
      issues.push({
        ...where,
        severity: "error",
        field: "term",
        message: 'Field "term" is missing.',
      });
      continue;
    }
    if (row.codeHierarchy === null) {
      issues.push({
        ...where,
        severity: "error",
        field: "codehierarchy",
        message: 'Field "codehierarchy" is missing.',
      });
      continue;
    }

    const segments = row.codeHierarchy.split("|");
    const lastSegment = segments[segments.length - 1];
    if (lastSegment !== row.code) {
      issues.push({
        ...where,
        severity: "error",
        field: "codehierarchy",
        message: `codehierarchy "${row.codeHierarchy}" does not end with this record's own code "${row.code}".`,
      });
      continue;
    }

    if (hierarchySeenAt.has(row.codeHierarchy)) {
      const firstIndex = hierarchySeenAt.get(row.codeHierarchy);
      issues.push({
        ...where,
        severity: "error",
        field: "codehierarchy",
        message: `codehierarchy "${row.codeHierarchy}" is a duplicate of the one first seen at index ${firstIndex}.`,
      });
      continue;
    }

    const id = crypto.randomUUID();
    hierarchyToId.set(row.codeHierarchy, id);
    hierarchySeenAt.set(row.codeHierarchy, row.index);
    candidates.push({ id, row });
  }

  // Parent resolution, over only the rows that survived the structural pass.
  const terms: ValidatedTerm[] = [];
  for (const { id, row } of candidates) {
    const codeHierarchy = row.codeHierarchy as string;
    const segments = codeHierarchy.split("|");
    const level = segments.length;
    let parentTermId: string | null = null;

    if (level > 1) {
      // The parent is whichever row's own `codeHierarchy` equals this row's hierarchy with its
      // last segment removed — not "the row whose code is the second-to-last segment", which
      // breaks the moment a code (legitimately) appears at more than one hierarchy position.
      const parentHierarchy = segments.slice(0, -1).join("|");
      const parentId = hierarchyToId.get(parentHierarchy);
      if (parentId === undefined) {
        issues.push({
          annex: row.annex,
          index: row.index,
          severity: "error",
          field: "codehierarchy",
          message: `No record with codehierarchy "${parentHierarchy}" exists in this payload to be the parent of "${row.codeHierarchy}".`,
        });
        continue;
      }
      parentTermId = parentId;
    }

    terms.push({
      id,
      annex: row.annex as Annex,
      code: row.code as string,
      term: row.term as string,
      definition: row.definition,
      nonImdrfCode: row.nonImdrfCode,
      status: row.status,
      statusDescription: row.statusDescription,
      primaryCategory: row.primaryCategory,
      secondaryCategory: row.secondaryCategory,
      codeHierarchy,
      parentTermId,
      level,
      sortOrder: row.index,
    });
  }

  if (issues.some((issue) => issue.severity === "error")) {
    return { ok: false, issues };
  }

  return { ok: true, terms, summary: summarize(terms), total: terms.length, issues };
}
