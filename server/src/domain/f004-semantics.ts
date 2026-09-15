/**
 * What kind of thing each F004 item IS, and therefore what a later assessor may do about it.
 *
 * The form already lives as data in `f004.ts`. What did not live anywhere was the semantic fact
 * behind each item: whether the value in front of a second assessor is the reporter's claim, the
 * first assessor's finding, or something the application worked out for itself. Without that fact
 * written down, the only way to render a review control was to render the same three everywhere
 * and then hand-correct the ones that read wrong — which is how `clarifiable: false` ended up
 * repeated on four section-1 rows and seven IMDRF rows, and how a Comment box ended up over empty
 * space on rows that never had anything to comment.
 *
 * So: one declaration per numbered item, and every review control derived from it. A new item
 * cannot be added without saying what it is, and the page cannot offer a position the item's own
 * nature does not support, because the page no longer decides.
 *
 * This table states the form's semantics. It does not state policy: nothing here decides who wins
 * a disagreement, or what a manager may override. Those are regulatory questions and they are not
 * answered in a rendering module.
 */

import type { A2Degree } from "./f004.js";

/**
 * Where an item's value came from, which is a different question from what it means.
 *
 * - `reporter` — filed on the orange form, displayed by the F004, typed by nobody here.
 * - `assessor` — the first assessor's own finding, whether it is a choice or a paragraph.
 * - `system` — the application resolved it: a timestamp it recorded, a level it read out of the
 *   IMDRF hierarchy, a release it bound the assessment to.
 * - `attestation` — a signature and the date beside it. Its own author's, and nobody else's.
 */
export const ITEM_ORIGINS = ["reporter", "assessor", "system", "attestation"] as const;
export type ItemOrigin = (typeof ITEM_ORIGINS)[number];

/**
 * What a second assessor can honestly do about the item — the classification the controls come
 * from. `origin` says where the value is from; this says how it may be argued with.
 *
 * - `transcribed` — a reporter's fact. There is no finding to agree with. If it is wrong it is
 *   wrong against the Orange Report, so the only honest action is to say so: `flag_discrepancy`.
 * - `structured` — a closed-list finding whose grounds are visible in the record. Right, or wrong
 *   and here is the correct value. Nothing to elaborate, so no clarification.
 * - `reasoned` — a closed-list finding that encodes a judgement. "On what basis" is a real
 *   question here even though the answer is a radio button, which is why these three classes are
 *   not one: clarifiability follows the visibility of the reasoning, not the shape of the control.
 * - `narrative` — the answer IS the prose. Argued with in the same three ways, and a second
 *   assessor who agrees may say why.
 * - `terminology` — a controlled IMDRF selection. Reviewed at the level of the selected term:
 *   either it is the right published term or another published term is. A closed vocabulary has
 *   no third position, so no clarification.
 * - `derived` — the application resolved it. Not independently reviewable: the input it came from
 *   is the thing to review, and reviewing the consequence would record a position on a value no
 *   human chose.
 * - `attestation` — signed, not reviewed.
 */
export const REVIEW_CLASSES = [
  "transcribed",
  "structured",
  "reasoned",
  "narrative",
  "terminology",
  "derived",
  "attestation",
] as const;
export type ReviewClass = (typeof REVIEW_CLASSES)[number];

/**
 * What the prose beside an answer actually is, where an item carries any.
 *
 * The paper's second column is headed "Comments", and rendering that word over every paragraph in
 * the document is what makes a final F004 read as a database dump: a basis for a causality
 * finding, a justification of a risk level and a recommended regulatory action are three
 * different regulatory statements, and calling all three "Comment" tells the reader nothing about
 * which they are reading. The stored field names do not change; only what the document calls them.
 *
 * `none` means the item carries no prose of its own — either because it has none, or because the
 * item's own answer already IS the prose (4.3, 7.1's conclusion).
 */
export const REASON_ROLES = [
  "none",
  "basis",
  "justification",
  "recommendation",
  "evidence",
] as const;
export type ReasonRole = (typeof REASON_ROLES)[number];

/** The caption a reason carries in the document, written once so no two views name it apart. */
export const REASON_ROLE_LABELS: Record<Exclude<ReasonRole, "none">, string> = {
  basis: "Basis",
  justification: "Justification",
  recommendation: "Recommendation",
  evidence: "Evidence",
};

/**
 * One control a second assessor may be offered.
 *
 * The first four are the degrees the review payload already records (`A2Degree`). The fifth is
 * not a position on a finding and never becomes one: a discrepancy is raised against the Orange
 * Report, on a row the first assessor did not author.
 */
export const REVIEW_CONTROLS = [
  "agree",
  "disagree",
  "clarification",
  "supply",
  "flag_discrepancy",
] as const;
export type ReviewControl = (typeof REVIEW_CONTROLS)[number];

export type F004ItemSemantics = {
  /** The item's number as the paper prints it, and the key the review payload uses. */
  no: string;
  /** Which of the eight sections it belongs to — `F004_SECTION_KEYS`. */
  section: string;
  /** The stored field(s) this item's own answer lives in. */
  fields: readonly string[];
  origin: ItemOrigin;
  reviewClass: ReviewClass;
  reasonRole: ReasonRole;
  /** The field the reason lives in, where `reasonRole` is not `none`. */
  reasonField?: string;
  /**
   * Fields the application resolves from this item's own answer — the IMDRF levels and code
   * behind a selected term. Listed so a view can render them as consequences and a test can
   * assert that nothing offers a control against them.
   */
  derivedFields?: readonly string[];
  /** "(If applicable)" on the paper: the first assessor may leave it alone entirely. */
  optional?: boolean;
};

/**
 * Sections 1, 2 and 3 as one flat declaration each.
 *
 * Written out rather than generated from `DEVICE_ROWS`/`EVENT_ROWS`/`IMDRF_GROUPS`, deliberately:
 * this module is a leaf that `f004.ts` itself reads, so importing those tables back out of it at
 * module scope would be a cycle whose initialisation order decides whether the application starts.
 * The agreement between the two is not left to inspection — `f004-semantics.test.ts` asserts that
 * every row of the form's own tables has exactly one entry here and that no entry here is unknown
 * to the form.
 */
function transcribed(no: string, section: string, field: string): F004ItemSemantics {
  return {
    no,
    section,
    fields: [field],
    origin: "reporter",
    reviewClass: "transcribed",
    reasonRole: "none",
  };
}

function structured(no: string, field: string, optional?: boolean): F004ItemSemantics {
  return {
    no,
    section: "1",
    fields: [field],
    origin: "assessor",
    reviewClass: "structured",
    reasonRole: "none",
    optional,
  };
}

/** One IMDRF terminology: the term the assessor chose, and the levels/code resolved beneath it. */
function terminology(no: string, key: string, optional?: boolean): F004ItemSemantics {
  return {
    no,
    section: "3",
    fields: [`imdrf_${key}_term_id`],
    origin: "assessor",
    reviewClass: "terminology",
    reasonRole: "none",
    derivedFields: [`imdrf_${key}_l1`, `imdrf_${key}_l2`, `imdrf_${key}_l3`, `imdrf_${key}_code`],
    optional,
  };
}

/**
 * Every numbered item of the F004, once, with what it is.
 *
 * Ordered as the document is, 1.1 to 8, so this reads against the paper. Every row of the form's
 * own tables has exactly one entry, and `f004-semantics.test.ts` fails if that stops being true —
 * a row added to the F004 without a declaration of what it is does not silently inherit whatever
 * controls the last item happened to offer.
 */
export const F004_ITEM_SEMANTICS: readonly F004ItemSemantics[] = [
  transcribed("1.1", "1", "brand_name"),
  transcribed("1.2", "1", "common_name"),
  // MD or IVD. A closed pair, and the record shows which the device is — right, or wrong and
  // here is the correct one. There is no third thing to say about it.
  structured("1.3", "device_type"),
  transcribed("1.4", "1", "size"),
  transcribed("1.5", "1", "batch_serial"),
  transcribed("1.6", "1", "manufacturing_date"),
  transcribed("1.7", "1", "expiry_date"),
  transcribed("1.8", "1", "manufacturer"),
  transcribed("1.9", "1", "supplier"),
  // "(If applicable)" on the paper, so it may be blank. A fact about the register, checkable,
  // carrying no reasoning of its own.
  structured("1.10", "registration_number", true),
  // Determined from the device's own classification rules. A finding, and a checkable one; the
  // paper does not mark it "(If applicable)", so every submitted assessment owes it.
  structured("1.11", "device_class"),
  transcribed("1.12", "1", "device_status"),
  transcribed("1.13", "1", "duration"),
  transcribed("1.14", "1", "reporter"),
  transcribed("1.15", "1", "operator"),
  transcribed("1.16", "1", "facility"),
  transcribed("1.17", "1", "report_date"),
  {
    // The one section-1 row the application writes itself. Not a finding and not the reporter's
    // claim, so there is nothing here to agree with and nothing to raise against the report.
    no: "1.18",
    section: "1",
    fields: ["received_at"],
    origin: "system",
    reviewClass: "derived",
    reasonRole: "none",
  },
  // Initial, follow-up or final. Which of the three this report is, is a fact of the file.
  structured("1.19", "report_stage"),
  transcribed("2.1", "2", "description"),
  transcribed("2.2", "2", "onset_date"),
  transcribed("2.3", "2", "devices"),
  transcribed("2.4", "2", "users"),
  {
    no: "2.5",
    section: "2",
    fields: ["source_of_event"],
    origin: "assessor",
    reviewClass: "reasoned",
    reasonRole: "basis",
    reasonField: "c2_5",
  },
  {
    no: "2.6",
    section: "2",
    fields: ["seriousness"],
    origin: "assessor",
    reviewClass: "reasoned",
    reasonRole: "basis",
    reasonField: "c2_6",
  },
  {
    no: "2.7",
    section: "2",
    fields: ["public_health"],
    origin: "assessor",
    reviewClass: "reasoned",
    reasonRole: "basis",
    reasonField: "c2_7",
  },
  terminology("3.1.1", "component", true),
  terminology("3.1.2", "device_problem", true),
  terminology("3.2.1", "health_impact", true),
  terminology("3.2.2", "clinical_signs", true),
  // The one IMDRF row the paper does not mark "(If applicable)".
  terminology("3.3.1", "investigation_type"),
  terminology("3.3.2", "investigation_findings", true),
  terminology("3.3.3", "investigation_conclusion", true),
  {
    // The release the whole of section 3 is coded against. Resolved server-side, never offered as
    // a choice, and here so that a test can prove nothing reviews it.
    no: "3.0",
    section: "3",
    fields: ["imdrf_release_id"],
    origin: "system",
    reviewClass: "derived",
    reasonRole: "none",
  },
  {
    no: "4.1",
    section: "4",
    fields: ["expectedness"],
    origin: "assessor",
    reviewClass: "reasoned",
    reasonRole: "basis",
    reasonField: "c4_1",
  },
  {
    // The causality category. Its reasoning is not a note beside it — it is 4.3, an item of its
    // own that the paper gives its own number and its own space to, so `reasonRole` is `none`
    // here and 4.3 carries the discussion.
    no: "4.2",
    section: "4",
    fields: ["causality"],
    origin: "assessor",
    reviewClass: "reasoned",
    reasonRole: "none",
  },
  {
    no: "4.3",
    section: "4",
    fields: ["c4_3"],
    origin: "assessor",
    reviewClass: "narrative",
    reasonRole: "none",
  },
  {
    no: "5",
    section: "5",
    fields: ["signal_status"],
    origin: "assessor",
    reviewClass: "reasoned",
    reasonRole: "basis",
    reasonField: "c5",
  },
  {
    no: "6",
    section: "6",
    fields: ["risk_level"],
    origin: "assessor",
    reviewClass: "reasoned",
    reasonRole: "justification",
    reasonField: "c6",
  },
  {
    no: "7.1_actions",
    section: "7",
    fields: ["actions"],
    origin: "assessor",
    reviewClass: "reasoned",
    reasonRole: "none",
  },
  {
    no: "7.1_conclusion",
    section: "7",
    fields: ["conclusion"],
    origin: "assessor",
    reviewClass: "narrative",
    reasonRole: "none",
  },
  {
    no: "8",
    section: "8",
    fields: ["signature"],
    origin: "attestation",
    reviewClass: "attestation",
    reasonRole: "none",
  },
];

const BY_NO: ReadonlyMap<string, F004ItemSemantics> = new Map(
  F004_ITEM_SEMANTICS.map((item) => [item.no, item]),
);

export function semanticsFor(no: string): F004ItemSemantics | undefined {
  return BY_NO.get(no);
}

/** Every field the registry treats as a resolved consequence rather than an answer. */
export const DERIVED_FIELDS: ReadonlySet<string> = new Set(
  F004_ITEM_SEMANTICS.flatMap((item) => [
    ...(item.derivedFields ?? []),
    ...(item.reviewClass === "derived" ? item.fields : []),
  ]),
);

/**
 * The controls one review class offers, before anything is known about this particular report.
 *
 * The whole table in one place, so "what may A2 do here" is answered by reading five lines rather
 * than by tracing which view happened to draw which button.
 */
const CONTROLS_BY_CLASS: Record<ReviewClass, readonly ReviewControl[]> = {
  transcribed: ["flag_discrepancy"],
  structured: ["agree", "disagree"],
  reasoned: ["agree", "disagree", "clarification"],
  narrative: ["agree", "disagree", "clarification"],
  terminology: ["agree", "disagree"],
  derived: [],
  attestation: [],
};

/**
 * What this item offers a second assessor, on this report.
 *
 * Two arguments, because the answer depends on both: the item's class, and whether the first
 * assessor in fact left it blank. An optional item nobody answered has no finding to take a
 * position on, so the only thing on offer is supplying the value — which is what `supplied`
 * already records, and is deliberately not spelled `disagree`.
 */
export function controlsFor(no: string, options?: { a1Blank?: boolean }): readonly ReviewControl[] {
  const item = BY_NO.get(no);
  if (item === undefined) return [];

  const base = CONTROLS_BY_CLASS[item.reviewClass];
  if (base.length === 0) return base;

  if (options?.a1Blank === true) {
    // A transcribed row is blank because the reporter did not file it, which is a discrepancy
    // question and not a gap for a second assessor to fill in.
    return item.reviewClass === "transcribed" ? base : (["supply"] as const);
  }

  return base;
}

/**
 * The review degrees this item records, which is `controlsFor` minus the one control that is not
 * a degree. `allowedDegrees` in `f004.ts` reads this, so the page and the payload cannot disagree
 * about what may be chosen.
 */
export function degreesFor(no: string): readonly A2Degree[] {
  return controlsFor(no).flatMap((control) => {
    const degree = CONTROL_DEGREES[control];
    return degree === undefined ? [] : [degree];
  });
}

/**
 * Which control records which degree. Two of the five do not: a discrepancy is not a position on
 * a finding, and `supply` is offered by name only when A1 left the item blank — it reaches the
 * payload as `supplied`, the degree the record already uses for exactly that.
 */
const CONTROL_DEGREES: Partial<Record<ReviewControl, A2Degree>> = {
  agree: "agree",
  disagree: "disagree",
  clarification: "clarification",
  supply: "supplied",
};

/** Whether this item is a finding a later assessor takes a position on at all. */
export function isReviewable(no: string): boolean {
  return degreesFor(no).length > 0;
}

/**
 * Whether choosing this control obliges the assessor to write something.
 *
 * Every one of them but Agree does. That is what keeps an empty labelled box off the screen: the
 * field is drawn when the action that requires it is chosen, and it is then required, rather than
 * standing open and idle beside every answer in the document.
 */
export function reasonRequired(control: ReviewControl): boolean {
  return control !== "agree";
}

/** The caption for an item's own prose, or null where the item carries none. */
export function reasonLabel(no: string): string | null {
  const item = BY_NO.get(no);
  if (item === undefined || item.reasonRole === "none") return null;
  return REASON_ROLE_LABELS[item.reasonRole];
}

/**
 * The items a second assessor may raise a discrepancy against — the reporter's own rows.
 *
 * Not review items: they are not in `SECONDARY_REVIEW_ITEMS`, they are never required before a
 * submission, and raising one records an observation against the Orange Report rather than a
 * position on the first assessor's work.
 */
export const DISCREPANCY_ITEMS: readonly F004ItemSemantics[] = F004_ITEM_SEMANTICS.filter(
  (item) => item.reviewClass === "transcribed",
);
