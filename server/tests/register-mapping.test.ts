import { describe, expect, it } from "vitest";
import type { F004Answers } from "../src/domain/f004.js";
import { FINAL_DOCUMENT_KIND } from "../src/domain/final-document.js";
import {
  f004AnswersForRegister,
  formatReporterDetails,
  mapF004ToRegisterCells,
} from "../src/domain/register.js";

const ANSWERS: F004Answers = {
  report_stage: "follow_up",
  imdrf_component_l1: "Battery",
  imdrf_component_l2: "Cell",
  imdrf_component_l3: "Contact",
  imdrf_component_code: "E1204",
  imdrf_device_problem_l1: "Battery depletion",
  imdrf_device_problem_l2: "Premature end of life",
  imdrf_device_problem_l3: "Cannot charge",
  imdrf_device_problem_code: "A0501",
  imdrf_clinical_signs_l1: "None observed",
  imdrf_clinical_signs_l2: "No rash",
  imdrf_clinical_signs_l3: "No fever",
  imdrf_clinical_signs_code: "E0101",
  imdrf_health_impact_l1: "No clinical signs",
  imdrf_health_impact_l2: "No deterioration",
  imdrf_health_impact_l3: "Recovered",
  imdrf_health_impact_code: "E2301",
  imdrf_investigation_type_l1: "Manufacturer investigation",
  imdrf_investigation_type_code: "A05",
  imdrf_investigation_findings_l1: "Cell fault confirmed",
  imdrf_investigation_findings_l2: "Separator tear",
  imdrf_investigation_findings_l3: "Internal short",
  imdrf_investigation_findings_code: "A0702",
  imdrf_investigation_conclusion_l1: "Device to be replaced",
  imdrf_investigation_conclusion_l2: "Lot withdrawn",
  imdrf_investigation_conclusion_code: "A0803",
  causality: "probable",
  risk_level: "high",
  actions: ["field_investigation", "monitoring"],
};

describe("Register Type of Report", () => {
  it("reads F004 1.19 report_stage as Initial / Follow up / Final", () => {
    expect(mapF004ToRegisterCells({ report_stage: "initial" }).type_of_report).toBe("Initial");
    expect(mapF004ToRegisterCells({ report_stage: "follow_up" }).type_of_report).toBe("Follow up");
    expect(mapF004ToRegisterCells({ report_stage: "final" }).type_of_report).toBe("Final");
  });

  it("does not treat the arrival channel as Type of Report", () => {
    const cells = mapF004ToRegisterCells({
      report_stage: "initial",
      channel: "email",
    } as F004Answers);

    expect(cells.type_of_report).toBe("Initial");
    expect(cells.type_of_report).not.toBe("email");
    expect(cells.type_of_report).not.toBe("online_form");
    expect(cells.type_of_report).not.toBe("hard_copy");
  });

  it("stays blank when 1.19 has not been answered", () => {
    expect(mapF004ToRegisterCells({}).type_of_report).toBe("");
  });
});

describe("Register V–AW F004/IMDRF mapping", () => {
  const cells = mapF004ToRegisterCells(ANSWERS);

  it("maps device component preferred terms and codes", () => {
    expect(cells.device_component_level_1).toBe("Battery");
    expect(cells.device_component_level_2).toBe("Cell");
    expect(cells.device_component_level_3).toBe("Contact");
    expect(cells.device_component_codes).toBe("E1204");
  });

  it("maps device problem preferred terms and codes", () => {
    expect(cells.device_problem_level_1).toBe("Battery depletion");
    expect(cells.device_problem_level_2).toBe("Premature end of life");
    expect(cells.device_problem_level_3).toBe("Cannot charge");
    expect(cells.device_problem_codes).toBe("A0501");
  });

  it("maps clinical sign preferred terms and codes from imdrf_clinical_signs_*", () => {
    expect(cells.clinical_sign_level_1).toBe("None observed");
    expect(cells.clinical_sign_level_2).toBe("No rash");
    expect(cells.clinical_sign_level_3).toBe("No fever");
    expect(cells.clinical_sign_codes).toBe("E0101");
  });

  it("maps health impact preferred terms and codes from imdrf_health_impact_*", () => {
    expect(cells.health_impact_level_1).toBe("No clinical signs");
    expect(cells.health_impact_level_2).toBe("No deterioration");
    expect(cells.health_impact_level_3).toBe("Recovered");
    expect(cells.health_impact_codes).toBe("E2301");
  });

  it("maps investigation type codes and the one preferred-term level F004 collects", () => {
    expect(cells.investigation_type_codes).toBe("A05");
    expect(cells.investigation_type_cause_level_2).toBe("Manufacturer investigation");
    expect(cells.investigation_type_cause_level_3).toBe("");
  });

  it("maps investigation findings, keeping L3 rather than dropping it", () => {
    expect(cells.investigation_finding_level_1).toBe("Cell fault confirmed");
    expect(cells.investigation_finding_codes).toBe("A0702");
    expect(cells.investigation_finding_level_2).toBe("Separator tear; Internal short");
  });

  it("maps investigation conclusion preferred terms and codes", () => {
    expect(cells.investigation_conclusion_level_1).toBe("Device to be replaced");
    expect(cells.investigation_conclusion_level_2).toBe("Lot withdrawn");
    expect(cells.investigation_conclusion_codes).toBe("A0803");
  });

  it("maps causality and risk as the Register's labels, not the stored values", () => {
    expect(cells.causality_assessment).toBe("Probable");
    expect(cells.risk_assessment).toBe("High");
  });

  it("joins multiple IMDRF codes instead of keeping only the first", () => {
    expect(
      mapF004ToRegisterCells({ imdrf_component_code: ["E1204", "G04069"] }).device_component_codes,
    ).toBe("E1204; G04069");
  });
});

describe("Register investigation status", () => {
  it("is not fabricated from IMDRF investigation fields being filled", () => {
    expect(mapF004ToRegisterCells(ANSWERS).investigation_status).toBe("");
  });

  it("is not fabricated as Not Done when investigation fields are empty", () => {
    expect(mapF004ToRegisterCells({}).investigation_status).toBe("");
  });
});

describe("Register reporter details", () => {
  it("separates name and the stored E.164 phone", () => {
    expect(formatReporterDetails("John Doe", "+255765640856")).toBe(
      "Name: John Doe · Contact: +255765640856",
    );
  });

  it("does not duplicate the phone", () => {
    const formatted = formatReporterDetails("dd", "+255765640856");
    expect(formatted).toBe("Name: dd · Contact: +255765640856");
    expect(formatted.match(/\+255765640856/g)).toHaveLength(1);
  });

  it("omits a missing half rather than leaving a dangling label", () => {
    expect(formatReporterDetails("A. Mwita", "")).toBe("Name: A. Mwita");
    expect(formatReporterDetails("", "+255700000000")).toBe("Contact: +255700000000");
    expect(formatReporterDetails("", "")).toBe("");
  });
});

describe("Register manufacturing country, regulatory action, acknowledgement", () => {
  it("does not invent a manufacturing country from F004 answers", () => {
    const cells = mapF004ToRegisterCells({
      manufacturer: "Revital Healthcare (EPZ) Ltd, Kenya",
    });
    expect(cells).not.toHaveProperty("manufacturing_country");
  });

  it("maps Regulatory Action(s) Taken from F004 7.1 actions labels", () => {
    expect(mapF004ToRegisterCells(ANSWERS).regulatory_action).toBe(
      "Conduct field investigations (Manufacturer or Regulatory Authority); Enhance monitoring",
    );
  });

  it("does not read a regulatory_action key that the workflow never writes", () => {
    expect(
      mapF004ToRegisterCells({ regulatory_action: "Close the case" } as F004Answers)
        .regulatory_action,
    ).toBe("");
  });

  it("does not treat 7.1.11 feedback as Acknowledgement / Feedback", () => {
    const cells = mapF004ToRegisterCells({ actions: ["feedback", "monitoring"] });
    expect(cells.acknowledgement_feedback).toBe("");
    expect(cells.regulatory_action).toContain("Provide feedback to users");
  });
});

describe("which F004 payload the Register reads", () => {
  it("prefers the Final Document over a submitted A1", () => {
    const answers = f004AnswersForRegister(
      {
        kind: FINAL_DOCUMENT_KIND,
        answers: { report_stage: "final", imdrf_component_l1: "Approved term" },
        provenance: {},
        second: {},
      },
      { report_stage: "initial", imdrf_component_l1: "A1 term" },
    );

    expect(answers.report_stage).toBe("final");
    expect(answers.imdrf_component_l1).toBe("Approved term");
  });

  it("falls back to a submitted A1 when there is no Final Document", () => {
    const answers = f004AnswersForRegister(null, { report_stage: "follow_up" });
    expect(answers.report_stage).toBe("follow_up");
  });

  it("ignores a jsonb blob that is not a Final Document", () => {
    const answers = f004AnswersForRegister(
      { kind: "something_else", answers: { report_stage: "final" } },
      { report_stage: "initial" },
    );
    expect(answers.report_stage).toBe("initial");
  });
});
