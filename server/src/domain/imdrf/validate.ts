/**
 * Turns the parser's flat rows into terms ready to insert, or refuses the whole workbook.
 *
 * Everything about *data* soundness lives here rather than in the parser: annex membership, one
 * filled "Level N Term" per row, a hierarchy whose last segment is the row's own code, a
 * `codeHierarchy` unique across the release, a resolvable parent for every non-root row, and the
 * release year the workbook actually claims matching the one the administrator is importing. A
 * single error anywhere means zero terms come out — "failed validation performs zero database
 * writes" starts here, one layer before the import service's transaction ever opens.
 *
 * `level` is always `codeHierarchy.split("|").length`, never a fixed number and never read off
 * which "Level N Term" column happened to hold the text — those columns are what the parser reads
 * the term itself from, and the depth of an annex's hierarchy is a fact about that annex's own
 * data, not about how many "Level N Term" columns its sheet happened to have.
 *
 * `code` alone is deliberately not treated as unique. IMDRF's own Annex E cross-lists roughly 200
 * terms under more than one category branch, reusing the same code at each hierarchy position it
 * appears at (e.g. E0104 "Cerebral Hyperperfusion Syndrome" appears at both E01|E0104, under
 * Nervous System, and E05|E0104, under Vascular System — the same term, deliberately shown in two
 * places). `codeHierarchy` is what is actually unique, so duplicate detection and parent
 * resolution both key on it rather than on `code`.
 */

import type { ParsedWorkbook, ParseIssue } from "./parser.js";
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

/**
 * Validates a parsed workbook against the release year an administrator is importing it as.
 *
 * Structural checks (annex, required fields, exactly one filled level column, hierarchy tail
 * matches code) run first and collect every failure before parent resolution ever starts, so a
 * workbook with five unrelated bad rows is reported with five issues in one pass rather than one
 * at a time across five re-uploads.
 */
export function validateParsedWorkbook(
  parsed: ParsedWorkbook,
  expectedReleaseYear: number,
): ValidationResult {
  const issues: ValidationIssue[] = [...parsed.issues];

  if (parsed.releaseYearsFound.size === 0) {
    issues.push({
      severity: "error",
      annex: null,
      sheet: "(workbook)",
      row: null,
      field: "Release Number",
      message: 'No "Release Number:" value was found anywhere in the workbook.',
    });
  } else {
    for (const year of parsed.releaseYearsFound) {
      if (year !== expectedReleaseYear) {
        issues.push({
          severity: "error",
          annex: null,
          sheet: "(workbook)",
          row: null,
          field: "Release Number",
          message: `The workbook declares release year ${year}, but you are importing it as ${expectedReleaseYear}.`,
        });
      }
    }
  }

  // Structural pass: every row that can be a term at all gets an id here; a row that fails any
  // structural check is excluded from `candidates` (and therefore never becomes a parent target
  // or an inserted term), and its problem is recorded as an issue naming the exact sheet/row.
  //
  // Keyed on `codeHierarchy`, not `code`: `code` alone can legitimately repeat (see the module
  // comment), but the same hierarchy string appearing twice would mean two rows claiming the
  // exact same position in the tree, which is a genuine conflict.
  const candidates: { id: string; parsed: (typeof parsed.rows)[number] }[] = [];
  const hierarchyToId = new Map<string, string>();
  const hierarchySeenAt = new Map<string, number>();

  for (const row of parsed.rows) {
    const where = { annex: row.annex, sheet: row.sheetName, row: row.rowNumber };

    if (!isAnnex(row.annex)) {
      issues.push({
        ...where,
        severity: "error",
        field: "annex",
        message: `Annex "${row.annex}" is not one of A-G.`,
      });
      continue;
    }
    if (row.code === null) {
      issues.push({ ...where, severity: "error", field: "Code", message: "Code is missing." });
      continue;
    }
    if (row.term === null) {
      issues.push({ ...where, severity: "error", field: "Term", message: "Term is missing." });
      continue;
    }
    if (row.codeHierarchy === null) {
      issues.push({
        ...where,
        severity: "error",
        field: "CodeHierarchy",
        message: "CodeHierarchy is missing.",
      });
      continue;
    }
    if (row.filledLevelColumns !== 1) {
      issues.push({
        ...where,
        severity: "error",
        field: "Level N Term",
        message: `Expected exactly one filled "Level N Term" column, found ${row.filledLevelColumns}.`,
      });
      continue;
    }

    const segments = row.codeHierarchy.split("|");
    const lastSegment = segments[segments.length - 1];
    if (lastSegment !== row.code) {
      issues.push({
        ...where,
        severity: "error",
        field: "CodeHierarchy",
        message: `CodeHierarchy "${row.codeHierarchy}" does not end with this row's own code "${row.code}".`,
      });
      continue;
    }

    if (hierarchySeenAt.has(row.codeHierarchy)) {
      const firstRow = hierarchySeenAt.get(row.codeHierarchy);
      issues.push({
        ...where,
        severity: "error",
        field: "CodeHierarchy",
        message: `CodeHierarchy "${row.codeHierarchy}" is a duplicate of the one first seen at row ${firstRow}.`,
      });
      continue;
    }

    const id = crypto.randomUUID();
    hierarchyToId.set(row.codeHierarchy, id);
    hierarchySeenAt.set(row.codeHierarchy, row.rowNumber);
    candidates.push({ id, parsed: row });
  }

  // Parent resolution, over only the rows that survived the structural pass.
  const terms: ValidatedTerm[] = [];
  for (const { id, parsed: row } of candidates) {
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
          sheet: row.sheetName,
          row: row.rowNumber,
          severity: "error",
          field: "CodeHierarchy",
          message: `No term with CodeHierarchy "${parentHierarchy}" exists in this workbook to be the parent of "${row.codeHierarchy}".`,
        });
        continue;
      }
      parentTermId = parentId;
    }

    terms.push({
      id,
      annex: row.annex,
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
      sortOrder: row.sourceOrder,
    });
  }

  if (issues.some((issue) => issue.severity === "error")) {
    return { ok: false, issues };
  }

  return { ok: true, terms, summary: summarize(terms), total: terms.length, issues };
}
