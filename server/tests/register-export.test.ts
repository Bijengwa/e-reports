import { inflateSync } from "node:zlib";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildRegisterPdf,
  buildRegisterXlsx,
  registerExportFilename,
  registerPdfColumnGroups,
} from "../src/doors/staff/register-export.js";
import { COLUMNS, type RegisterRow } from "../src/doors/staff/views/register.js";

function sampleRow(overrides: Partial<RegisterRow> = {}): RegisterRow {
  return {
    reportId: "11111111-1111-4111-8111-111111111111",
    sn: 1,
    tmda_report_number: "AEMD/2026-27/001",
    date_received: "2026-09-13",
    device_brand_name: "Revital",
    device_common_name: "Infusion giving set",
    size: "",
    batch_lot_serial_number: "2601304-02",
    device_type: "",
    manufacturing_date: "",
    expiry_date: "",
    manufacturer_name_address: "",
    manufacturing_country: "Kenya",
    supplier_name: "",
    event_description: "Line burst during infusion.",
    date_onset_event: "2026-08-01",
    date_report: "2026-08-02",
    event_location: "",
    region: "Dodoma",
    type_of_report: "Initial",
    reporter_details: "Name: A. Mwita · Contact: +255700000000",
    event_seriousness: "Yes",
    device_component_level_1: "Battery",
    device_component_level_2: "",
    device_component_level_3: "",
    device_component_codes: "E1204",
    device_problem_level_1: "Battery depletion",
    device_problem_level_2: "",
    device_problem_level_3: "",
    device_problem_codes: "A0501",
    clinical_sign_level_1: "",
    clinical_sign_level_2: "",
    clinical_sign_level_3: "",
    clinical_sign_codes: "",
    health_impact_level_1: "",
    health_impact_level_2: "",
    health_impact_level_3: "",
    health_impact_codes: "",
    investigation_type_codes: "A05",
    investigation_finding_level_1: "Cell fault confirmed",
    investigation_finding_codes: "",
    investigation_finding_level_2: "",
    investigation_type_cause_level_2: "",
    investigation_type_cause_level_3: "",
    investigation_conclusion_codes: "",
    investigation_conclusion_level_1: "",
    investigation_conclusion_level_2: "",
    investigation_status: "",
    causality_assessment: "Probable",
    risk_assessment: "High",
    regulatory_action: "Enhance monitoring",
    assessor_1_name: "Baraka Nyoni",
    date_assessment_1: "13/09/2026",
    assessor_2_name: "",
    date_assessment_2: "",
    acknowledgement_feedback: "",
    ...overrides,
  };
}

describe("register export filename", () => {
  it("uses the Tanzania calendar date and a safe AEMD prefix", () => {
    expect(registerExportFilename("xlsx", new Date("2026-09-13T21:30:00Z"))).toBe(
      "AEMD-Register-2026-09-14.xlsx",
    );
    expect(registerExportFilename("pdf", new Date("2026-09-13T08:00:00Z"))).toBe(
      "AEMD-Register-2026-09-13.pdf",
    );
  });
});

describe("register PDF column groups", () => {
  it("repeats S/N and report number on every horizontal part and covers every later column once", () => {
    const groups = registerPdfColumnGroups(COLUMNS);
    expect(groups.length).toBeGreaterThan(1);
    const rest = new Set<number>();
    for (const group of groups) {
      expect(group[0]).toBe(0);
      expect(group[1]).toBe(1);
      for (const index of group.slice(2)) rest.add(index);
    }
    expect(rest.size).toBe(COLUMNS.length - 2);
    expect(Math.min(...rest)).toBe(2);
    expect(Math.max(...rest)).toBe(COLUMNS.length - 1);
  });
});

describe("register Excel workbook", () => {
  it("writes every Register header and the same cell values the page uses", async () => {
    const buffer = await buildRegisterXlsx([sampleRow()]);
    expect(buffer.byteLength).toBeGreaterThan(1000);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Register");
    expect(sheet).toBeDefined();
    if (sheet === undefined) return;

    expect(sheet.getRow(1).getCell(1).value).toBe("S/N");
    expect(sheet.getRow(1).getCell(2).value).toBe("TMDA Report Number");
    expect(sheet.columnCount).toBe(COLUMNS.length);
    expect(sheet.getRow(2).getCell(2).value).toBe("AEMD/2026-27/001");
    expect(sheet.getRow(2).getCell(12).value).toBe("Kenya");
    expect(sheet.getRow(2).getCell(19).value).toBe("Initial");
    expect(sheet.getRow(2).getCell(20).value).toBe("Name: A. Mwita · Contact: +255700000000");
    expect(sheet.getRow(2).getCell(22).value).toBe("Battery");
    expect(sheet.getRow(2).getCell(25).value).toBe("E1204");
    expect(sheet.getRow(2).getCell(39).value).toBe("Cell fault confirmed");
    expect(sheet.getRow(2).getCell(48).value).toBe("Probable");
    expect(sheet.getRow(2).getCell(50).value).toBe("Enhance monitoring");
  });
});

function pdfPlainText(buffer: Buffer): string {
  const ascii = buffer.toString("latin1");
  const chunks = [ascii];
  for (const match of ascii.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const body = (match[1] ?? "").replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    try {
      chunks.push(inflateSync(Buffer.from(body, "latin1")).toString("latin1"));
    } catch {
      /* not a zlib stream */
    }
  }
  return chunks
    .join("\n")
    .replace(/<([0-9A-Fa-f]+)>/g, (_all, hex: string) => {
      const bytes = hex.match(/.{1,2}/g) ?? [];
      return bytes.map((pair) => String.fromCharCode(Number.parseInt(pair, 16))).join("");
    });
}

describe("register PDF", () => {
  it("produces a non-empty A3 landscape PDF that carries identifying Register text", async () => {
    const buffer = await buildRegisterPdf([sampleRow()]);
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buffer.byteLength).toBeGreaterThan(1000);
    const ascii = buffer.toString("latin1");
    expect(ascii).toContain("/MediaBox [0 0 1190.55 841.89]");
    const text = pdfPlainText(buffer);
    expect(text).toContain("AEMD/2026-27/001");
    expect(text).toContain("Initial");
  });
});
