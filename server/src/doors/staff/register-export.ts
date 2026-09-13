/**
 * Register PDF and Excel files, built from the same rows and columns the page draws.
 *
 * The page is the source of truth for headers and cell values. This module only paginates and
 * formats them. It does not re-map F004 fields.
 */

import { PassThrough } from "node:stream";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { COLUMNS, type RegisterRow } from "./views/register.js";

const PDF_MARGIN = 28;
const PDF_KEY_COLUMNS = 2;
/** Original column-width units that fit one A3 landscape table after scaling. */
const PDF_GROUP_WEIGHT = 1900;
const PDF_FONT = 6.5;
const PDF_HEADER_FONT = 6;
const PDF_ROW_PAD = 3;
const PDF_MAX_ROW = 64;

export function registerExportFilename(kind: "pdf" | "xlsx", now = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Dar_es_Salaam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `AEMD-Register-${day}.${kind}`;
}

export function registerPdfColumnGroups(
  columns: ReadonlyArray<{ width: number }> = COLUMNS,
): number[][] {
  const keyWidth = (columns[0]?.width ?? 0) + (columns[1]?.width ?? 0);
  const groups: number[][] = [];
  let current = [0, 1];
  let weight = keyWidth;

  for (let i = PDF_KEY_COLUMNS; i < columns.length; i += 1) {
    const next = columns[i]?.width ?? 0;
    if (current.length > PDF_KEY_COLUMNS && weight + next > PDF_GROUP_WEIGHT) {
      groups.push(current);
      current = [0, 1];
      weight = keyWidth;
    }
    current.push(i);
    weight += next;
  }

  if (current.length > PDF_KEY_COLUMNS || groups.length === 0) groups.push(current);
  return groups;
}

function cellText(row: RegisterRow, col: (typeof COLUMNS)[number]): string {
  const value = col.cell(row);
  if (value === "" || value === null || value === undefined) return "";
  return String(value);
}

export async function buildRegisterXlsx(rows: ReadonlyArray<RegisterRow>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "e-Reports";
  const sheet = workbook.addWorksheet("Register", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = COLUMNS.map((col) => ({
    header: col.header,
    width: Math.min(42, Math.max(10, Math.round(col.width / 7))),
    style: { alignment: { wrapText: true, vertical: "top" } },
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true, size: 9 };
  header.alignment = { wrapText: true, vertical: "middle" };
  header.height = 36;

  for (const row of rows) {
    sheet.addRow(COLUMNS.map((col) => cellText(row, col)));
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

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);
  });
}

export async function buildRegisterPdf(rows: ReadonlyArray<RegisterRow>): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A3",
    layout: "landscape",
    margin: PDF_MARGIN,
    bufferPages: true,
    info: {
      Title: "Medical Device and IVD Adverse Events/Incidents Register",
      Author: "e-Reports",
    },
  });
  const done = collectPdf(doc);

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const innerW = pageW - PDF_MARGIN * 2;
  const bottom = pageH - PDF_MARGIN - 14;
  const groups = registerPdfColumnGroups(COLUMNS);

  const widthAt = (widths: number[], i: number): number => widths[i] ?? 0;

  const drawHeaderBand = (indices: number[], widths: number[], y: number): number => {
    const heights = indices.map((idx, i) => {
      const col = COLUMNS[idx];
      if (col === undefined) return 16;
      return Math.max(
        16,
        doc.heightOfString(col.header, {
          width: Math.max(8, widthAt(widths, i) - 4),
          align: "left",
        }) +
          PDF_ROW_PAD * 2,
      );
    });
    const h = Math.max(...heights, 16);
    doc.save();
    doc.rect(PDF_MARGIN, y, innerW, h).fill("#e7eee8");
    doc.restore();
    let x = PDF_MARGIN;
    doc.font("Helvetica-Bold").fontSize(PDF_HEADER_FONT).fillColor("#1b2b1e");
    indices.forEach((idx, i) => {
      const col = COLUMNS[idx];
      const w = widthAt(widths, i);
      if (col !== undefined) {
        doc.text(col.header, x + 2, y + PDF_ROW_PAD, { width: w - 4, height: h - 2 });
      }
      x += w;
    });
    doc
      .strokeColor("#c5d0c6")
      .lineWidth(0.4)
      .moveTo(PDF_MARGIN, y + h)
      .lineTo(PDF_MARGIN + innerW, y + h)
      .stroke();
    return y + h;
  };

  const rowHeight = (row: RegisterRow, indices: number[], widths: number[]): number => {
    const heights = indices.map((idx, i) => {
      const col = COLUMNS[idx];
      const text = col === undefined ? "" : cellText(row, col) || "—";
      return (
        doc.heightOfString(text, { width: Math.max(8, widthAt(widths, i) - 4) }) + PDF_ROW_PAD * 2
      );
    });
    return Math.min(PDF_MAX_ROW, Math.max(12, ...heights));
  };

  groups.forEach((indices, groupIndex) => {
    if (groupIndex > 0) doc.addPage();

    const weight = indices.reduce((sum, idx) => sum + (COLUMNS[idx]?.width ?? 0), 0);
    const widths = indices.map((idx) => ((COLUMNS[idx]?.width ?? 0) / weight) * innerW);
    const firstOther = COLUMNS[indices[PDF_KEY_COLUMNS] ?? 0]?.header ?? "";
    const last = COLUMNS[indices[indices.length - 1] ?? 0]?.header ?? "";

    doc.font("Helvetica-Bold").fontSize(10).fillColor("#1b2b1e");
    doc.text(
      "MEDICAL DEVICE AND IN VITRO DIAGNOSTIC ADVERSE EVENTS/INCIDENTS REGISTER",
      PDF_MARGIN,
      PDF_MARGIN,
      { width: innerW },
    );
    doc.font("Helvetica").fontSize(8).fillColor("#4d5c50");
    doc.text(
      `TMDA/DMD/MDV/R/002 Rev 01 · ${String(rows.length)} record${rows.length === 1 ? "" : "s"} · Part ${String(groupIndex + 1)} of ${String(groups.length)} · ${firstOther} – ${last}`,
      PDF_MARGIN,
      doc.y + 2,
      { width: innerW },
    );

    let y = doc.y + 8;
    y = drawHeaderBand(indices, widths, y);
    const headerY = y;

    rows.forEach((row, rowIndex) => {
      const h = rowHeight(row, indices, widths);
      if (y + h > bottom) {
        doc.addPage();
        doc.font("Helvetica").fontSize(8).fillColor("#4d5c50");
        doc.text(
          `Part ${String(groupIndex + 1)} of ${String(groups.length)} (continued)`,
          PDF_MARGIN,
          PDF_MARGIN,
          { width: innerW },
        );
        y = drawHeaderBand(indices, widths, doc.y + 4);
      }

      if (rowIndex % 2 === 1) {
        doc.save();
        doc.rect(PDF_MARGIN, y, innerW, h).fill("#f6f8f6");
        doc.restore();
      }

      let x = PDF_MARGIN;
      doc.font("Helvetica").fontSize(PDF_FONT).fillColor("#1b2b1e");
      indices.forEach((idx, i) => {
        const col = COLUMNS[idx];
        const w = widthAt(widths, i);
        const text = col === undefined ? "" : cellText(row, col) || "—";
        doc.text(text, x + 2, y + PDF_ROW_PAD, {
          width: w - 4,
          height: h - 2,
          ellipsis: true,
        });
        x += w;
      });
      y += h;
    });

    if (rows.length === 0) {
      doc.font("Helvetica").fontSize(8).fillColor("#4d5c50");
      doc.text("No adverse events or incidents have been recorded yet.", PDF_MARGIN, headerY + 10, {
        width: innerW,
      });
    }
  });

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(7).fillColor("#6b7a6e");
    doc.text(
      `Page ${String(i - range.start + 1)} of ${String(range.count)}`,
      PDF_MARGIN,
      pageH - 18,
      { width: innerW, align: "right", lineBreak: false },
    );
  }

  doc.end();
  return done;
}
