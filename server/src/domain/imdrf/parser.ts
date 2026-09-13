/**
 * Turns an uploaded IMDRF workbook into rows, without trusting its layout.
 *
 * This module owns exactly one job: find the annex sheets, find each one's own header row (which
 * is not always at the same row number, and whose columns are not identical from one annex to the
 * next), and map cells to fields by what the header says rather than by position. Nothing here
 * judges whether the *data* is sound — a code that duplicates another annex's, a hierarchy whose
 * parent is missing, a level that does not match its own segment count — that is `validate.ts`'s
 * job, over the flat rows this module hands it. Splitting the two means a workbook with a broken
 * layout (wrong headers, no annex sheets) fails here with a structural error, and a workbook with
 * a sound layout but bad data fails there with a data error — two different failures an
 * administrator would otherwise have to untangle from one pile of messages.
 */

import type ExcelJS from "exceljs";
import { type Annex, isAnnex } from "./types.js";

export type ParsedRow = {
  annex: Annex;
  sheetName: string;
  /** 1-based row number in the sheet, for error messages an administrator can act on. */
  rowNumber: number;
  /** 0-based order among the rows emitted for this annex, independent of Excel row gaps. */
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
  /** How many "Level N Term" cells were non-blank on this row. Valid data has exactly one. */
  filledLevelColumns: number;
};

export type ParseIssue = {
  severity: "error" | "warning";
  annex: Annex | null;
  sheet: string;
  row: number | null;
  field: string | null;
  message: string;
};

export type ParsedWorkbook = {
  rows: ParsedRow[];
  issues: ParseIssue[];
  /** Every "Release Number:" year found on any sheet, for the caller to cross-check. */
  releaseYearsFound: Set<number>;
};

type ColumnMap = {
  levelColumns: Map<number, number>; // level number -> 1-based column index
  code: number;
  hierarchy: number;
  definition: number | null;
  nonImdrfCode: number | null;
  status: number | null;
  statusDescription: number | null;
  primaryCategory: number | null;
  secondaryCategory: number | null;
};

const HEADER_SCAN_ROWS = 30;
const RELEASE_NUMBER_SCAN_ROWS = 10;

/** Joins rich-text runs and stringifies anything else, trimmed and whitespace-collapsed. */
function plainText(value: ExcelJS.CellValue): string {
  let text: string;
  if (value && typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    text = value.richText.map((run) => run.text ?? "").join("");
  } else if (value === null || value === undefined) {
    text = "";
  } else if (value instanceof Date) {
    text = value.toISOString();
  } else {
    text = String(value);
  }
  return text.trim().replace(/\s+/g, " ");
}

function normalizeHeader(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The annex letter a sheet's own "Annex Name:" cell claims, if row 1 says so at all. */
function claimedAnnex(sheet: ExcelJS.Worksheet): Annex | null {
  const row1 = plainText(sheet.getRow(1).getCell(1).value);
  const match = row1.match(/annex name:\s*annex\s*([a-g])\b/i);
  if (!match) return null;
  const letter = match[1]?.toUpperCase() ?? "";
  return isAnnex(letter) ? letter : null;
}

/** Which annex (if any) this sheet's own name/content say it holds, and whether they agree. */
function resolveSheetAnnex(sheet: ExcelJS.Worksheet, issues: ParseIssue[]): Annex | null {
  const trimmedName = sheet.name.trim().toUpperCase();
  const byName = isAnnex(trimmedName) ? trimmedName : null;
  const byContent = claimedAnnex(sheet);

  if (byName && byContent && byName !== byContent) {
    issues.push({
      severity: "error",
      annex: null,
      sheet: sheet.name,
      row: 1,
      field: null,
      message: `Sheet "${sheet.name}" is named annex ${byName} but its own "Annex Name:" cell claims annex ${byContent}.`,
    });
    return null;
  }

  return byName ?? byContent;
}

function findHeaderRow(sheet: ExcelJS.Worksheet): number | null {
  const lastRow = Math.min(sheet.rowCount, HEADER_SCAN_ROWS);
  for (let r = 1; r <= lastRow; r++) {
    const first = plainText(sheet.getRow(r).getCell(1).value);
    if (first === "Level 1 Term") return r;
  }
  return null;
}

function buildColumnMap(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
  issues: ParseIssue[],
): ColumnMap | null {
  const levelColumns = new Map<number, number>();
  let code: number | null = null;
  let hierarchy: number | null = null;
  let definition: number | null = null;
  let nonImdrfCode: number | null = null;
  let status: number | null = null;
  let statusDescription: number | null = null;
  let primaryCategory: number | null = null;
  let secondaryCategory: number | null = null;

  const row = sheet.getRow(headerRow);
  for (let c = 1; c <= sheet.columnCount; c++) {
    const header = normalizeHeader(plainText(row.getCell(c).value));
    if (header === "") continue;

    const levelMatch = header.match(/^level (\d+) term$/);
    if (levelMatch) {
      levelColumns.set(Number(levelMatch[1]), c);
    } else if (header === "code") {
      code = c;
    } else if (header === "codehierarchy") {
      hierarchy = c;
    } else if (header === "definition") {
      definition = c;
    } else if (header.startsWith("non-imdrf code")) {
      nonImdrfCode = c;
    } else if (header === "status") {
      status = c;
    } else if (header === "status description") {
      statusDescription = c;
    } else if (header === "primary category") {
      primaryCategory = c;
    } else if (header === "secondary category") {
      secondaryCategory = c;
    }
  }

  if (levelColumns.size === 0) {
    issues.push({
      severity: "error",
      annex: null,
      sheet: sheet.name,
      row: headerRow,
      field: null,
      message: `No "Level N Term" column found on sheet "${sheet.name}"'s header row ${headerRow}.`,
    });
    return null;
  }
  if (code === null) {
    issues.push({
      severity: "error",
      annex: null,
      sheet: sheet.name,
      row: headerRow,
      field: "Code",
      message: `No "Code" column found on sheet "${sheet.name}"'s header row ${headerRow}.`,
    });
    return null;
  }
  if (hierarchy === null) {
    issues.push({
      severity: "error",
      annex: null,
      sheet: sheet.name,
      row: headerRow,
      field: "CodeHierarchy",
      message: `No "CodeHierarchy" column found on sheet "${sheet.name}"'s header row ${headerRow}.`,
    });
    return null;
  }

  return {
    levelColumns,
    code,
    hierarchy,
    definition,
    nonImdrfCode,
    status,
    statusDescription,
    primaryCategory,
    secondaryCategory,
  };
}

function cellTextOrNull(row: ExcelJS.Row, column: number | null): string | null {
  if (column === null) return null;
  const text = plainText(row.getCell(column).value);
  return text === "" ? null : text;
}

function isRowBlank(row: ExcelJS.Row, columnCount: number): boolean {
  for (let c = 1; c <= columnCount; c++) {
    if (plainText(row.getCell(c).value) !== "") return false;
  }
  return true;
}

function parseSheet(sheet: ExcelJS.Worksheet, annex: Annex, issues: ParseIssue[]): ParsedRow[] {
  const headerRow = findHeaderRow(sheet);
  if (headerRow === null) {
    issues.push({
      severity: "error",
      annex,
      sheet: sheet.name,
      row: null,
      field: null,
      message: `Could not find the header row (a cell reading exactly "Level 1 Term") on sheet "${sheet.name}" within its first ${HEADER_SCAN_ROWS} rows.`,
    });
    return [];
  }

  const columns = buildColumnMap(sheet, headerRow, issues);
  if (!columns) return [];

  const rows: ParsedRow[] = [];
  let sourceOrder = 0;

  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (isRowBlank(row, sheet.columnCount)) continue;

    let term: string | null = null;
    let filledLevelColumns = 0;
    // Ascending by level number, so when more than one is (invalidly) filled, `term` is the
    // shallowest one — a stable, arbitrary-but-deterministic choice the validator's own error
    // makes moot in practice (that row is rejected regardless of which text `term` ends up as).
    const levelNumbers = [...columns.levelColumns.keys()].sort((a, b) => a - b);
    for (const level of levelNumbers) {
      const column = columns.levelColumns.get(level);
      if (column === undefined) continue;
      const text = cellTextOrNull(row, column);
      if (text !== null) {
        filledLevelColumns++;
        if (term === null) term = text;
      }
    }

    rows.push({
      annex,
      sheetName: sheet.name,
      rowNumber: r,
      sourceOrder: sourceOrder++,
      term,
      code: cellTextOrNull(row, columns.code),
      definition: cellTextOrNull(row, columns.definition),
      nonImdrfCode: cellTextOrNull(row, columns.nonImdrfCode),
      status: cellTextOrNull(row, columns.status),
      statusDescription: cellTextOrNull(row, columns.statusDescription),
      primaryCategory: cellTextOrNull(row, columns.primaryCategory),
      secondaryCategory: cellTextOrNull(row, columns.secondaryCategory),
      codeHierarchy: cellTextOrNull(row, columns.hierarchy),
      filledLevelColumns,
    });
  }

  return rows;
}

function findReleaseYears(sheet: ExcelJS.Worksheet): number[] {
  const years: number[] = [];
  const lastRow = Math.min(sheet.rowCount, RELEASE_NUMBER_SCAN_ROWS);
  for (let r = 1; r <= lastRow; r++) {
    const text = plainText(sheet.getRow(r).getCell(1).value);
    const match = text.match(/release number:\s*(\d{4})/i);
    if (match?.[1]) years.push(Number(match[1]));
  }
  return years;
}

/**
 * Parses every A-G annex sheet it can find in the workbook. Never throws for malformed content —
 * every structural problem becomes an `error`-severity `ParseIssue` naming the sheet (and row,
 * where one row is at fault) instead. A sheet whose annex cannot be determined at all, or whose
 * header row cannot be found, is skipped (its rows are simply absent from the result) rather than
 * aborting the whole workbook — an administrator fixing one broken annex should not have to
 * re-read errors for the six that were fine.
 */
export async function parseImdrfWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
  const ExcelJSModule = await import("exceljs");
  const workbook = new ExcelJSModule.default.Workbook();
  await workbook.xlsx.load(buffer);

  const issues: ParseIssue[] = [];
  const rows: ParsedRow[] = [];
  const releaseYearsFound = new Set<number>();

  for (const sheet of workbook.worksheets) {
    const annex = resolveSheetAnnex(sheet, issues);
    if (annex === null) continue; // Not a terminology sheet, or its own name/content disagree.

    for (const year of findReleaseYears(sheet)) releaseYearsFound.add(year);

    rows.push(...parseSheet(sheet, annex, issues));
  }

  return { rows, issues, releaseYearsFound };
}
