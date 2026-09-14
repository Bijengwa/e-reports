import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  cellOverflows,
  type RegisterRow,
} from "../src/doors/staff/register/pages/register.js";
import { buildRegisterXlsx, registerExportFilename } from "../src/doors/staff/register-export.js";

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
  it("uses the Tanzania calendar date and a .xlsx suffix", () => {
    expect(registerExportFilename(new Date("2026-09-13T21:30:00Z"))).toBe(
      "AEMD-Register-2026-09-14.xlsx",
    );
    expect(registerExportFilename(new Date("2026-09-13T08:00:00Z"))).toBe(
      "AEMD-Register-2026-09-13.xlsx",
    );
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

    expect(sheet.name).toBe("Register");
    expect(sheet.columnCount).toBe(COLUMNS.length);
    for (const [i, col] of COLUMNS.entries()) {
      expect(sheet.getRow(1).getCell(i + 1).value).toBe(col.header);
    }
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

  it("styles the header and stripes data rows without changing values", async () => {
    const buffer = await buildRegisterXlsx([
      sampleRow({ sn: 1, tmda_report_number: "AEMD/2026-27/001" }),
      sampleRow({ sn: 2, tmda_report_number: "AEMD/2026-27/002" }),
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Register");
    expect(sheet).toBeDefined();
    if (sheet === undefined) return;

    const header = sheet.getRow(1).getCell(1);
    expect(header.font?.bold).toBe(true);
    expect(header.font?.color?.argb?.replace(/^FF/i, "").toUpperCase()).toBe("FFFFFF");
    expect(header.fill?.type).toBe("pattern");
    if (header.fill?.type === "pattern") {
      expect(header.fill.fgColor?.argb).toBeTruthy();
    }

    const first = sheet.getRow(2).getCell(1);
    const second = sheet.getRow(3).getCell(1);
    const firstFill = first.fill?.type === "pattern" ? first.fill.fgColor?.argb : undefined;
    const secondFill = second.fill?.type === "pattern" ? second.fill.fgColor?.argb : undefined;
    expect(firstFill).toBeTruthy();
    expect(secondFill).toBeTruthy();
    expect(firstFill).not.toBe(secondFill);
    expect(sheet.getRow(2).getCell(2).value).toBe("AEMD/2026-27/001");
    expect(sheet.getRow(3).getCell(2).value).toBe("AEMD/2026-27/002");
  });
});

/**
 * The page shows a preview of a long value; the sheet shows the value.
 *
 * The two read the same COLUMNS array, so the only way they could diverge is if a UI-side shortening
 * ever leaked into the mapping. This is the test that would catch it.
 */
describe("register Excel keeps the whole value", () => {
  it("exports a long narrative in full even though the page previews it", async () => {
    const narrative =
      "During use, the monitor unexpectedly stopped displaying the patient's SpO2 value and " +
      "generated repeated alarm notifications despite the sensor being correctly positioned on the " +
      "patient's finger. The device was replaced and the patient monitored manually until a spare " +
      "unit arrived from the biomedical engineering department, which retained the failed unit for " +
      "investigation and notified the supplier the same afternoon.";
    const feedback = `Acknowledged to the reporter on 14/09/2026. ${"Follow-up correspondence. ".repeat(8)}`;

    const description = COLUMNS.findIndex((col) =>
      col.header.startsWith("Adverse Event(s)/Incident(s) Description"),
    );
    const acknowledgement = COLUMNS.findIndex((col) => col.header.startsWith("Acknowledgement"));

    // The premise: the page does shorten these two on screen.
    expect(cellOverflows(COLUMNS[description], narrative)).toBe(true);
    expect(cellOverflows(COLUMNS[acknowledgement], feedback)).toBe(true);

    const buffer = await buildRegisterXlsx([
      sampleRow({ event_description: narrative, acknowledgement_feedback: feedback }),
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Register");
    expect(sheet).toBeDefined();
    if (sheet === undefined) return;

    expect(sheet.getRow(2).getCell(description + 1).value).toBe(narrative);
    expect(sheet.getRow(2).getCell(acknowledgement + 1).value).toBe(feedback);
  });
});
