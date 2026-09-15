/**
 * The report/case record: one report's data, assembled from `reports`, `assessments` and
 * `report_decisions`, for the Register's case-detail view and every workflow that reads a report by
 * id.
 *
 * Pure data — no Fastify request/reply, no JSX. The Register's case-detail route renders this;
 * `assessment`, `decisions`, `my-work` and `final-reports` read it to check who a report belongs to
 * and what has already happened to it.
 */

import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { type F004Answers, normalizeSecondaryReview, type SecondaryReviewPayload } from "./f004.js";

/** Captions for the enums a report carries. The stored value is the fact; this is the word. */
export const SEVERITY_LABELS: Record<string, string> = {
  death: "Death",
  life_threatening: "Life-threatening",
  hospitalization: "Hospitalization",
  other: "Other",
};

/**
 * `awaiting_second_assessor` and `second_assessment` are reused for every secondary-assessment
 * cycle now, not only the second — the captions say "next"/"a secondary assessor" rather than
 * "second" so the wording stays true once a report reaches A3 or A4. The stored enum values are
 * unchanged; see `db/schema/index.ts`.
 */
export const STATUS_LABELS: Record<string, string> = {
  received: "Received",
  first_assessment: "First assessment",
  awaiting_second_assessor: "Awaiting next assessor",
  second_assessment: "Secondary assessment in progress",
  awaiting_decision: "Awaiting manager decision",
  closed: "Closed",
  assigned_for_work: "Assigned for work",
};

export function caption(labels: Record<string, string>, value: string): string {
  return labels[value] ?? value;
}

/**
 * Death and life-threatening are the two an officer should see without reading the row.
 *
 * Exported so every queue drawn from the register tags the same severity the same colour — two
 * rows drawn by different code disagreeing about a colour is how a queue starts contradicting the
 * register it is drawn from.
 */
export function severityTone(severity: string): string {
  return severity === "death" || severity === "life_threatening" ? "caution" : "safe";
}

/** One date format for every queue in the app. */
export function day(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** A row of the register, as the list needs it. `payload` is deliberately not among these. */
export type ReportRow = {
  id: string;
  number: string;
  receivedAt: Date;
  deviceName: string;
  severity: string;
  status: string;
  channel: string;
  facility: string | null;
};

/**
 * A report as a short list needs it: what it is, when it landed, and how badly it went.
 *
 * Narrower than `ReportRow` on purpose. Status is the same word on every row of a queue built by
 * filtering on status, and channel and facility are the register's own.
 */
export type ReceivedRow = Pick<
  ReportRow,
  "id" | "number" | "receivedAt" | "deviceName" | "severity"
> & {
  /**
   * Whether this report is the reader's own to assess.
   *
   * The queue also carries orphans — reports filed while no assessor was active — and those are
   * nobody's until something assigns them. Only a row already yours offers the way in.
   */
  mine: boolean;
};

/** One report in full: the columns above, plus the document the reporter actually submitted. */
export type ReportDetail = ReportRow & {
  reporterName: string | null;
  formVersion: string;
  /** The immutable submission snapshot. Rendered as text, never interpreted. */
  payload: unknown;
  /**
   * The staff member who keyed it in, or null when the public filed it themselves.
   *
   * Who typed it, not who is handling it. Nothing is assigned yet and this line must not be read
   * as saying otherwise — which is why it reads "Filled by" and appears only when somebody did.
   */
  filledBy: string | null;
};

/** Where an Officer opens the first assessment of a report that is theirs. */
export function assessment1Href(reportId: string): string {
  return `/register/${reportId}/assessment-1`;
}

/** Where an Officer opens their own secondary assessment of a report, whatever ordinal it is. */
export function secondaryAssessmentHref(reportId: string): string {
  return `/register/${reportId}/secondary-assessment`;
}

/**
 * Where a case's own record lives on the Register — the case's canonical page.
 *
 * Exported so every reader of a report id — the assessment queues, My work, the Final Document —
 * links back to the same page rather than each growing its own address for "the case itself".
 */
export function caseHref(reportId: string): string {
  return `/register/${reportId}`;
}

/**
 * A saved manager review, wherever it is read.
 *
 * The reviewer's name and the day, never their id: who reviewed an assessment is a fact the page
 * states, and the row's own key is not the reader's business.
 */
export type ManagerReviewNote = { text: string; byName: string; on: string };

/**
 * Present only once ordinal 1 is actually submitted. A draft in progress is the first assessor's
 * unfinished work, not a record for anyone else to read yet.
 */
export type Assessment1Read = {
  assessorName: string;
  answers: F004Answers;
  conclusion: string | null;
  submittedOn: string;
  managerComment: ManagerReviewNote | null;
};

/** One finished (or open) secondary assessment, as every reader of a case's record needs it. */
export type SecondaryAssignment = {
  ordinal: number;
  assessorId: string;
  assessorName: string;
  submitted: boolean;
  submittedOn: string | null;
  dueAt: Date | null;
  answers: SecondaryReviewPayload;
};

/** One manager decision, as the decision-history block prints it. */
export type DecisionEntry = {
  kind: "assign_next_assessor" | "assign_work_officer";
  comment: string | null;
  decidedByName: string;
  decidedAt: string;
  reviewedThroughOrdinal: number;
  nextAssessorName: string | null;
  nextOrdinal: number | null;
  workOfficerName: string | null;
};

/** One candidate for a next-assessor or work-officer picker: enough to name them. */
export type AssessorOption = {
  id: string;
  fullName: string;
  /**
   * How much of `assessments` is currently this Officer's — undefined for a picker that has no
   * business showing it (the work-officer picker: carrying out the recommended work is a different
   * kind of load from an open assessment, and this application does not measure it the same way).
   */
  workload?: { active: number; overdue: number };
};

function toRow(row: unknown): ReportRow {
  const report = row as {
    id: string;
    number: string;
    received_at: Date;
    device_name: string;
    severity: string;
    status: string;
    channel: string;
    facility: string | null;
  };

  return {
    id: report.id,
    number: report.number,
    receivedAt: report.received_at,
    deviceName: report.device_name,
    severity: report.severity,
    status: report.status,
    channel: report.channel,
    facility: report.facility,
  };
}

/**
 * One report, with everything the case-detail page and the secondary-assessment page both read.
 *
 * `secondaryAssessments` replaces what used to be a fixed `assessor2UserId`/`assessment2` pair —
 * the entire generalization from a two-slot report to an unbounded A2..An chain is that this is a
 * list, read from `assessments.ordinal > 1`, rather than a second column. `legacyAssessor2UserId`
 * is kept only for a report assigned before this generalization existed, where a manager set
 * `assessor2_user_id` and the Officer has not yet saved a first draft — see the comment on
 * `resolveMine` in `assessment.tsx`.
 */
export async function loadReport(
  app: FastifyInstance,
  id: string,
): Promise<{
  report: ReportDetail;
  assessor1UserId: string | null;
  legacyAssessor2UserId: string | null;
  assessor1Name: string | null;
  /** Assessment 1's own deadline, whether or not it has been submitted yet. */
  assessor1DueAt: Date | null;
  assessment1: Assessment1Read | null;
  secondaryAssessments: SecondaryAssignment[];
  decisions: DecisionEntry[];
} | null> {
  const rows = await app.db.execute(sql`
    SELECT r.id, r.number, r.received_at, r.device_name, r.severity, r.status, r.channel,
           r.facility, r.reporter_name, r.form_version, r.payload, r.assessor1_user_id,
           r.assessor2_user_id,
           u.full_name AS filled_by,
           a1.full_name AS assessor1_name,
           asm.payload AS assessment1_payload,
           asm.conclusion AS assessment1_conclusion,
           asm.submitted_at AS assessment1_submitted_at,
           asm.due_at AS assessment1_due_at,
           asm.manager_comment AS assessment1_comment,
           asm.manager_comment_at AS assessment1_comment_at,
           mc.full_name AS assessment1_comment_by
      FROM reports r
      LEFT JOIN users u ON u.id = r.entered_by_user_id
      LEFT JOIN users a1 ON a1.id = r.assessor1_user_id
      LEFT JOIN assessments asm ON asm.report_id = r.id AND asm.ordinal = 1
      LEFT JOIN users mc ON mc.id = asm.manager_comment_by
     WHERE r.id = ${id}
  `);

  if (rows.length === 0) return null;

  const row = rows[0] as {
    reporter_name: string | null;
    form_version: string;
    payload: unknown;
    filled_by: string | null;
    assessor1_user_id: string | null;
    assessor2_user_id: string | null;
    assessor1_name: string | null;
    assessment1_payload: unknown;
    assessment1_conclusion: string | null;
    assessment1_submitted_at: Date | null;
    assessment1_due_at: Date | null;
    assessment1_comment: string | null;
    assessment1_comment_at: Date | null;
    assessment1_comment_by: string | null;
  };

  const minute = (at: Date) => new Date(at).toISOString().slice(0, 16).replace("T", " ");

  const managerComment: ManagerReviewNote | null =
    row.assessment1_comment_at === null
      ? null
      : {
          text: row.assessment1_comment ?? "",
          byName: row.assessment1_comment_by ?? "",
          on: day(row.assessment1_comment_at),
        };

  const assessment1: Assessment1Read | null =
    row.assessment1_submitted_at === null
      ? null
      : {
          assessorName: row.assessor1_name ?? "",
          answers: (row.assessment1_payload ?? {}) as F004Answers,
          conclusion: row.assessment1_conclusion,
          submittedOn: day(row.assessment1_submitted_at),
          managerComment,
        };

  // Every secondary assessment this report has ever had, ordinal 2 upward, draft or submitted.
  const secondaryRows = await app.db.execute(sql`
    SELECT a.ordinal, a.assessor_id, u.full_name AS assessor_name, a.payload, a.submitted_at,
           a.due_at
      FROM assessments a
      JOIN users u ON u.id = a.assessor_id
     WHERE a.report_id = ${id} AND a.ordinal > 1
     ORDER BY a.ordinal ASC
  `);

  const secondaryAssessments: SecondaryAssignment[] = secondaryRows.map((raw) => {
    const r = raw as {
      ordinal: number;
      assessor_id: string;
      assessor_name: string;
      payload: unknown;
      submitted_at: Date | null;
      due_at: Date | null;
    };

    return {
      ordinal: r.ordinal,
      assessorId: r.assessor_id,
      assessorName: r.assessor_name,
      submitted: r.submitted_at !== null,
      submittedOn: r.submitted_at === null ? null : day(r.submitted_at),
      dueAt: r.due_at === null ? null : new Date(r.due_at),
      answers: normalizeSecondaryReview(r.payload) as SecondaryReviewPayload,
    };
  });

  // The manager's decision history: who decided, when, what, and who it was handed to next.
  const decisionRows = await app.db.execute(sql`
    SELECT d.kind, d.comment, d.decided_at, d.reviewed_through_ordinal,
           dby.full_name AS decided_by_name,
           na.full_name AS next_assessor_name, d.next_ordinal,
           wo.full_name AS work_officer_name
      FROM report_decisions d
      JOIN users dby ON dby.id = d.decided_by_user_id
      LEFT JOIN users na ON na.id = d.next_assessor_user_id
      LEFT JOIN users wo ON wo.id = d.work_officer_user_id
     WHERE d.report_id = ${id}
     ORDER BY d.decided_at ASC
  `);

  const decisions: DecisionEntry[] = decisionRows.map((raw) => {
    const r = raw as {
      kind: "assign_next_assessor" | "assign_work_officer";
      comment: string | null;
      decided_at: Date;
      reviewed_through_ordinal: number;
      decided_by_name: string;
      next_assessor_name: string | null;
      next_ordinal: number | null;
      work_officer_name: string | null;
    };

    return {
      kind: r.kind,
      comment: r.comment,
      decidedAt: minute(r.decided_at),
      decidedByName: r.decided_by_name,
      reviewedThroughOrdinal: r.reviewed_through_ordinal,
      nextAssessorName: r.next_assessor_name,
      nextOrdinal: r.next_ordinal,
      workOfficerName: r.work_officer_name,
    };
  });

  return {
    report: {
      ...toRow(rows[0]),
      reporterName: row.reporter_name,
      formVersion: row.form_version,
      payload: row.payload,
      filledBy: row.filled_by,
    },
    assessor1UserId: row.assessor1_user_id,
    legacyAssessor2UserId: row.assessor2_user_id,
    assessor1Name: row.assessor1_name,
    assessor1DueAt: row.assessment1_due_at === null ? null : new Date(row.assessment1_due_at),
    assessment1,
    secondaryAssessments,
    decisions,
  };
}
