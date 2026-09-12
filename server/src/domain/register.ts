/**
 * How the staff Register reads Orange Report and F004 data.
 *
 * The worksheet headers live in the view and are not this module's to rename. What this module
 * owns is the backing values: which stored field fills which cell, and the small amount of
 * formatting those cells need so a code, a label and a phone number each appear as themselves.
 */

import {
  ACTIONS,
  CAUSALITY_OPTIONS,
  type F004Answers,
  list,
  REPORT_STAGE_OPTIONS,
  value,
} from "./f004.js";
import { FINAL_DOCUMENT_KIND, normalizeFinalDocument } from "./final-document.js";

/** The F004-derived Register cells, keyed as the view's row type already names them. */
export type RegisterAssessmentCells = {
  type_of_report: string;
  device_component_level_1: string;
  device_component_level_2: string;
  device_component_level_3: string;
  device_component_codes: string;
  device_problem_level_1: string;
  device_problem_level_2: string;
  device_problem_level_3: string;
  device_problem_codes: string;
  clinical_sign_level_1: string;
  clinical_sign_level_2: string;
  clinical_sign_level_3: string;
  clinical_sign_codes: string;
  health_impact_level_1: string;
  health_impact_level_2: string;
  health_impact_level_3: string;
  health_impact_codes: string;
  investigation_type_codes: string;
  investigation_finding_level_1: string;
  investigation_finding_codes: string;
  investigation_finding_level_2: string;
  investigation_type_cause_level_2: string;
  investigation_type_cause_level_3: string;
  investigation_conclusion_codes: string;
  investigation_conclusion_level_1: string;
  investigation_conclusion_level_2: string;
  investigation_status: string;
  causality_assessment: string;
  risk_assessment: string;
  regulatory_action: string;
  acknowledgement_feedback: string;
};

const RISK_LABELS: Readonly<Record<string, string>> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function textOf(answers: F004Answers, key: string): string {
  const raw = answers[key];
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "")
      .join("; ");
  }
  if (typeof raw === "string") return raw.trim();
  return "";
}

/** Several preferred-term levels in one cell, dropping blanks rather than leaving gaps. */
function joined(answers: F004Answers, keys: readonly string[]): string {
  return keys
    .map((key) => textOf(answers, key))
    .filter((part) => part !== "")
    .join("; ");
}

function optionLabel(options: readonly { value: string; label: string }[], stored: string): string {
  const trimmed = stored.trim();
  if (trimmed === "") return "";
  const byValue = options.find((option) => option.value === trimmed);
  if (byValue !== undefined) return byValue.label;
  const lowered = trimmed.toLowerCase();
  const byLabel = options.find((option) => option.label.toLowerCase() === lowered);
  if (byLabel !== undefined) return byLabel.label;
  return trimmed;
}

function asAnswers(payload: unknown): F004Answers {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return {};
  const answers: F004Answers = {};
  for (const [key, entry] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof entry === "string") answers[key] = entry;
    else if (Array.isArray(entry)) {
      answers[key] = entry.filter((one): one is string => typeof one === "string");
    }
  }
  return answers;
}

function isFinalDocumentPayload(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { kind?: unknown }).kind === FINAL_DOCUMENT_KIND
  );
}

/**
 * The F004 answers the Register should display for one report.
 *
 * The Final Document wins when it exists: that is what the manager approved, including every
 * disagreement that replaced an A1 answer. A submitted first assessment is the fallback so a
 * report still in the cascade is not blank on the Register. A draft is not a finding.
 */
export function f004AnswersForRegister(
  finalPayload: unknown,
  submittedA1Payload: unknown,
): F004Answers {
  if (isFinalDocumentPayload(finalPayload)) {
    return normalizeFinalDocument(finalPayload).answers;
  }
  return asAnswers(submittedA1Payload);
}

/**
 * Reporter Details as the Register prints them: the name, then the stored phone.
 *
 * The orange form keeps the number in E.164. Facility, location and email stay off this cell —
 * they are other columns' facts, and repeating the phone inside a dumped address is how the
 * previous concatenation became unreadable.
 */
export function formatReporterDetails(name: string, phone: string): string {
  const who = name.trim();
  const contact = phone.trim();
  if (who !== "" && contact !== "") return `Name: ${who} · Contact: ${contact}`;
  if (who !== "") return `Name: ${who}`;
  if (contact !== "") return `Contact: ${contact}`;
  return "";
}

function regulatoryActionOf(answers: F004Answers): string {
  const stored = list(answers, "actions");
  return stored
    .map((entry) => {
      const action = ACTIONS.find((item) => item.value === entry.trim());
      return action === undefined ? entry.trim() : action.label;
    })
    .filter((part) => part !== "")
    .join("; ");
}

function riskLabelOf(stored: string): string {
  const trimmed = stored.trim();
  if (trimmed === "") return "";
  const known = RISK_LABELS[trimmed];
  if (known !== undefined) return known;
  const byLabel = Object.values(RISK_LABELS).find(
    (label) => label.toLowerCase() === trimmed.toLowerCase(),
  );
  return byLabel ?? trimmed;
}

/**
 * F004 answers → Register cells for Type of Report, V–AW, regulatory action, and acknowledgement.
 *
 * Investigation Status and Acknowledgement / Feedback have no persisted source in this workflow
 * and stay empty on purpose — see the fields themselves.
 */
export function mapF004ToRegisterCells(answers: F004Answers): RegisterAssessmentCells {
  return {
    type_of_report: optionLabel(REPORT_STAGE_OPTIONS, value(answers, "report_stage")),
    device_component_level_1: textOf(answers, "imdrf_component_l1"),
    device_component_level_2: textOf(answers, "imdrf_component_l2"),
    device_component_level_3: textOf(answers, "imdrf_component_l3"),
    device_component_codes: textOf(answers, "imdrf_component_code"),
    device_problem_level_1: textOf(answers, "imdrf_device_problem_l1"),
    device_problem_level_2: textOf(answers, "imdrf_device_problem_l2"),
    device_problem_level_3: textOf(answers, "imdrf_device_problem_l3"),
    device_problem_codes: textOf(answers, "imdrf_device_problem_code"),
    clinical_sign_level_1: textOf(answers, "imdrf_clinical_signs_l1"),
    clinical_sign_level_2: textOf(answers, "imdrf_clinical_signs_l2"),
    clinical_sign_level_3: textOf(answers, "imdrf_clinical_signs_l3"),
    clinical_sign_codes: textOf(answers, "imdrf_clinical_signs_code"),
    health_impact_level_1: textOf(answers, "imdrf_health_impact_l1"),
    health_impact_level_2: textOf(answers, "imdrf_health_impact_l2"),
    health_impact_level_3: textOf(answers, "imdrf_health_impact_l3"),
    health_impact_codes: textOf(answers, "imdrf_health_impact_code"),
    investigation_type_codes: textOf(answers, "imdrf_investigation_type_code"),
    investigation_finding_level_1: textOf(answers, "imdrf_investigation_findings_l1"),
    investigation_finding_codes: textOf(answers, "imdrf_investigation_findings_code"),
    // AO is the worksheet's second "Finding Level 1" column. F004 findings have three preferred-
    // term levels and only two Register columns after the codes, so L2 and L3 share AO rather
    // than dropping L3.
    investigation_finding_level_2: joined(answers, [
      "imdrf_investigation_findings_l2",
      "imdrf_investigation_findings_l3",
    ]),
    // AP is labelled "Type/Cause … Level 2". F004 3.3.1 only collects one preferred-term level
    // for type of investigation; that term has no other Register column (AL is the codes).
    investigation_type_cause_level_2: textOf(answers, "imdrf_investigation_type_l1"),
    // F004 type of investigation has no level 3.
    investigation_type_cause_level_3: "",
    investigation_conclusion_codes: textOf(answers, "imdrf_investigation_conclusion_code"),
    investigation_conclusion_level_1: textOf(answers, "imdrf_investigation_conclusion_l1"),
    investigation_conclusion_level_2: textOf(answers, "imdrf_investigation_conclusion_l2"),
    // Official Done/Not Done is a distinct completion flag. F004 3.3 records the kind of
    // investigation, 7.1.8 may propose a field investigation, and `assigned_for_work` means a
    // manager assigned the follow-up work — none of those is "the investigation is done".
    // `closed` was reserved for a later work-finished step and nothing writes it. Blank until
    // the workflow records completion.
    investigation_status: "",
    causality_assessment: optionLabel(CAUSALITY_OPTIONS, value(answers, "causality")),
    risk_assessment: riskLabelOf(value(answers, "risk_level")),
    // 7.1 `actions`, not a `regulatory_action` key — that key is never written.
    regulatory_action: regulatoryActionOf(answers),
    // Not implemented. 7.1.11 `feedback` is a proposed mitigation action, not an
    // acknowledgement sent to the reporter.
    acknowledgement_feedback: "",
  };
}
