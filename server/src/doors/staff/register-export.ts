/**
 * Register Excel file, built from the same rows and columns the page draws.
 *
 * The page is the source of truth for headers and cell values. This module only formats them for
 * a spreadsheet. It does not re-map F004 fields.
 */

import ExcelJS from "exceljs";
import { COLUMNS, type RegisterRow } from "./views/register.js";

/** `--green-d` from the staff palette — the dark institutional green the UI already uses. */
const HEADER_FILL = "FF0C3B1E";
/** `--green-bg` — pale enough to stripe without drowning the values. */
const STRIPE_FILL = "FFE7F2EA";
const WHITE_FILL = "FFFFFFFF";
const BORDER = "FFD9E2DC";

const thinBorder = {
  top: { style: "thin" as const, color: { argb: BORDER } },
  bottom: { style: "thin" as const, color: { argb: BORDER } },
  left: { style: "thin" as const, color: { argb: BORDER } },
  right: { style: "thin" as const, color: { argb: BORDER } },
};

export function registerExportFilename(now = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Dar_es_Salaam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `AEMD-Register-${day}.xlsx`;
}

function cellText(row: RegisterRow, col: (typeof COLUMNS)[number]): string {
  const value = col.cell(row);
  if (value === "" || value === null || value === undefined) return "";
  return String(value);
}

function fillOf(argb: string): ExcelJS.FillPattern {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

export async function buildRegisterXlsx(rows: ReadonlyArray<RegisterRow>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "e-Reports";
  workbook.title = "Medical Device and IVD Adverse Events/Incidents Register";

  const sheet = workbook.addWorksheet("Register", {
    views: [{ state: "frozen", ySplit: 1, xSplit: 1 }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: false,
      margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
  });
  sheet.pageSetup.printTitlesRow = "1:1";

  sheet.columns = COLUMNS.map((col) => ({
    header: col.header,
    width: Math.min(42, Math.max(10, Math.round(col.width / 7))),
  }));

  const header = sheet.getRow(1);
  header.height = 48;
  header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
  header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  header.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = fillOf(HEADER_FILL);
    cell.font = header.font;
    cell.alignment = header.alignment;
    cell.border = thinBorder;
  });

  for (const source of rows) {
    const excelRow = sheet.addRow(COLUMNS.map((col) => cellText(source, col)));
    const striped = excelRow.number % 2 === 1;
    excelRow.height = 34;
    excelRow.font = { size: 10, name: "Calibri", color: { argb: "FF101913" } };
    excelRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = fillOf(striped ? STRIPE_FILL : WHITE_FILL);
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = thinBorder;
      cell.font = excelRow.font;
    });
  }

  if (COLUMNS.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: COLUMNS.length },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
