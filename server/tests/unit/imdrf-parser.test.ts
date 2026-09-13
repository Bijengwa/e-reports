import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseImdrfWorkbook } from "../../src/domain/imdrf/parser.js";

async function bufferOf(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function addAnnexA(wb: ExcelJS.Workbook): void {
  const ws = wb.addWorksheet("A");
  ws.addRow(["Annex Name: Annex A"]);
  ws.addRow(["Annex Title: Medical Device Problem"]);
  ws.addRow(["Release Number: 2026"]);
  ws.addRow([]);
  ws.addRow([]);
  ws.addRow([]);
  ws.addRow([]);
  ws.addRow([
    "Level 1 Term",
    "Level 2 Term",
    "Level 3 Term",
    "Code",
    "Definition",
    "Non-IMDRF Code",
    "Status",
    "Status Description",
    "CodeHierarchy",
  ]);
  ws.addRow(["Root Term", null, null, "A01", "def", null, null, null, "A01"]);
  ws.addRow([null, "Child Term", null, "A0101", "def2", null, null, null, "A01|A0101"]);
  ws.addRow([
    null,
    null,
    "Grandchild Term",
    "A010101",
    "def3",
    null,
    "Retired (2020)",
    "no longer used",
    "A01|A0101|A010101",
  ]);
  ws.addRow([]); // trailing blank row, must be skipped silently
}

describe("parseImdrfWorkbook", () => {
  it("discovers annex sheets by content and detects the header row by name, not position", async () => {
    const buf = await bufferOf(addAnnexA);
    const parsed = await parseImdrfWorkbook(buf);
    expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(parsed.rows).toHaveLength(3);
  });

  it("maps columns by header meaning, tolerating header text variants", async () => {
    const buf = await bufferOf((wb) => {
      const ws = wb.addWorksheet("C");
      for (let i = 0; i < 7; i++) ws.addRow([]);
      ws.addRow([
        "Level 1 Term",
        "Level 2 Term",
        "Level 3 Term",
        "Code",
        "Definition",
        "Non-IMDRF Code/Term",
        "Status",
        "Status Description",
        "CodeHierarchy",
      ]);
      ws.addRow(["Root", null, null, "C01", "def", "MedDRA:1:x", null, null, "C01"]);
    });
    const parsed = await parseImdrfWorkbook(buf);
    expect(parsed.rows[0]?.nonImdrfCode).toBe("MedDRA:1:x");
  });

  it("supports annexes with only a Level 1 column (shallow hierarchy)", async () => {
    const buf = await bufferOf((wb) => {
      const ws = wb.addWorksheet("B");
      for (let i = 0; i < 7; i++) ws.addRow([]);
      ws.addRow([
        "Level 1 Term",
        "Code",
        "Definition",
        "Non-IMDRF Code",
        "Status",
        "Status Description",
        "CodeHierarchy",
      ]);
      ws.addRow(["Only level", "B01", "def", null, null, null, "B01"]);
    });
    const parsed = await parseImdrfWorkbook(buf);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.code).toBe("B01");
  });

  it("captures Primary/Secondary Category only where the sheet has those columns", async () => {
    const buf = await bufferOf((wb) => {
      const ws = wb.addWorksheet("E");
      for (let i = 0; i < 7; i++) ws.addRow([]);
      ws.addRow([
        "Level 1 Term",
        "Level 2 Term",
        "Level 3 Term",
        "Code",
        "Definition",
        "Non-IMDRF Code",
        "Primary Category",
        "Secondary Category",
        "Status",
        "Status Description",
        "CodeHierarchy",
      ]);
      ws.addRow(["Nervous System", null, null, "E01", "def", null, null, null, null, null, "E01"]);
    });
    const parsed = await parseImdrfWorkbook(buf);
    expect(parsed.rows[0]?.primaryCategory).toBeNull();
  });

  it("ignores sheets that are not one of A-G", async () => {
    const buf = await bufferOf((wb) => {
      wb.addWorksheet("Cover Page").addRow(["Not terminology data"]);
      addAnnexA(wb);
    });
    const parsed = await parseImdrfWorkbook(buf);
    expect(parsed.rows.every((r) => r.annex === "A")).toBe(true);
  });

  it("reports a precise sheet+row error for a missing header row instead of throwing", async () => {
    const buf = await bufferOf((wb) => {
      wb.addWorksheet("D").addRow(["not a header row"]);
    });
    const parsed = await parseImdrfWorkbook(buf);
    expect(parsed.issues.some((i) => i.severity === "error" && i.sheet === "D")).toBe(true);
  });

  it("records the release year found on each sheet for cross-checking against the import target", async () => {
    const buf = await bufferOf(addAnnexA);
    const parsed = await parseImdrfWorkbook(buf);
    expect(parsed.releaseYearsFound).toEqual(new Set([2026]));
  });

  it("converts empty optional cells to null rather than empty strings", async () => {
    const buf = await bufferOf(addAnnexA);
    const parsed = await parseImdrfWorkbook(buf);
    const root = parsed.rows.find((r) => r.code === "A01");
    expect(root?.nonImdrfCode).toBeNull();
    expect(root?.status).toBeNull();
  });

  it("preserves source row ordering via sourceOrder", async () => {
    const buf = await bufferOf(addAnnexA);
    const parsed = await parseImdrfWorkbook(buf);
    expect(parsed.rows.map((r) => r.sourceOrder)).toEqual([0, 1, 2]);
    expect(parsed.rows.map((r) => r.code)).toEqual(["A01", "A0101", "A010101"]);
  });
});
