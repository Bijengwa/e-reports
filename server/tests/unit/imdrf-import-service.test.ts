import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { previewImdrfImport } from "../../src/domain/imdrf/import-service.js";

describe("previewImdrfImport (pending-upload store)", () => {
  it("does not issue a token when validation fails (no Release Number declared)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("A");
    ws.addRow(["Annex Name: Annex A"]);
    for (let i = 0; i < 6; i++) ws.addRow([]);
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
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const preview = await previewImdrfImport({
      buffer,
      releaseYear: 2026,
      documentCode: null,
      title: null,
      sourceFileName: "test.xlsx",
    });
    expect(preview.ok).toBe(false);
    expect(preview.token).toBe("");
    expect(preview.issues.length).toBeGreaterThan(0);
  });

  it("returns a non-empty token and a correct summary for a fully valid workbook", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("A");
    ws.addRow(["Annex Name: Annex A"]);
    ws.addRow(["Release Number: 2026"]);
    for (let i = 0; i < 5; i++) ws.addRow([]);
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
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const preview = await previewImdrfImport({
      buffer,
      releaseYear: 2026,
      documentCode: "IMDRF/AE WG/N43",
      title: "IMDRF Adverse Event Terminology",
      sourceFileName: "imdrf-2026.xlsx",
    });

    expect(preview.ok).toBe(true);
    expect(preview.token).not.toBe("");
    expect(preview.total).toBe(1);
    expect(preview.summary.find((s) => s.annex === "A")?.count).toBe(1);
  });

  it("issues distinct tokens for two successive valid previews", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("B");
    ws.addRow(["Annex Name: Annex B"]);
    ws.addRow(["Release Number: 2026"]);
    for (let i = 0; i < 5; i++) ws.addRow([]);
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
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const input = {
      buffer,
      releaseYear: 2026,
      documentCode: null,
      title: null,
      sourceFileName: "test.xlsx",
    };
    const first = await previewImdrfImport(input);
    const second = await previewImdrfImport(input);
    expect(first.token).not.toBe(second.token);
  });
});
