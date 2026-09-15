/**
 * The assessment history: the working record of one concluded case, in the order it happened.
 *
 * The Final F004 is the office's position. This is how the office got there — A1's assessment, the
 * manager's review of it, each secondary assessor's actions on it, and the manager's final
 * decision. Attached to the final document rather than mixed into it: the position is one answer
 * per question, and the argument is a separate record kept for audit.
 *
 * Nothing here is inferred. Every line is a stored column or a stored response, and a field that
 * was never recorded is absent rather than filled in with a guess about what the assessor
 * probably meant. There is deliberately no summary, no "the assessment evolved because…", and no
 * count of who agreed with whom: a regulatory audit record is read against the rows it was built
 * from, and a sentence nobody wrote is not evidence.
 *
 * No new table, either. Everything below comes off `assessments` (one row per ordinal, with the
 * manager's review of that ordinal on the same row), `report_decisions` (the manager's decisions,
 * with their recorded comment), and `report_final_documents` (the approval). The one thing that is
 * computed is the value each assessor was looking at, and it is computed with the same resolver
 * that produced the final document — see `asReviewed`.
 */

import {
  A2_DEGREE_LABELS,
  type A2Degree,
  a1ValueOf,
  describeA2Value,
  type F004Answers,
  isA1Blank,
  SECONDARY_REVIEW_ITEMS,
  type SecondaryReviewPayload,
} from "./f004.js";
import { reasonLabel } from "./f004-semantics.js";
import { type ChainEntry, resolveFinalDocument } from "./final-document.js";

/**
 * One action one assessor took on one item.
 *
 * `asReviewed` is the answer as it stood in front of THAT assessor, not A1's original and not the
 * final one. For A2 those are the same thing; for A3 they are not, and an audit record that
 * printed A1's value beside A3's disagreement would be describing a disagreement that never
 * happened.
 *
 * `replacement` and `reason` are present exactly when the assessor recorded them. A degree that
 * carries neither — an Agree — is still an action and still appears: "A2 read 4.2 and agreed" is
 * a finding, and its absence from the record would read as A2 never having looked.
 */
export type HistoryAction = {
  /** The item's own number, as the F004 prints it — "4.2", "7.1_actions". */
  itemKey: string;
  itemNo: string;
  itemTitle: string;
  degree: A2Degree;
  degreeLabel: string;
  /** The value this assessor was reading, in the words the form uses for it. */
  asReviewed: string;
  /** The value they put in its place, where they supplied one. */
  replacement?: string;
  /** Their recorded words, verbatim, and what the item calls them — "Basis", "Justification". */
  reason?: string;
  reasonLabel: string;
};

/** One answer of the first assessment, as it was submitted. */
export type HistoryResult = {
  itemNo: string;
  itemTitle: string;
  value: string;
};

/**
 * One event in the record.
 *
 * A discriminated union rather than a bag of optional fields, because the four kinds answer
 * genuinely different questions and a renderer that had to guess which half of a row was filled
 * in would be one bug away from printing an assessor as a manager.
 */
export type HistoryEvent =
  | {
      kind: "first_assessment";
      ordinal: 1;
      assessorName: string;
      /** The role the assessment was made in, as the office names it. */
      role: string;
      on: string;
      status: string;
      results: readonly HistoryResult[];
    }
  | {
      kind: "secondary_assessment";
      ordinal: number;
      assessorName: string;
      role: string;
      on: string;
      status: string;
      actions: readonly HistoryAction[];
    }
  | {
      kind: "manager_review";
      /** Which assessment was reviewed. */
      ordinal: number;
      reviewerName: string;
      on: string;
      /** The manager's recorded comment, where they left one. */
      comment?: string;
    }
  | {
      kind: "manager_decision";
      /** What the manager did: sent it to another assessor, or concluded it. */
      decision: string;
      decidedByName: string;
      on: string;
      /** The recorded grounds, where the manager wrote any. */
      grounds?: string;
      /** Who it went to, for a decision that handed it on. */
      handedTo?: string;
    };

/** What the history builder reads. Assembled by the route from rows; no database access here. */
export type AssessmentHistoryInput = {
  /** The first assessment. Absent for a report that has none, which has no history to show. */
  first: {
    assessorName: string;
    answers: F004Answers;
    submittedOn: string;
    managerComment: { text: string; byName: string; on: string } | null;
  } | null;
  /**
   * Every secondary assessment, ordinal 2 upward. Drafts are excluded by the caller: an
   * unsubmitted assessment is one Officer's unfinished work and has never been a finding.
   */
  secondary: readonly {
    ordinal: number;
    assessorName: string;
    submittedOn: string;
    review: SecondaryReviewPayload;
    managerComment: { text: string; byName: string; on: string } | null;
  }[];
  /** The manager's decisions, oldest first. */
  decisions: readonly {
    kind: "assign_next_assessor" | "assign_work_officer";
    comment: string | null;
    decidedByName: string;
    decidedAt: string;
    nextAssessorName: string | null;
    workOfficerName: string | null;
  }[];
};

/** The office's own words for who made an assessment. Both ordinals are made by an Officer. */
const ASSESSOR_ROLE = "Assessment Officer";

/**
 * How a decision is named in the record.
 *
 * The enum's own two values, spelled out. Not interpreted: `assign_work_officer` is the decision
 * that concludes a case and hands the work over, and it is named as the decision it is rather
 * than as a conclusion the record has inferred from it.
 */
const DECISION_LABELS: Record<"assign_next_assessor" | "assign_work_officer", string> = {
  assign_next_assessor: "Referred for a further assessment",
  assign_work_officer: "Approved and assigned for work",
};

/**
 * The answers as they stood when the assessment at `ordinal` opened the file.
 *
 * The same resolver the final document is made with, run over the chain BELOW this ordinal. That
 * is the whole of "the historical value must represent the value as it existed when that
 * assessment reviewed it", and it is one call rather than a second implementation of the fold:
 * were the two to drift, the history would start describing a case that never existed.
 *
 * A2 sees A1's answers. A3 sees A1's as amended by A2 — including A2's disagreement, which is
 * exactly the value A3 either overturned or left standing.
 */
function answersAsAt(
  ordinal: number,
  a1Answers: F004Answers,
  secondary: AssessmentHistoryInput["secondary"],
): F004Answers {
  const below: ChainEntry[] = secondary
    .filter((entry) => entry.ordinal < ordinal)
    .map((entry) => ({ ordinal: entry.ordinal, review: entry.review }));

  return resolveFinalDocument(a1Answers, below).answers;
}

/**
 * One secondary assessment's actions, in the form's own item order.
 *
 * Item order rather than the order the responses happen to sit in the payload's object: a reader
 * checking the history against the F004 in front of them works down the form, and a JSON key
 * order is not a fact about the assessment.
 */
function actionsOf(
  ordinal: number,
  a1Answers: F004Answers,
  secondary: AssessmentHistoryInput["secondary"],
  review: SecondaryReviewPayload,
): HistoryAction[] {
  const seen = answersAsAt(ordinal, a1Answers, secondary);
  const actions: HistoryAction[] = [];

  for (const item of SECONDARY_REVIEW_ITEMS) {
    const response = review.responses[item.key];
    if (response === undefined) continue;

    const degree = response.degree;
    if (degree === undefined) continue;

    const action: HistoryAction = {
      itemKey: item.key,
      itemNo: item.no,
      itemTitle: item.title,
      degree,
      degreeLabel: A2_DEGREE_LABELS[degree],
      // An item A1 left blank has no reviewed value, and saying so is the point: the later
      // assessor supplied an answer where there had been none, rather than changing one.
      asReviewed: isA1Blank(item, seen) ? "" : describeA2Value(item, a1ValueOf(item, seen)),
      reasonLabel: reasonLabel(item.no) ?? "Reason",
    };

    const replacement = describeA2Value(item, response.value);
    if (replacement !== "") action.replacement = replacement;

    const statement = (response.statement ?? "").trim();
    if (statement !== "") action.reason = statement;

    actions.push(action);
  }

  return actions;
}

/** The first assessment's answers to the items later assessors act on, in form order. */
function resultsOf(a1Answers: F004Answers): HistoryResult[] {
  const results: HistoryResult[] = [];

  for (const item of SECONDARY_REVIEW_ITEMS) {
    if (isA1Blank(item, a1Answers)) continue;
    const value = describeA2Value(item, a1ValueOf(item, a1Answers));
    if (value === "") continue;
    results.push({ itemNo: item.no, itemTitle: item.title, value });
  }

  return results;
}

/**
 * The case's working record, oldest first.
 *
 * Built strictly from what is there. A report assessed once and concluded produces two events; one
 * that went round three assessors produces more. Nothing is emitted for an assessment that does
 * not exist, which is why there is no loop over "ordinals 1..3" anywhere below — the events come
 * from the rows, and a case with two assessments has two.
 *
 * Ordering is the order of the workflow rather than of the timestamps, and the two agree: an
 * ordinal cannot be created before the decision that created it, and a manager's review of an
 * assessment cannot precede its submission. Sorting by string timestamps instead would put a
 * review recorded on the same day as a submission in whichever order the formatter happened to
 * produce, so the structure is what orders the record and the dates are printed as evidence.
 */
export function buildAssessmentHistory(input: AssessmentHistoryInput): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  if (input.first === null) return events;

  const a1 = input.first;
  const secondary = [...input.secondary].sort((a, b) => a.ordinal - b.ordinal);

  events.push({
    kind: "first_assessment",
    ordinal: 1,
    assessorName: a1.assessorName,
    role: ASSESSOR_ROLE,
    on: a1.submittedOn,
    status: "Submitted",
    results: resultsOf(a1.answers),
  });

  if (a1.managerComment !== null) {
    const review: HistoryEvent = {
      kind: "manager_review",
      ordinal: 1,
      reviewerName: a1.managerComment.byName,
      on: a1.managerComment.on,
    };
    const text = a1.managerComment.text.trim();
    if (text !== "") review.comment = text;
    events.push(review);
  }

  // The decision that referred the case to each further assessor, ahead of that assessor's own
  // work. Matched by the ordinal it created, so a case whose second assessment predates the
  // decision table does not acquire an invented referral.
  const referrals = input.decisions.filter((d) => d.kind === "assign_next_assessor");

  for (const [index, entry] of secondary.entries()) {
    const referral = referrals[index];
    if (referral !== undefined) {
      const decision: HistoryEvent = {
        kind: "manager_decision",
        decision: DECISION_LABELS.assign_next_assessor,
        decidedByName: referral.decidedByName,
        on: referral.decidedAt,
      };
      const grounds = (referral.comment ?? "").trim();
      if (grounds !== "") decision.grounds = grounds;
      if (referral.nextAssessorName !== null) decision.handedTo = referral.nextAssessorName;
      events.push(decision);
    }

    events.push({
      kind: "secondary_assessment",
      ordinal: entry.ordinal,
      assessorName: entry.assessorName,
      role: ASSESSOR_ROLE,
      on: entry.submittedOn,
      status: "Submitted",
      actions: actionsOf(entry.ordinal, a1.answers, secondary, entry.review),
    });

    if (entry.managerComment !== null) {
      const review: HistoryEvent = {
        kind: "manager_review",
        ordinal: entry.ordinal,
        reviewerName: entry.managerComment.byName,
        on: entry.managerComment.on,
      };
      const text = entry.managerComment.text.trim();
      if (text !== "") review.comment = text;
      events.push(review);
    }
  }

  const concluded = input.decisions.find((d) => d.kind === "assign_work_officer");
  if (concluded !== undefined) {
    const decision: HistoryEvent = {
      kind: "manager_decision",
      decision: DECISION_LABELS.assign_work_officer,
      decidedByName: concluded.decidedByName,
      on: concluded.decidedAt,
    };
    const grounds = (concluded.comment ?? "").trim();
    if (grounds !== "") decision.grounds = grounds;
    if (concluded.workOfficerName !== null) decision.handedTo = concluded.workOfficerName;
    events.push(decision);
  }

  return events;
}
