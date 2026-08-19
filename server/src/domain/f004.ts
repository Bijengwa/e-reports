/**
 * TMDA/DMD/MDV/F/004 Rev 05 — the adverse event assessment template, as data.
 *
 * The same argument as `form-schema`, one document along: the sections, their numbering, the
 * options and the criteria the assessor reads live in one table, so the page, the validation and
 * the stored payload cannot disagree about what the form is.
 *
 * Every criterion, definition and instruction below is the wording of the official form. Quoted
 * rather than paraphrased on purpose: an assessor is applying a regulatory standard, and a
 * rewritten "clearer" causality definition would be a different standard.
 */

/** Stamped on every assessment row, so an old assessment stays readable when the form changes. */
export const F004_VERSION = "TMDA/DMD/MDV/F/004 Rev 05";

/** 1 = first assessment. The second assessor's is ordinal 2 and is not written here. */
export const FIRST_ASSESSMENT = 1;

export type F004Answers = Record<string, string | string[]>;

export function value(answers: F004Answers, field: string): string {
  const raw = answers[field];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0] ?? "";
  return "";
}

export function list(answers: F004Answers, field: string): string[] {
  const raw = answers[field];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw !== "") return [raw];
  return [];
}

// ---- 1. Administrative information / device information ----------------------

/**
 * The nineteen requirement rows of section 1, in the order the paper prints them.
 *
 * `key` names the comment box beside each. The value in the left column is not typed: it is what
 * the reporter filed, shown as the record it is. The paper's two columns are Requirements and
 * Comments, and letting an assessor retype the left one would let the assessment disagree with the
 * report it assesses.
 */
export type DeviceRow = { no: string; label: string; key: string };

export const DEVICE_ROWS: readonly DeviceRow[] = [
  { no: "1.1", label: "Device Brand Name", key: "brand_name" },
  { no: "1.2", label: "Device Common Name", key: "common_name" },
  { no: "1.3", label: "Type of device i.e., MD or IVD", key: "device_type" },
  { no: "1.4", label: "Size/Model (If applicable)", key: "size" },
  { no: "1.5", label: "Batch Number/Lot Number/Serial Number", key: "batch_serial" },
  { no: "1.6", label: "Manufacturing date", key: "manufacturing_date" },
  { no: "1.7", label: "Expiry Date/Service life (if applicable)", key: "expiry_date" },
  { no: "1.8", label: "Manufacturer name and physical address", key: "manufacturer" },
  { no: "1.9", label: "Supplier name and physical address (If indicated)", key: "supplier" },
  { no: "1.10", label: "Device registration number (If applicable)", key: "registration_number" },
  { no: "1.11", label: "Device Class", key: "device_class" },
  { no: "1.12", label: "Status of the device (New or refurbished)", key: "device_status" },
  { no: "1.13", label: "Duration of use", key: "duration" },
  { no: "1.14", label: "Name and physical address of the reporter", key: "reporter" },
  { no: "1.15", label: "Operator at the time of event/ incident", key: "operator" },
  { no: "1.16", label: "Facility name and physical address", key: "facility" },
  { no: "1.17", label: "Date of the report", key: "report_date" },
  { no: "1.18", label: "Date received at TMDA", key: "received_at" },
  { no: "1.19", label: "Initial/Follow up/Final report", key: "report_stage" },
];

/** What the report row knows, beside what its payload carries. */
export type ReportFacts = {
  receivedAt: Date;
  facility: string | null;
  reporterName: string | null;
};

function text(payload: Record<string, unknown>, key: string): string {
  const raw = payload[key];
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) return raw.filter((v) => typeof v === "string").join(", ");
  return "";
}

/** Joins parts the orange form collects separately, dropping the blanks. */
function joined(parts: readonly string[]): string {
  return parts.filter((part) => part !== "").join(" · ");
}

/**
 * Section 1, filled from the report the assessor is reading.
 *
 * A row the orange form does not collect comes back empty rather than guessed. Device class,
 * registration number, MD-or-IVD and the initial/follow-up/final stage are not asked of a
 * reporter, so the assessor supplies them in the comment column — which is how the paper works.
 */
export function prefillDeviceRows(payload: unknown, report: ReportFacts): Record<string, string> {
  const answers = (payload ?? {}) as Record<string, unknown>;
  const orOther = (field: string, chosen: string) =>
    chosen === "Others" || chosen === "Other" ? text(answers, field) : chosen;

  return {
    // The orange form asks for a full name and, separately, a brand and a common name. A reporter
    // who filled only the first left the brand empty, which is why this falls back to it: the
    // device has a name on the paper and the assessment must show it.
    brand_name: text(answers, "brand_name") || text(answers, "device_name"),
    // The common name and nothing else. Falling back to the full name would print one string on
    // both 1.1 and 1.2 and call it a common name it never was.
    common_name: text(answers, "common_name"),
    device_type: "",
    size: text(answers, "size"),
    batch_serial: joined([text(answers, "batch_number"), text(answers, "serial_number")]),
    manufacturing_date: text(answers, "manufacturing_date"),
    expiry_date: text(answers, "expiry_date"),
    manufacturer: text(answers, "manufacturer"),
    // The supplier alone. The source field answers a different question -- where the device came
    // from -- and appending it would put an answer under a heading that did not ask for it.
    supplier: text(answers, "supplier"),
    registration_number: "",
    device_class: "",
    device_status: text(answers, "status"),
    duration: orOther("duration_other", text(answers, "duration")),
    reporter: joined([
      text(answers, "reporter_name") || (report.reporterName ?? ""),
      text(answers, "facility_address"),
      text(answers, "location"),
      text(answers, "phone"),
      text(answers, "email"),
    ]),
    operator: orOther("operator_other", text(answers, "operator")),
    facility: joined([
      text(answers, "facility_address") || (report.facility ?? ""),
      text(answers, "location"),
    ]),
    report_date: text(answers, "report_date"),
    received_at: new Date(report.receivedAt).toISOString().slice(0, 10),
    // Left blank rather than defaulted to Initial. The orange form does not ask, and a report
    // that is in fact a follow-up would be mislabelled by a default nobody chose.
    report_stage: "",
  };
}

// ---- 2. Event/incident information -------------------------------------------

export type EventRow = { no: string; label: string; key: string };

export const EVENT_ROWS: readonly EventRow[] = [
  {
    no: "2.1",
    label: "Event/Incident description (Write as presented by the reporter)",
    key: "description",
  },
  { no: "2.2", label: "Date of onset of the event", key: "onset_date" },
  { no: "2.3", label: "How many devices have been involved? (If applicable)", key: "devices" },
  {
    no: "2.4",
    label: "How many patients/ users have been affected? (If applicable)",
    key: "users",
  },
];

export function prefillEventRows(payload: unknown): Record<string, string> {
  const answers = (payload ?? {}) as Record<string, unknown>;

  return {
    description: joined([text(answers, "incident_narrative"), text(answers, "event_narrative")]),
    onset_date: text(answers, "event_date") || text(answers, "incident_date"),
    devices: text(answers, "devices_involved"),
    users: text(answers, "users_involved"),
  };
}

/** 2.5, for a medical device. The assessor reads these, then ticks what applies. */
export const SOURCE_MD_GUIDANCE: readonly string[] = [
  "Check whether the event/incident has been caused by malfunctions or failure of a device to perform in accordance with its intended purpose when used in accordance with the manufacturer's instructions.",
  "Check if the event/incident has been caused by an inaccuracy in the labelling, instructions for use including omissions and deficiencies.",
  "Degradation/destruction of the device and inappropriate diagnosis.",
  "Check whether the event/incident is related to error(s) on user of the medical devices.",
  "Check whether the event/incident is related to the inadequacy/deficiency of the medical device with respect to its identity, quality, durability, reliability or safety or performance.",
];

/** 2.5, for In Vitro Diagnostics. */
export const SOURCE_IVD_GUIDANCE: readonly string[] = [
  "Establish whether there is a risk that an erroneous result would either (a) lead to a patient management decision resulting in an imminent life-threatening situation to the individual being tested, or to the individual's offspring, or (b) cause death or severe disability to the individual or foetus being tested, or to the individual's offspring.",
  "Establish if the event has been caused by false positive or false negative results falling outside the declared performance of the test.",
];

export const SOURCE_NOTE =
  "Assessor should select the category that best describes the source of the event/incident associated with the medical device or IVD based on the available evidence and give reasons. In establishing causality, review relevant scientific literature, the product registration dossier in RIMS, and safety information from relevant national and other credible regulatory authorities.";

export type Option = { value: string; label: string };

export const SOURCE_OPTIONS: readonly Option[] = [
  { value: "malfunction", label: "Malfunction or failure to perform as intended" },
  { value: "labelling", label: "Inaccuracy in labelling or instructions for use" },
  { value: "degradation", label: "Degradation/destruction of the device, inappropriate diagnosis" },
  { value: "user_error", label: "Error(s) on the user of the medical device" },
  {
    value: "inadequacy",
    label:
      "Inadequacy/deficiency of identity, quality, durability, reliability, safety or performance",
  },
  {
    value: "ivd_erroneous",
    label:
      "IVD: erroneous result risking a life-threatening management decision, death or severe disability",
  },
  {
    value: "ivd_false",
    label: "IVD: false positive or false negative outside the declared performance of the test",
  },
];

/** 2.6. What makes an event serious, quoted from the form. */
export const SERIOUS_CRITERIA: readonly string[] = [
  "led to a death to a patient, user or other person;",
  "led to a serious deterioration in health that either resulted in medical or surgical intervention to prevent life threatening illness/injury or permanent impairment to a body structure or a body function; or",
  "resulted in any indirect harm as a consequence of an incorrect diagnostic or IVD test results when used within manufacturer's instructions for use.",
];

export const SERIOUSNESS_OPTIONS: readonly Option[] = [
  { value: "non_serious", label: "Non serious" },
  { value: "serious", label: "Serious" },
];

export const PUBLIC_HEALTH_QUESTION =
  "Does the event/incident constitute a significant public health concern? e.g., condom, devices used for diagnosis of Malaria, TB, HIV, Covid-19, Hepatitis, Syphilis.";

export const YES_NO: readonly Option[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

// ---- 3. IMDRF category of the adverse incident/event -------------------------

/**
 * One IMDRF terminology: a set of preferred-terminology levels and a code.
 *
 * A labelled grid rather than one free-text box: the annex, the levels and the coding are
 * separate facts on the paper, and flattening them would lose which annex a term came from.
 */
export type ImdrfItem = {
  /** The paper's own sub-label: 3.1(a), 3.1(b), and so on. */
  letter: string;
  key: string;
  title: string;
  annex: string;
  /** How many preferred-terminology levels this annex carries. */
  levels: 1 | 2 | 3;
};

/**
 * The paper groups its seven IMDRF terminologies under three headings, lettered within each —
 * 3.1(a)/(b), 3.2(a)/(b), 3.3(a)/(b)/(c) — not as seven numbered blocks of their own. The grouping
 * is itself part of the form: 3.1 is "the category of the adverse incident reported", 3.2 is "the
 * category of adverse events reported", and 3.3 is the cause investigation, in three stages.
 */
export type ImdrfGroup = { no: string; title: string; items: readonly ImdrfItem[] };

export const IMDRF_GROUPS: readonly ImdrfGroup[] = [
  {
    no: "3.1",
    title: "Category of the adverse incident reported",
    items: [
      {
        letter: "a",
        key: "component",
        title: "Component of the medical device involved in the incident (If applicable)",
        annex: "IMDRF N43 Annex G — Medical Device Component",
        levels: 3,
      },
      {
        letter: "b",
        key: "device_problem",
        title: "Medical device problem (If applicable)",
        annex: "IMDRF N43 Annex A — adverse incident terminologies and coding",
        levels: 3,
      },
    ],
  },
  {
    no: "3.2",
    title: "Category of adverse events reported",
    items: [
      {
        letter: "a",
        key: "health_impact",
        title: "Health effects — health impact (If applicable)",
        annex: "IMDRF N43 Annex F — adverse event terminologies and coding",
        levels: 3,
      },
      {
        letter: "b",
        key: "clinical_signs",
        title:
          "Health effects — clinical signs and symptoms or conditions of the affected person (If applicable)",
        annex: "IMDRF N43 Annex E — terminologies and coding of conditions",
        levels: 3,
      },
    ],
  },
  {
    no: "3.3",
    title: "Investigation of the adverse event/incident reported",
    items: [
      {
        letter: "a",
        key: "investigation_type",
        title: "Cause investigation — type of investigation",
        annex: "IMDRF N43 Annex B",
        levels: 1,
      },
      {
        letter: "b",
        key: "investigation_findings",
        title: "Cause investigation — investigation findings (If applicable)",
        annex: "IMDRF N43 Annex C",
        levels: 3,
      },
      {
        letter: "c",
        key: "investigation_conclusion",
        title: "Cause investigation — investigation conclusion (If applicable)",
        annex: "IMDRF N43 Annex D",
        levels: 2,
      },
    ],
  },
];

export const IMDRF_NOTE =
  "NB: These terms allow capturing of the problems encountered at device(s) level through observational language without yet describing possible reasons or causes for the problems or failures observed. The hierarchical structure allows more understanding of the problem occurred.";

// ---- 4. Relationship / causality assessment ----------------------------------

export const EXPECTEDNESS_NOTE =
  "Make assessment of expectedness based on knowledge of the event/incident and any relevant device information as documented in the risk analysis report (from dossier in RIMS).";

export const EXPECTEDNESS_OPTIONS: readonly (Option & { note: string })[] = [
  {
    value: "expected",
    label: "Expected",
    note: "the event is consistent with the effects of the device listed in the risk analysis report",
  },
  {
    value: "unexpected",
    label: "Unexpected",
    note: "the event is not consistent with the effects listed in the risk analysis report",
  },
];

/** 4.2. Each category with the assessment criteria the paper prints beside it. */
export type CausalityOption = { value: string; label: string; criteria: readonly string[] };

export const CAUSALITY_OPTIONS: readonly CausalityOption[] = [
  {
    value: "unrelated",
    label: "Unrelated",
    criteria: [
      "The event has no temporal relationship with the use of the device, or the procedures related to application of the device;",
      "The adverse event does not follow a known risk category/pattern to the device and is physical or mechanically implausible;",
      "The discontinuation of medical device application or the reduction of the level of activation/exposure when clinically feasible and reintroduction of its use (or increase of the level of activation/exposure), do not impact the adverse event;",
      "The event involves a body-site or an organ that cannot be affected by the device or procedure;",
      "The adverse event can be attributed to another cause (e.g., an underlying or concurrent illness/ clinical condition, an effect of another device, drug, treatment or other risk factors);",
      "The event does not depend on a false result given by the device used for diagnosis, (when applicable).",
    ],
  },
  {
    value: "possible",
    label: "Possible",
    criteria: [
      "The relationship with the use of the device is weak but cannot be ruled out completely. Alternative causes are also possible (e.g., an underlying or concurrent illness/ clinical condition or/and an effect of another device, drug or treatment).",
      "Note: Cases where relatedness cannot be assessed, or no adequate information has been obtained should also be classified as possible.",
    ],
  },
  {
    value: "probable",
    label: "Probable",
    criteria: [
      "The relationship with the use of the device seems relevant and/or the event cannot be reasonably explained by another cause.",
    ],
  },
  {
    value: "certain",
    label: "Certain",
    criteria: [
      "The event is a known to category of the device or to similar devices;",
      "The event has a temporal relationship with device use;",
      "The event involves a body-site or an organ that the device is applied to or has an effect on;",
      "The adverse event follows a known response pattern to the device (if the response pattern is previously known);",
      "The discontinuation of device application (or reduction of the level of activation/exposure) and/or reintroduction of its use (or increase of the level of activation/exposure) impact on the serious adverse event (when clinically feasible);",
      "Other possible causes (e.g., an underlying or concurrent illness/ clinical condition or/and an effect of another device, drug or treatment) have been adequately ruled out;",
      "Harm to the individual is due to error in use;",
      "The event depends on a false result given by the device used for diagnosis, (When applicable).",
    ],
  },
];

export const CAUSALITY_DISCUSSION_NOTE =
  "Assessor should discuss the association based on evidence of temporal association; scientific, clinical and regulatory information; manufacturer's product information; the opinion based on information from a healthcare professional and previous similar events/incidents, whether the device had exceeded its service life or shelf-life as specified by the manufacturer.";

// ---- 5. Signal detection ------------------------------------------------------

export const SIGNAL_CRITERIA: readonly string[] = [
  "Seriousness of the event/incident",
  "New or unexpected event/incident",
  "Short time period since introduction of the device into the market",
  "Public Health impacts (e.g, widespread use, number of cases/reports, rapid increase)",
  "Involvement of vulnerable populations (e.g, pediatric, geriatrics and pregnant women)",
  "Unlabelled or previously unidentified risk",
  "Shifting in the benefit/risk ratio of the device",
  "Preventability of the event/incident",
  "Type and pattern of the device-related incident/event",
  "International actions (e.g, Regulatory actions or safety signals reported by other regulatory authorities)",
];

export const SIGNAL_NOTE =
  "Assessor should consider trends and patterns of reported adverse events/incidents in the Adverse Events/Incidents Register when determining whether a potential safety signal exists. However, a single report involving a serious or unexpected event with significant public health implications may also warrant further signal evaluation.";

/** Whether the criteria above amount to a signal. Not on the paper as a named field, but the
 *  form asks the assessor to "assess whether ... represents a potential safety signal", and a
 *  reader needs a place to record the answer rather than leaving it implied by the comment. */
export const SIGNAL_OPTIONS: readonly Option[] = [
  { value: "signal", label: "Potential safety signal" },
  { value: "not_signal", label: "Not a signal at this stage" },
];

// ---- 6. Risk assessment -------------------------------------------------------

export const RISK_NOTE =
  "The reported adverse event/incident associated with a medical device or IVD shall be assessed and classified according to the actual or potential severity of harm to the patient, user, or public health, as follows.";

export const RISK_OPTIONS: readonly (Option & { note: string })[] = [
  {
    value: "critical",
    label: "Critical Risk",
    note: "An event or incident that results in or is likely to result in death, life-threatening conditions, permanent impairment, or serious public health consequences.",
  },
  {
    value: "high",
    label: "High Risk",
    note: "An event or incident that results in or is likely to result in serious injury, significant deterioration in health, or requires medical or surgical intervention to prevent permanent impairment.",
  },
  {
    value: "medium",
    label: "Medium Risk",
    note: "An event or incident that results in or is likely to result in temporary or minor injury, reversible impairment, or limited clinical consequences.",
  },
  {
    value: "low",
    label: "Low Risk",
    note: "An event or incident that results in no harm or negligible harm, with no significant impact on patient management, user safety, or public health.",
  },
];

export const RISK_IVD_NOTE =
  "Note: For IVDs, the assessment shall also consider indirect harm resulting from incorrect test results that may influence clinical or public health decisions.";

// ---- 7.1 Conclusion of assessment ---------------------------------------------

export const ACTIONS: readonly { no: string; value: string; label: string }[] = [
  { no: "7.1.1", value: "samples", label: "Request for samples and laboratory analysis" },
  { no: "7.1.2", value: "risk_communication", label: "Risk communication" },
  { no: "7.1.3", value: "labeling_design", label: "Request for labeling and design changes" },
  { no: "7.1.4", value: "ifu", label: "Request changes to the Instructions for Use (IFU)" },
  { no: "7.1.5", value: "removal", label: "Device removal or correction" },
  { no: "7.1.6", value: "safety_alert", label: "Issue public safety alerts" },
  { no: "7.1.7", value: "suspension", label: "Market license suspension" },
  {
    no: "7.1.8",
    value: "field_investigation",
    label: "Conduct field investigations (Manufacturer or Regulatory Authority)",
  },
  { no: "7.1.9", value: "post_marketing", label: "Request Post Marketing Studies" },
  { no: "7.1.10", value: "monitoring", label: "Enhance monitoring" },
  {
    no: "7.1.11",
    value: "feedback",
    label: "Provide feedback to users (e.g, Training, following IFU etc.)",
  },
];

// ---- Validation ---------------------------------------------------------------

export type Issue = { field: string; message: string };

/**
 * What a submission must carry.
 *
 * A draft may be as empty as the assessor likes — half an assessment saved at the end of the day
 * is the point of a draft. A submission is the assessor's finding, and these are what the rest of
 * the process reads: without them the second assessor and the manager have nothing to agree or
 * differ with.
 *
 * The signature is required with them. The paper is signed, and a submitted assessment nobody put
 * their name to is not the same document. It is checked against the signed-in name rather than
 * accepted as free text, because it is a confirmation, not a field.
 */
export function validateForSubmit(answers: F004Answers, assessorName: string): Issue[] {
  const issues: Issue[] = [];
  const required = (field: string, message: string) => {
    if (value(answers, field).trim() === "") issues.push({ field, message });
  };

  required("seriousness", "2.6 Categorization of the event/incident is required.");
  required("expectedness", "4.1 Expected or unexpected is required.");
  required("causality", "4.2 Causal association category is required.");
  required("risk_level", "6 Risk assessment is required.");
  required("conclusion", "7.1 Conclusion and recommendations are required.");

  const signature = value(answers, "signature").trim();
  if (signature === "") {
    issues.push({ field: "signature", message: "Sign by typing your name to confirm." });
  } else if (signature.toLowerCase() !== assessorName.trim().toLowerCase()) {
    issues.push({
      field: "signature",
      message: `The signature must be your own name, exactly as "${assessorName}".`,
    });
  }

  return issues;
}

/** Every field the form owns, so a stray input cannot be smuggled into the stored payload. */
export const F004_FIELDS: readonly string[] = [
  ...DEVICE_ROWS.map((row) => `c1_${row.key}`),
  ...EVENT_ROWS.map((row) => `c2_${row.key}`),
  "source_of_event",
  "c2_5",
  "seriousness",
  "c2_6",
  "public_health",
  "c2_7",
  ...IMDRF_GROUPS.flatMap((group) =>
    group.items.flatMap((item) => [
      `imdrf_${item.key}_l1`,
      `imdrf_${item.key}_l2`,
      `imdrf_${item.key}_l3`,
      `imdrf_${item.key}_code`,
    ]),
  ),
  "expectedness",
  "c4_1",
  "causality",
  "c4_3",
  "signal_status",
  "c5",
  "risk_level",
  "c6",
  "actions",
  "conclusion",
  "signature",
];

/** Keep what the form owns and drop the rest, so the payload is the document and nothing else. */
export function collect(fields: Record<string, string | string[]>): F004Answers {
  const owned = new Set(F004_FIELDS);
  const answers: F004Answers = {};

  for (const [name, raw] of Object.entries(fields)) {
    if (owned.has(name)) answers[name] = raw;
  }

  return answers;
}
