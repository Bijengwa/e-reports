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

import type { Annex } from "./imdrf/types.js";

/** Stamped on every assessment row, so an old assessment stays readable when the form changes. */
export const F004_VERSION = "TMDA/DMD/MDV/F/004 Rev 05";

/**
 * The document's own title, capitalised as TMDA prints it on the paper.
 *
 * Here rather than in the view because it is a property of the form, like the revision beside it,
 * and because two places rendering an F004 must not caption it two ways. The F004 is an assessment
 * TEMPLATE — the office's own working document — and never an adverse event report; a page that
 * captioned it as one would be telling the reader they were looking at the reporter's submission.
 */
export const F004_TITLE =
  "Adverse Events / Incidents of Medical Devices / In Vitro Diagnostics Assessment Template";

/** 1 = the primary F004. Every ordinal above it is a secondary assessment, however many exist. */
export const FIRST_ASSESSMENT = 1;

/**
 * The eight sections the F004 is divided into, as the document itself numbers them.
 *
 * The one list of what a comment may be attached to. The form renders these as `id="section-N"`
 * anchors and the comment route accepts these and nothing else, so "that section does not exist"
 * is answered from the document rather than from a second list that could fall behind it.
 *
 * Sub-blocks — 2.5, 4.1, 7.1 — are deliberately not here. They carry no stable anchor yet, and
 * `assessment_comments.section` is text precisely so adding them later changes what this list
 * says without migrating anything already written.
 */
export const F004_SECTION_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

export type F004Answers = Record<string, string | string[]>;

/**
 * What a second assessor may say about one answer of the first assessor's.
 *
 * Four degrees, and the fourth is not a position: Agree keeps A1's answer as it stands, Required
 * clarification keeps the answer but replaces the words beside it, and Disagree replaces the
 * answer itself — three ways of responding to something A1 said.
 *
 * "Required clarification" is not a softer Disagree and is not a question. It is a correction the
 * assessor supplies and the final document incorporates: "Add the manufacturer's investigation
 * conclusion", "Replace the current statement with the following". The earlier caption, "Need
 * Clarification", read as a request to somebody else and left readers using it to mean "I have
 * doubts" — which is Disagree, and is settled by choosing Disagree.
 *
 * `supplied` is what a review item becomes when A1 left the field
 * blank (an optional one, never required of A1): there is nothing there to agree, clarify or
 * disagree WITH, so a second assessor is never offered those three, only asked whether they want to
 * add the value themselves. Recorded distinctly rather than as `disagree` so the record never claims
 * A2 found fault with an answer A1 never gave.
 */
export const A2_DEGREES = ["agree", "clarification", "disagree"] as const;
export type A2Degree = (typeof A2_DEGREES)[number] | "supplied";

/** The wording on screen, written once so the workspace and the record cannot name them apart. */
export const A2_DEGREE_LABELS: Record<A2Degree, string> = {
  agree: "Agree",
  clarification: "Required clarification",
  disagree: "Disagree",
  supplied: "Supplied",
};

/** One box of a `fields` item. The IMDRF rows are four inputs, not one, and Disagree redraws them. */
export type A2ValueField = { key: string; label: string };

export type A2ReviewItem = {
  key: string;
  no: string;
  title: string;
  valueLabel: string;
  valueKind: "single" | "multi" | "text" | "fields";
  /** Present exactly when `valueKind` is "fields", and empty for every other kind. */
  fields?: readonly A2ValueField[];
  /**
   * The A1 field(s) this item is a position on — what `isA1Blank` reads to decide whether this
   * item is reviewable at all this time, on this report. Not always the field the section renders
   * under its own name: `"7.1_conclusion"` reads `conclusion`, and an IMDRF item reads all of its
   * own preferred-terminology levels plus its coding box.
   */
  a1Fields: readonly string[];
  /**
   * The comment box the paper prints beside this item's answer, where it has one.
   *
   * Deliberately not folded into `a1Fields`: `isA1Blank` asks "did A1 take a position here?", and
   * a stray comment against an unanswered row is not a position. Keeping the two apart is what
   * lets `validateForSubmit` insist on both while `isA1Blank` still reads only the answer.
   */
  commentField?: string;
  /**
   * Whether this item's own answer IS the prose, rather than a choice with prose beside it.
   *
   * Only two items are: 4.3 is a discussion and 7.1's conclusion is a conclusion. Everything else
   * on the F004 answers with a choice, a list or a short identifier, and carries its words — where
   * it has any — in the `commentField` above.
   *
   * The distinction is what makes a clarification field-aware. A clarification supplies words and
   * never a new answer, so the words have to land somewhere: on a choice item that is the comment
   * beside it, and on a prose item it is the answer itself. Deriving this from `valueKind: "text"`
   * would be wrong in both directions — 1.10 and 1.11 are short text and are not prose, and a
   * clarification that overwrote a device class with a sentence would corrupt the final document.
   */
  prose?: boolean;
  /**
   * "(If applicable)" on the paper: A1 may leave this item entirely alone.
   *
   * Optional as a whole, never by halves — an item touched at all owes the same completeness a
   * required one does. `validateForSubmit` is the single place that decides what "touched" means
   * for each `valueKind`.
   */
  optional?: boolean;
};

/** A replacement answer, shaped like the A1 control it stands in for. */
export type A2Value = string | string[] | Record<string, string>;

/**
 * One decision, stored under the first assessor's own field key — "2.6", "7.1_conclusion".
 *
 * The three degrees carry different halves of this shape on purpose, so a combination the process
 * has no meaning for cannot be written down at all: Agree carries nothing, Required clarification
 * carries only a statement — it asks about A1's answer, it does not replace it — and Disagree is
 * the one degree that carries a replacement value. A hand-edited request that sends a value with
 * `clarification` therefore does not merely fail validation; the field never reaches the payload.
 */
export type SecondaryReviewResponse = {
  degree?: A2Degree;
  value?: A2Value;
  statement?: string;
};

export type SecondaryReviewPayload = {
  kind: "a2_section_review";
  responses: Record<string, SecondaryReviewResponse>;
  /**
   * This assessor's own signature. Their position on 7.1's actions and conclusion is not held
   * here — it is their reaction to A1's, the same as every other item, and lives in `responses`
   * under `"7.1_actions"`/`"7.1_conclusion"` like the rest. See `F004_SECONDARY_FIELDS`.
   */
  second?: F004Answers;
};

function isA2Degree(value: string): value is A2Degree {
  return (A2_DEGREES as readonly string[]).includes(value);
}

/** Nothing was chosen or written, whichever of the three shapes the value happens to be. */
function isBlankA2Value(value: A2Value | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return Object.values(value).every((entry) => entry.trim() === "");
}

export function value(answers: F004Answers, field: string): string {
  const raw = answers[field];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0] ?? "";
  return "";
}

/**
 * Whether A1 left this item blank — every one of its `a1Fields` empty on the report being read.
 *
 * The question that decides whether an item is reviewable at all, this time. Section 1's three
 * required assessed rows and 7.1 are effectively never blank, because A1 cannot submit without
 * them; the question matters for the "(If applicable)" rows — the IMDRF boxes that are not
 * `investigation_type`, and 1.10 — which A1 may leave exactly as empty as the paper allows.
 *
 * Read off the answers rather than off `optional`, deliberately: an assessment submitted under an
 * earlier reading of the form may hold a blank where the paper now asks for one, and a second
 * assessor is offered `supplied` for whatever is in fact blank in front of them.
 */
export function isA1Blank(item: A2ReviewItem, answers: F004Answers): boolean {
  return item.a1Fields.every((field) => value(answers, field).trim() === "");
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

/**
 * The four section-1 rows the orange form never answers.
 *
 * Not reporter facts to display, because there is nothing filed to display — MD-or-IVD, the
 * registration number, the device class and which report this is (initial/follow-up/final) are
 * the assessor's own findings. Checked against `TMDA/DMD/MDV/F/001 Rev 06`, which has no field for
 * any of the four; `1.18` is not in this set because it is a system timestamp, not a finding.
 */
export const ASSESSED_DEVICE_KEYS: readonly string[] = [
  "device_type",
  "registration_number",
  "device_class",
  "report_stage",
];

export const DEVICE_TYPE_OPTIONS: readonly Option[] = [
  { value: "md", label: "Medical Device (MD)" },
  { value: "ivd", label: "In Vitro Diagnostic (IVD)" },
];

export const REPORT_STAGE_OPTIONS: readonly Option[] = [
  { value: "initial", label: "Initial" },
  { value: "follow_up", label: "Follow up" },
  { value: "final", label: "Final" },
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
  /** The item's position within its group: 3.1.1, 3.1.2, and so on. */
  letter: string;
  key: string;
  title: string;
  annex: string;
  /**
   * Which annex of IMDRF N43 this item's code must come from, as a bare letter.
   *
   * `annex` above is the sentence the paper prints beside the field; this is the same fact in a
   * form a query can use. The terminology handbook scopes its search with it, so an officer
   * looking up a code for 3.1.2 is never shown an Annex F code they cannot put there.
   */
  annexLetter: Annex;
  /**
   * The item restated as the question an officer is actually answering.
   *
   * The paper's own titles name the artefact ("Medical device problem"), which is the right label
   * beside a field someone has already decided to fill. It is the wrong entry point for someone
   * who has a report in front of them and does not yet know which of seven boxes their
   * observation belongs in — that reader needs the question, not the category name.
   */
  question: string;
  /** How many preferred-terminology levels this annex carries. */
  levels: 1 | 2 | 3;
  /**
   * "(If applicable)" on the paper. Six of the seven rows carry it; 3.3.1 does not.
   *
   * Stated here rather than sniffed out of `title`, so the rule survives the wording being
   * edited, and so `validateForSubmit` and `SECONDARY_REVIEW_ITEMS` read one fact rather than two.
   */
  optional?: boolean;
};

/**
 * The paper groups its seven IMDRF terminologies under three headings, sub-numbered within each —
 * 3.1.1/3.1.2, 3.2.1/3.2.2, 3.3.1/3.3.2/3.3.3 — not as seven numbered blocks of their own. The
 * grouping is itself part of the form: 3.1 is "the category of the adverse incident reported", 3.2
 * is "the category of adverse events reported", and 3.3 is the cause investigation, in three stages.
 */
export type ImdrfGroup = { no: string; title: string; items: readonly ImdrfItem[] };

export const IMDRF_GROUPS: readonly ImdrfGroup[] = [
  {
    no: "3.1",
    title: "Category of the adverse incident reported",
    items: [
      {
        letter: "1",
        key: "component",
        title: "Component of the medical device involved in the incident (If applicable)",
        annex: "IMDRF N43 Annex G — Medical Device Component",
        annexLetter: "G",
        question: "Which part of the device was involved?",
        levels: 3,
        optional: true,
      },
      {
        letter: "2",
        key: "device_problem",
        title: "Medical device problem (If applicable)",
        annex: "IMDRF N43 Annex A — adverse incident terminologies and coding",
        annexLetter: "A",
        question: "What went wrong with the device?",
        levels: 3,
        optional: true,
      },
    ],
  },
  {
    no: "3.2",
    title: "Category of adverse events reported",
    items: [
      {
        letter: "1",
        key: "health_impact",
        title: "Health effects — health impact (If applicable)",
        annex: "IMDRF N43 Annex F — adverse event terminologies and coding",
        annexLetter: "F",
        question: "What was the consequence for the patient?",
        levels: 3,
        optional: true,
      },
      {
        letter: "2",
        key: "clinical_signs",
        title:
          "Health effects — clinical signs and symptoms or conditions of the affected person (If applicable)",
        annex: "IMDRF N43 Annex E — terminologies and coding of conditions",
        annexLetter: "E",
        question: "What signs, symptoms or conditions were observed?",
        levels: 3,
        optional: true,
      },
    ],
  },
  {
    no: "3.3",
    title: "Investigation of the adverse event/incident reported",
    items: [
      {
        letter: "1",
        key: "investigation_type",
        title: "Cause investigation — type of investigation",
        annex: "IMDRF N43 Annex B",
        annexLetter: "B",
        question: "What kind of investigation was carried out?",
        levels: 1,
      },
      {
        letter: "2",
        key: "investigation_findings",
        title: "Cause investigation — investigation findings (If applicable)",
        annex: "IMDRF N43 Annex C",
        annexLetter: "C",
        question: "What did the investigation find?",
        levels: 3,
        optional: true,
      },
      {
        letter: "3",
        key: "investigation_conclusion",
        title: "Cause investigation — investigation conclusion (If applicable)",
        annex: "IMDRF N43 Annex D",
        annexLetter: "D",
        question: "What did the investigation conclude was the cause?",
        levels: 2,
        optional: true,
      },
    ],
  },
];

/**
 * The IMDRF item behind one review key ("3.1.1" … "3.3.3") — the same items `IMDRF_GROUPS` holds,
 * looked up by the number the paper (and `SECONDARY_REVIEW_ITEMS`) prints rather than by the
 * item's own internal `key` ("component"). Exists for `domain/imdrf/f004-integration.ts`, which
 * validates a secondary assessor's Disagree replacement and needs the item's annex/level back from
 * the key a posted `a2_degree_3.1.1`/`a2_imdrf_term_3.1.1` names.
 */
const IMDRF_ITEM_BY_REVIEW_KEY: ReadonlyMap<string, ImdrfItem> = new Map(
  IMDRF_GROUPS.flatMap((group) => group.items.map((item) => [`${group.no}.${item.letter}`, item])),
);

export function imdrfItemForReviewKey(key: string): ImdrfItem | undefined {
  return IMDRF_ITEM_BY_REVIEW_KEY.get(key);
}

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
    label: "6.1 Critical Risk",
    note: "An event or incident that results in or is likely to result in death, life-threatening conditions, permanent impairment, or serious public health consequences.",
  },
  {
    value: "high",
    label: "6.2 High Risk",
    note: "An event or incident that results in or is likely to result in serious injury, significant deterioration in health, or requires medical or surgical intervention to prevent permanent impairment.",
  },
  {
    value: "medium",
    label: "6.3 Medium Risk",
    note: "An event or incident that results in or is likely to result in temporary or minor injury, reversible impairment, or limited clinical consequences.",
  },
  {
    value: "low",
    label: "6.4 Low Risk",
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

/**
 * The IMDRF rows, as A2 review items, read from the same table section 3 is drawn from.
 *
 * Derived rather than retyped: 3.3.1 has one terminology level and 3.3.3 has two, and a second
 * hand-written list would be free to disagree with the form about which boxes exist. Disagree
 * redraws exactly the boxes A1 filled in, which is only true while both come from one place.
 */
const IMDRF_A2_ITEMS: readonly A2ReviewItem[] = IMDRF_GROUPS.flatMap((group) =>
  group.items.map((item) => ({
    key: `${group.no}.${item.letter}`,
    no: `${group.no}.${item.letter}`,
    title: item.title,
    valueLabel: "terminology and coding",
    valueKind: "fields" as const,
    fields: [
      ...[1, 2, 3]
        .filter((level) => level <= item.levels)
        .map((level) => ({
          key: `l${level}`,
          label: `Preferred terminology level ${String(level)}`,
        })),
      { key: "code", label: "Coding" },
    ],
    a1Fields: [
      ...[1, 2, 3]
        .filter((level) => level <= item.levels)
        .map((level) => `imdrf_${item.key}_l${level}`),
      `imdrf_${item.key}_code`,
    ],
    optional: item.optional === true,
  })),
);

/**
 * Every answer of the first assessor's that the second assessor must take a position on.
 *
 * The judgements, and only the judgements. Section 1 and rows 2.1-2.4 are the reporter's own
 * facts, shown to both assessors and typed by neither, so there is nothing there for a second
 * opinion to be about. The comment boxes beside each choice are folded into the choice they
 * annotate rather than listed apart: an assessor arguing with 2.6 is arguing with one answer, not
 * with a radio button and a paragraph separately.
 *
 * `key` is the A1 field's own number, and it is what the payload is keyed by. It survives the
 * form's wording changing, which "the fourth item" would not.
 */
export const SECONDARY_REVIEW_ITEMS: readonly A2ReviewItem[] = [
  {
    key: "1.3",
    no: "1.3",
    title: "Type of device i.e., MD or IVD",
    valueLabel: "device type",
    valueKind: "single",
    a1Fields: ["device_type"],
  },
  {
    key: "1.10",
    no: "1.10",
    title: "Device registration number",
    valueLabel: "registration number",
    valueKind: "text",
    a1Fields: ["registration_number"],
    optional: true,
  },
  {
    key: "1.11",
    no: "1.11",
    title: "Device Class",
    valueLabel: "device class",
    valueKind: "text",
    a1Fields: ["device_class"],
    // Deliberately not optional. 1.10 beside it carries "(If applicable)" on the paper and 1.11
    // does not, so the class is a finding every submitted assessment owes — one of the four rows
    // the orange form never asks the reporter for, which is why the assessor determines it.
  },
  {
    key: "1.19",
    no: "1.19",
    title: "Initial/Follow up/Final report",
    valueLabel: "report stage",
    valueKind: "single",
    a1Fields: ["report_stage"],
  },
  {
    key: "2.5",
    no: "2.5",
    title: "Source of the event / incident",
    valueLabel: "source of event / incident",
    valueKind: "single",
    a1Fields: ["source_of_event"],
    commentField: "c2_5",
  },
  {
    key: "2.6",
    no: "2.6",
    title: "Categorization of event / incident",
    valueLabel: "categorization",
    valueKind: "single",
    a1Fields: ["seriousness"],
    commentField: "c2_6",
  },
  {
    key: "2.7",
    no: "2.7",
    title: "Significant public health concern",
    valueLabel: "public health concern",
    valueKind: "single",
    a1Fields: ["public_health"],
    commentField: "c2_7",
  },
  ...IMDRF_A2_ITEMS,
  {
    key: "4.1",
    no: "4.1",
    title: "Expected or unexpected",
    valueLabel: "expectedness",
    valueKind: "single",
    a1Fields: ["expectedness"],
    commentField: "c4_1",
  },
  {
    key: "4.2",
    no: "4.2",
    title: "Causal association category",
    valueLabel: "causal association",
    valueKind: "single",
    a1Fields: ["causality"],
  },
  {
    key: "4.3",
    no: "4.3",
    title: "Discussion of causal relationship",
    valueLabel: "discussion of causal relationship",
    valueKind: "text",
    a1Fields: ["c4_3"],
    prose: true,
  },
  {
    key: "5",
    no: "5",
    title: "Signal detection",
    valueLabel: "signal assessment",
    valueKind: "single",
    a1Fields: ["signal_status"],
    commentField: "c5",
  },
  {
    key: "6",
    no: "6",
    title: "Risk assessment",
    valueLabel: "risk level",
    valueKind: "single",
    a1Fields: ["risk_level"],
    commentField: "c6",
  },
  {
    key: "7.1_actions",
    no: "7.1",
    title: "Proposed risk mitigation action(s)",
    valueLabel: "proposed risk mitigation action(s)",
    valueKind: "multi",
    a1Fields: ["actions"],
  },
  {
    key: "7.1_conclusion",
    no: "7.1",
    title: "Recommendations and conclusion",
    valueLabel: "conclusion",
    valueKind: "text",
    a1Fields: ["conclusion"],
    prose: true,
  },
];

function a2ReviewItem(key: string): A2ReviewItem | undefined {
  return SECONDARY_REVIEW_ITEMS.find((item) => item.key === key);
}

// ---- Validation ---------------------------------------------------------------

export type Issue = { field: string; message: string };

/** "2.6 Categorization of event / incident" — the number and the title, as the paper prints them. */
function itemLabel(item: A2ReviewItem): string {
  return `${item.no} ${item.title.replace(/\s*\(If applicable\)\s*$/, "")}`;
}

/** Where to send a reader who left the answer out: the control, not the comment beside it. */
function answerField(item: A2ReviewItem): string {
  return item.a1Fields[0] ?? item.key;
}

/**
 * Whether A1 gave this item an answer — the position itself, never the comment beside it.
 *
 * One question asked four ways, because the four `valueKind`s are four different controls. An
 * IMDRF grid counts as answered the moment any of its boxes carries something; whether that is a
 * *complete* answer is `imdrfMissing`'s question, asked separately so the two failures read as the
 * two different mistakes they are.
 */
function isAnswered(item: A2ReviewItem, answers: F004Answers): boolean {
  if (item.valueKind === "multi") return list(answers, answerField(item)).length > 0;
  if (item.valueKind === "fields")
    return item.a1Fields.some((f) => value(answers, f).trim() !== "");
  return value(answers, answerField(item)).trim() !== "";
}

/** Anything at all filled in against this item, its comment box included. */
function isTouched(item: A2ReviewItem, answers: F004Answers): boolean {
  if (isAnswered(item, answers)) return true;
  return item.commentField !== undefined && value(answers, item.commentField).trim() !== "";
}

/** The first half of an IMDRF row left empty — level 1 or the coding — or undefined if both are in. */
function imdrfMissing(item: A2ReviewItem, answers: F004Answers): string | undefined {
  const level1 = item.a1Fields.find((f) => f.endsWith("_l1"));
  const code = item.a1Fields.find((f) => f.endsWith("_code"));

  if (level1 !== undefined && value(answers, level1).trim() === "") return level1;
  if (code !== undefined && value(answers, code).trim() === "") return code;
  return undefined;
}

/**
 * What a submission must carry.
 *
 * A draft may be as empty as the assessor likes — half an assessment saved at the end of the day
 * is the point of a draft. A submission is the assessor's finding, and these are what the rest of
 * the process reads: without them the secondary assessor and the manager have nothing to agree or
 * differ with.
 *
 * Walked from `SECONDARY_REVIEW_ITEMS` rather than written out again here. That list already is
 * the document's numbered items — it is what every secondary assessor is asked to take a position
 * on — so a second hand-written list would be free to drift from it, and the row a later assessor
 * is made to judge would be one nobody made A1 fill in. Each item carries its own answer field(s),
 * the comment box beside it, and whether the paper marks it "(If applicable)".
 *
 * The rule, for every item: an answer is required, and where the paper prints a comment box beside
 * that answer the comment is required with it — a ticked radio over an empty box is a verdict with
 * no reasoning. An optional item may be left entirely alone, but once touched it owes the same
 * completeness as a required one, so "(If applicable)" cannot be used to submit half an answer.
 *
 * The signature is required with them. The paper is signed, and a submitted assessment nobody put
 * their name to is not the same document. It is checked against the signed-in name rather than
 * accepted as free text, because it is a confirmation, not a field.
 */
export function validateForSubmit(answers: F004Answers): Issue[] {
  const issues: Issue[] = [];

  for (const item of SECONDARY_REVIEW_ITEMS) {
    const label = itemLabel(item);
    const answered = isAnswered(item, answers);

    // "(If applicable)" and untouched: the paper allows exactly this, so there is nothing to
    // check. Touched, and it owes the same completeness a required row does — an optional item is
    // optional as a whole, not field by field.
    if (item.optional === true && !answered && !isTouched(item, answers)) continue;

    if (!answered) {
      issues.push({ field: answerField(item), message: `${label} is required.` });
      continue;
    }

    // An IMDRF row is answered once any box carries something, but the terminology and the coding
    // are two halves of one answer: half of it names a term nobody can look up, or a code nobody
    // can read. Both, or neither.
    if (item.valueKind === "fields") {
      const missing = imdrfMissing(item, answers);
      if (missing !== undefined) {
        issues.push({
          field: missing,
          message: `${label}: give both the preferred terminology and the coding.`,
        });
      }
    }

    // The answer and the words beside it are one finding. A ticked radio with an empty comment is
    // a verdict with no reasoning, which is what the next assessor and the manager actually read.
    if (item.commentField !== undefined && value(answers, item.commentField).trim() === "") {
      issues.push({
        field: item.commentField,
        message: `${label}: write the comment that goes with your answer.`,
      });
    }
  }

  // The signature itself is not this function's business any longer. It used to be a typed name
  // compared against the signed-in Officer's; it is now a password, verified against that same
  // Officer's account, which needs the database and so is checked in the route before this
  // assessment is stored — see `assessmentRoutes`.

  return issues;
}

/** Every field the form owns, so a stray input cannot be smuggled into the stored payload. */
export const F004_FIELDS: readonly string[] = [
  "device_type",
  "registration_number",
  "device_class",
  "report_stage",
  "source_of_event",
  "c2_5",
  "seriousness",
  "c2_6",
  "public_health",
  "c2_7",
  // The published IMDRF release this A1 is coded against — chosen once, on this ordinal, and read
  // by every later ordinal of the same report as the release theirs must agree with. See
  // `domain/imdrf/f004-integration.ts`, the only place that reads or enforces it.
  "imdrf_release_id",
  ...IMDRF_GROUPS.flatMap((group) =>
    group.items.flatMap((item) => [
      `imdrf_${item.key}_l1`,
      `imdrf_${item.key}_l2`,
      `imdrf_${item.key}_l3`,
      `imdrf_${item.key}_code`,
      // The unambiguous reference `imdrf_terms.id` this row's terminology actually came from.
      //
      // Additive, deliberately alongside the four fields above rather than replacing any of
      // them: `_l1`/`_l2`/`_l3`/`_code` stay exactly what every existing consumer (Register
      // mapping, PDF generation, the pinned `f004-a1-validation` suite) already reads, and this
      // is what lets `f004-integration.ts` resolve them from the repository and overwrite them
      // with the authoritative text on every save, so what those consumers read is never
      // free-typed. `code` alone is not a stable identity within a release (the same code can
      // recur under more than one hierarchy branch — see `docs/imdrf-terminology.md`), which is
      // why this exists at all rather than trusting `_code` to resolve back to one term.
      `imdrf_${item.key}_term_id`,
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

/**
 * The second assessment's own signature. A position on 7.1's own actions and conclusion is not
 * this assessor's document to keep separately — it is their reaction to A1's, exactly like every
 * other item, recorded in `responses["7.1_actions"]`/`responses["7.1_conclusion"]` alongside the
 * rest. This is the one thing left that belongs to this assessor and no earlier one: their own
 * signature, distinct from `assessments.assessor_id` only in that it is part of the document
 * itself rather than metadata about the row.
 */
export const F004_SECONDARY_FIELDS: readonly string[] = [
  "signature_2",
  // A Disagree replacement's own IMDRF term reference, one per IMDRF review item ("3.1.1" …
  // "3.3.3"), additive beside `responses[key].value`'s existing `l1`/`l2`/`l3`/`code` shape rather
  // than folded into it — that shape is pinned by `f004-a2-review.test.ts`
  // (`fields?.map(f => f.key)).toEqual(["l1", "code"])` and similar), and adding a field there
  // would change what every existing review renders and stores. `f004-integration.ts` reads this,
  // resolves it against the repository, and overwrites `value.l1`/`l2`/`l3`/`code` with the
  // authoritative text — the same relationship `imdrf_<key>_term_id` above has to A1's own fields.
  ...IMDRF_GROUPS.flatMap((group) => group.items.map((item) => `a2_imdrf_term_${group.no}.${item.letter}`)),
];

/** Keep what the named set owns and drop the rest, so a payload is the document and nothing else. */
function keep(fields: Record<string, string | string[]>, names: readonly string[]): F004Answers {
  const owned = new Set(names);
  const answers: F004Answers = {};

  for (const [name, raw] of Object.entries(fields)) {
    if (owned.has(name)) answers[name] = raw;
  }

  return answers;
}

/** The first assessment's own fields, and no others. */
export function collect(fields: Record<string, string | string[]>): F004Answers {
  return keep(fields, F004_FIELDS);
}

/**
 * The second assessment's own fields, and no others.
 *
 * Deliberately not a superset of `collect`: the second assessor is not writing the first
 * assessor's document, so a body carrying `conclusion` or `signature` — hand-edited, or replayed
 * from the page above — reaches the stored payload with neither.
 */
export function collectSecondary(fields: Record<string, string | string[]>): F004Answers {
  return keep(fields, F004_SECONDARY_FIELDS);
}

/**
 * The second assessor does not write another F004. They take a position on each of the first
 * assessor's answers, inside the first assessor's own form, choosing one of the three degrees.
 *
 * What each degree carries is decided here rather than trusted from the request, because the three
 * degrees mean three different things and the payload is what everyone downstream reads. Agree
 * carries nothing. Required clarification carries a statement and no replacement value — it asks about
 * A1's answer, it does not overwrite it, so a value posted alongside it is dropped rather than
 * stored to be silently honoured later. Only Disagree carries both.
 *
 * An item A1 left blank is a fourth case, decided by `a1Answers` rather than by anything posted: no
 * degree is ever read for it, only `a2_value_*`, because the page never offers one — there is
 * nothing there to agree, clarify or disagree with. A non-blank value is stored as `supplied`; a
 * blank one is not stored at all, the same as never having been touched.
 */
export function collectSecondaryReview(
  fields: Record<string, string | string[]>,
  a1Answers: F004Answers,
): SecondaryReviewPayload {
  const responses: SecondaryReviewPayload["responses"] = {};

  for (const item of SECONDARY_REVIEW_ITEMS) {
    if (isA1Blank(item, a1Answers)) {
      const posted = postedValue(item, fields);
      if (!isBlankA2Value(posted)) responses[item.key] = { degree: "supplied", value: posted };
      continue;
    }

    const degree = value(fields, `a2_degree_${item.key}`);
    if (!isA2Degree(degree)) continue;

    if (degree === "agree") {
      responses[item.key] = { degree };
      continue;
    }

    const statement = value(fields, `a2_statement_${item.key}`).trim();

    responses[item.key] =
      degree === "clarification"
        ? { degree, statement }
        : { degree, value: postedValue(item, fields), statement };
  }

  // This assessor's own signature, through the same collector A1's own fields go through. Always
  // present, even empty: a draft carries no signature yet, and the route stamps the real one in
  // only once the password behind it verifies.
  return { kind: "a2_section_review", responses, second: collectSecondary(fields) };
}

/** The replacement A1 answer as posted, in whichever of the three shapes the item takes. */
function postedValue(item: A2ReviewItem, fields: Record<string, string | string[]>): A2Value {
  if (item.valueKind === "multi") return list(fields, `a2_value_${item.key}`);

  if (item.valueKind === "fields") {
    const parts: Record<string, string> = {};
    for (const field of item.fields ?? []) {
      parts[field.key] = value(fields, `a2_value_${item.key}_${field.key}`).trim();
    }
    return parts;
  }

  return value(fields, `a2_value_${item.key}`).trim();
}

/** The same shape, read back out of the column, under the same rule as writing it. */
function storedValue(item: A2ReviewItem, raw: unknown): A2Value {
  if (item.valueKind === "multi") {
    return Array.isArray(raw)
      ? raw.filter((entry): entry is string => typeof entry === "string")
      : [];
  }

  if (item.valueKind === "fields") {
    const source = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const parts: Record<string, string> = {};
    for (const field of item.fields ?? []) {
      const entry = source[field.key];
      parts[field.key] = typeof entry === "string" ? entry.trim() : "";
    }
    return parts;
  }

  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * A stored payload, read as the review it claims to be — or as an empty one.
 *
 * A jsonb column holds whatever was put in it, including a payload written by an older shape of
 * this form. Read through the current item table rather than trusted, so a key the form no longer
 * has, a degree it never offered, or a value under Required clarification cannot reach the page.
 */
export function normalizeSecondaryReview(payload: unknown): SecondaryReviewPayload {
  const raw = (payload ?? {}) as {
    kind?: unknown;
    responses?: Record<string, { degree?: unknown; value?: unknown; statement?: unknown }>;
    second?: unknown;
  };
  const responses: SecondaryReviewPayload["responses"] = {};

  // Read through `F004_SECONDARY_FIELDS` rather than trusted, exactly as the responses below are:
  // a payload written before 7.2 existed simply has no `second`, and reads back as an empty one.
  const second: F004Answers = {};
  const storedSecond = (
    typeof raw.second === "object" && raw.second !== null ? raw.second : {}
  ) as Record<string, unknown>;
  for (const field of F004_SECONDARY_FIELDS) {
    const entry = storedSecond[field];
    if (typeof entry === "string") second[field] = entry;
    else if (Array.isArray(entry)) {
      second[field] = entry.filter((one): one is string => typeof one === "string");
    }
  }

  if (raw.kind !== "a2_section_review" || typeof raw.responses !== "object") {
    return { kind: "a2_section_review", responses, second };
  }

  for (const [key, response] of Object.entries(raw.responses)) {
    const item = a2ReviewItem(key);
    if (item === undefined) continue;

    const degree = String(response?.degree ?? "");

    // `supplied` never arrives on a posted `a2_degree_*` field — the page never offers one for a
    // blank item — so it is not one of `isA2Degree`'s three and is read back on its own, carrying
    // only a value, the same shape `collectSecondaryReview` writes.
    if (degree === "supplied") {
      responses[key] = { degree, value: storedValue(item, response.value) };
      continue;
    }

    if (!isA2Degree(degree)) continue;

    if (degree === "agree") {
      responses[key] = { degree };
      continue;
    }

    const statement = typeof response.statement === "string" ? response.statement.trim() : "";

    responses[key] =
      degree === "clarification"
        ? { degree, statement }
        : { degree, value: storedValue(item, response.value), statement };
  }

  return { kind: "a2_section_review", responses, second };
}

/**
 * One string, compared the way two answers to the same question should be.
 *
 * Trimmed, and internal runs of whitespace collapsed, because "the same answer typed again" is
 * what this comparison exists to catch and a copied paragraph that picked up a line break is still
 * the same paragraph. Case is kept: two spellings of a word are two pieces of prose, and deciding
 * they are one answer would be this file inventing a judgement the form never asked it to make.
 */
function sameText(a: string, b: string): boolean {
  const flatten = (raw: string) => raw.trim().replace(/\s+/g, " ");
  return flatten(a) === flatten(b);
}

/**
 * The first assessor's own answer to one review item, in the shape that item's replacement takes.
 *
 * Read through the item rather than through the field name, so the four `valueKind`s answer in the
 * four shapes `postedValue` and `storedValue` already speak — which is what lets one comparison
 * below serve all of them.
 *
 * The `fields` case pairs `item.fields[i]` with `item.a1Fields[i]`. The two lists are built in one
 * expression in `IMDRF_A2_ITEMS`, in the same order, from the same row of the form — the levels
 * this row has, then its coding box — so the pairing is a property of that generator rather than
 * an assumption made here about it.
 */
function a1ValueOf(item: A2ReviewItem, a1Answers: F004Answers): A2Value {
  if (item.valueKind === "multi") return list(a1Answers, answerField(item));

  if (item.valueKind === "fields") {
    const parts: Record<string, string> = {};
    (item.fields ?? []).forEach((field, index) => {
      parts[field.key] = value(a1Answers, item.a1Fields[index] ?? "").trim();
    });
    return parts;
  }

  return value(a1Answers, answerField(item)).trim();
}

/**
 * Whether a Disagree's replacement is, in fact, the answer being disagreed with.
 *
 * Disagree means "this answer is wrong, here is the right one". A replacement identical to what
 * the first assessor already wrote is not a correction — it is a finding the manager cannot act
 * on, exactly as an empty one is, and the two are refused side by side for the same reason.
 *
 * Order does not distinguish two sets of mitigation actions: 7.1 is a list of ticks, and ticking
 * the same eleven boxes in a different sequence is the same answer. Every other kind compares as
 * the single thing it is.
 */
function sameAsA1(item: A2ReviewItem, replacement: A2Value | undefined, a1Answers: F004Answers) {
  if (replacement === undefined) return false;

  const a1 = a1ValueOf(item, a1Answers);

  if (Array.isArray(a1)) {
    if (!Array.isArray(replacement)) return false;
    const clean = (entries: readonly string[]) =>
      new Set(entries.map((entry) => entry.trim()).filter((entry) => entry !== ""));
    const mine = clean(replacement);
    const theirs = clean(a1);
    return mine.size === theirs.size && [...mine].every((entry) => theirs.has(entry));
  }

  if (typeof a1 === "object") {
    if (typeof replacement !== "object" || replacement === null || Array.isArray(replacement)) {
      return false;
    }
    return (item.fields ?? []).every((field) =>
      sameText(replacement[field.key] ?? "", a1[field.key] ?? ""),
    );
  }

  if (typeof replacement !== "string") return false;
  return sameText(replacement, a1);
}

/**
 * What a second submission must carry: a position on every one of A1's answers, and the words the
 * two positions that are not Agree cannot mean anything without.
 *
 * A draft may be as empty as the assessor likes. A submission moves the report to the manager for
 * a decision, and a "Disagree" with no corrected value, or a "Required clarification" with nothing
 * asked, is a finding the manager cannot act on. The value is required for Disagree alone —
 * Required clarification does not replace A1's answer, so there is nothing there to require.
 *
 * An item A1 left blank never reaches these rules at all: `supplied` is optional by definition, so
 * there is nothing to require of it, whichever way it was left.
 */
export function validateSecondaryReviewForSubmit(
  review: SecondaryReviewPayload,
  a1Answers: F004Answers,
): Issue[] {
  const issues: Issue[] = [];

  for (const item of SECONDARY_REVIEW_ITEMS) {
    if (isA1Blank(item, a1Answers)) continue;

    const response = review.responses[item.key];
    const degree = response?.degree;

    if (degree === undefined) {
      issues.push({
        field: `a2_degree_${item.key}`,
        message: `${item.no} ${item.title}: choose Agree, Required clarification, or Disagree.`,
      });
      continue;
    }

    if (degree === "agree") continue;

    if (degree === "disagree") {
      if (isBlankA2Value(response?.value)) {
        issues.push({
          field: `a2_value_${item.key}`,
          message: `${item.no} ${item.title}: Disagree replaces the first assessor's answer, so give the corrected one.`,
        });
      } else if (sameAsA1(item, response?.value, a1Answers)) {
        // Enforced here and not only in the page, because the page is a convenience and this is
        // the rule. The control for A1's own answer is not drawn for a reader to choose, but a
        // hand-written POST is under no obligation to have read the page at all.
        issues.push({
          field: `a2_value_${item.key}`,
          message: `${item.no} ${item.title}: Disagree must give a different ${item.valueLabel} — that is the first assessor's own answer.`,
        });
      }
    }

    if ((response?.statement ?? "").trim() === "") {
      issues.push({
        field: `a2_statement_${item.key}`,
        message: `${item.no} ${item.title}: ${A2_DEGREE_LABELS[degree]} requires a statement.`,
      });
    }
  }

  return issues;
}
