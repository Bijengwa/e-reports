/** Throwaway: renders the F004 to static HTML in public/ so the pages can be looked at. */
import { writeFileSync } from "node:fs";
import { F004Form } from "./src/doors/staff/reports/components/f004.js";
import type { F004Answers, SecondaryReviewPayload } from "./src/domain/f004.js";

const device: Record<string, string> = {
  brand_name: "CardioGuard X2",
  common_name: "Implantable cardiac monitor",
  size: "Model X2-44",
  batch_serial: "LOT-88213 / SN-0099412",
  manufacturing_date: "2024-11-02",
  expiry_date: "2029-11-01",
  manufacturer: "Medtron Devices Ltd, 14 Industrial Way, Nairobi, Kenya",
  supplier: "Afya Medical Supplies Ltd, Plot 22 Nyerere Road, Dar es Salaam",
  device_status: "New",
  duration: "7 months",
  reporter: "Dr A. Mwakalinga, Muhimbili National Hospital, Dar es Salaam",
  operator: "Cardiology nurse",
  facility: "Muhimbili National Hospital, United Nations Road, Dar es Salaam",
  report_date: "2026-08-14",
  received_at: "2026-08-17",
};

const event: Record<string, string> = {
  description:
    "The monitor stopped transmitting after seven months of use. On interrogation the battery was found fully depleted well ahead of the stated service life. The patient reported two episodes of dizziness during the period the device was not transmitting.",
  onset_date: "2026-08-09",
  devices: "1",
  users: "1",
};

const answers: F004Answers = {
  device_type: "md",
  registration_number: "TZ-MD-2024-01188",
  device_class: "C",
  report_stage: "initial",
  source_of_event: "malfunction",
  c2_5: "Premature battery depletion confirmed on interrogation; no user error identified.",
  seriousness: "serious",
  c2_6: "Loss of monitoring in a class C implantable device with reported dizziness episodes.",
  public_health: "yes",
  c2_7: "Same lot distributed to four other facilities.",
  imdrf_component_l1: "Battery",
  imdrf_component_code: "A0801",
  imdrf_device_problem_l1: "Battery Problem",
  imdrf_device_problem_l2: "Battery depletion",
  imdrf_device_problem_code: "A0802",
  imdrf_health_impact_l1: "No clinical signs, symptoms or conditions",
  imdrf_health_impact_code: "F2601",
  imdrf_clinical_signs_l1: "Dizziness",
  imdrf_clinical_signs_code: "E1204",
  imdrf_investigation_type_l1: "Manufacturer investigation",
  imdrf_investigation_type_code: "B0101",
  imdrf_investigation_findings_l1: "Battery cell fault confirmed",
  imdrf_investigation_findings_code: "C0304",
  imdrf_investigation_conclusion_l1: "Device to be replaced",
  imdrf_investigation_conclusion_code: "D0401",
  expectedness: "unexpected",
  c4_1: "The service life stated in the labelling is five years; depletion at seven months is not an expected failure mode.",
  causality: "probable",
  c4_3:
    "Temporal relationship between device use and the reported episodes, confirmed battery fault on interrogation, and no other cause identified on review of the clinical record.",
  signal_status: "signal",
  c5: "Three comparable reports for the same lot in the preceding four months.",
  risk_level: "high",
  c6: "A class C implantable device losing monitoring without warning, in a lot still in distribution.",
  actions: ["monitoring", "recall"],
  conclusion:
    "Recommend a lot-specific field safety corrective action, a risk communication to the four facilities holding the affected lot, and enhanced monitoring of the remaining distributed units pending the manufacturer's final investigation report.",
  signature: "J. Kimaro",
};

const a2Review: SecondaryReviewPayload = {
  kind: "a2_section_review",
  responses: {
    "1.3": { degree: "agree" },
    "1.10": { degree: "agree" },
    "1.11": { degree: "disagree", value: "D", statement: "An implantable monitor is class D under the classification rules." },
    "1.19": { degree: "agree" },
    "2.5": { degree: "agree" },
    "2.6": { degree: "agree" },
    "2.7": { degree: "agree" },
    "3.1.1": { degree: "agree" },
    "3.1.2": { degree: "agree" },
    "3.2.1": { degree: "agree" },
    "3.2.2": { degree: "agree" },
    "3.3.1": { degree: "agree" },
    "3.3.2": { degree: "agree" },
    "3.3.3": { degree: "agree" },
    "4.1": { degree: "agree" },
    "4.2": { degree: "agree" },
    "4.3": { degree: "agree" },
    "5": { degree: "agree" },
    "6": { degree: "agree" },
    "7.1_actions": { degree: "agree" },
    "7.1_conclusion": { degree: "agree" },
  },
  second: { signature_2: "" },
};

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><link rel="stylesheet" href="app.css"></head>
<body><div class="wrap" style="padding:24px">${body}</div></body></html>`;
}

const common = {
  reportId: "r1",
  device,
  event,
  answers,
  assessorName: "J. Kimaro",
  assessedOn: "2026-08-20",
  issues: [],
};

writeFileSync(
  "public/preview-a1.html",
  page("A1", (await F004Form({ ...common, submitted: false })) as unknown as string),
);

writeFileSync(
  "public/preview-a2.html",
  page(
    "A2",
    (await F004Form({
      ...common,
      submitted: true,
      a2Review: { review: a2Review, submitted: false, ordinal: 2 },
    })) as unknown as string,
  ),
);

writeFileSync(
  "public/preview-final.html",
  page(
    "Final",
    (await F004Form({
      ...common,
      submitted: true,
      readOnly: true,
      presentation: "final",
      approval: { byName: "M. Shayo", on: "2026-09-01" },
    })) as unknown as string,
  ),
);

console.log("written");
