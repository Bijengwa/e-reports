import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { F004Answers, SecondaryReviewPayload } from "../../../domain/f004.js";
import {
  FIRST_ASSESSMENT,
  normalizeSecondaryReview,
  prefillDeviceRows,
  prefillEventRows,
} from "../../../domain/f004.js";
import { currentSession } from "../session-guard.js";
import type { SectionComment } from "../views/f004.js";
import {
  type AssessorOption,
  type DecisionEntry,
  type ManagerReviewNote,
  type ReportDetail,
  ReportPage,
  type ReportRow,
  ReportsPage,
  type SecondaryAssignment,
} from "../views/reports.js";

/** Newest first, and only this many, on the same argument as the activity trail. */
const REPORTS_LIMIT = 200;

/**
 * The report an address names, parsed before it reaches a query.
 *
 * `reports.id` is a uuid column, so comparing it against arbitrary path text would raise 22P02
 * and surface as a 500 — a mistyped link would report a broken database rather than a missing
 * report. Anything that is not a uuid is simply not a report, which is a 404.
 */
const ReportId = z.uuid();

const NOT_FOUND = "That report does not exist.";

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
 * The register, with an optional message over it.
 *
 * A stale link ends here rather than on a page of its own, and it re-runs the query rather than
 * rendering an empty list: "0 reports" would be a lie about the register, told to someone who
 * only mistyped an address.
 */
async function renderReports(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  error?: string,
): Promise<void> {
  const rows = await app.db.execute(sql`
    SELECT id, number, received_at, device_name, severity, status, channel, facility
      FROM reports
     ORDER BY received_at DESC, number DESC
     LIMIT ${REPORTS_LIMIT}
  `);

  reply
    .status(status)
    .html(
      <ReportsPage
        reports={rows.map(toRow)}
        error={error}
        viewerRole={currentSession(request).role}
        viewerName={currentSession(request).fullName}
      />,
    );
}

/**
 * The first assessment, read back for the manager's benefit — never for editing.
 *
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

/**
 * One report, with everything the report page and the secondary-assessment page both read.
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
    assessment1_comment: string | null;
    assessment1_comment_at: Date | null;
    assessment1_comment_by: string | null;
  };

  const day = (at: Date) => new Date(at).toISOString().slice(0, 10);
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
    SELECT a.ordinal, a.assessor_id, u.full_name AS assessor_name, a.payload, a.submitted_at
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
    };

    return {
      ordinal: r.ordinal,
      assessorId: r.assessor_id,
      assessorName: r.assessor_name,
      submitted: r.submitted_at !== null,
      submittedOn: r.submitted_at === null ? null : day(r.submitted_at),
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
    assessment1,
    secondaryAssessments,
    decisions,
  };
}

/**
 * One report's page, with an optional refusal over it.
 *
 * Exported because the manager's review posts to a route of its own and a refused comment belongs
 * back on the page it was written on. Two places building this page separately is how the
 * manager's copy of it starts disagreeing with itself.
 */
export async function renderReport(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  id: string,
  status: 200 | 422 = 200,
  error?: string,
): Promise<void> {
  const session = currentSession(request);

  const found = await loadReport(app, id);
  if (found === null) return renderReports(app, request, reply, 404, NOT_FOUND);

  const isManager = session.role === "manager";

  // The manager's notes against individual sections of the primary assessment. Unchanged by this
  // generalization: that mechanism is legitimately A1-only, commentary on the primary document
  // before any secondary assessor exists, and stays exactly where it was.
  const sectionComments: Record<string, SectionComment[]> = {};

  if (isManager && found.assessment1 !== null) {
    const rows = await app.db.execute(sql`
      SELECT c.section, c.body, c.created_at, u.full_name AS author
        FROM assessment_comments c
        JOIN assessments a ON a.id = c.assessment_id
        JOIN users u ON u.id = c.author_user_id
       WHERE a.report_id = ${found.report.id}
         AND a.ordinal = ${FIRST_ASSESSMENT}
       ORDER BY c.section, c.created_at
    `);

    for (const raw of rows) {
      const note = raw as { section: string; body: string; created_at: Date; author: string };
      const bucket = sectionComments[note.section] ?? [];
      bucket.push({
        author: note.author,
        body: note.body,
        at: new Date(note.created_at).toISOString().slice(0, 16).replace("T", " "),
      });
      sectionComments[note.section] = bucket;
    }
  }

  const assessment1Review =
    isManager && found.assessment1 !== null
      ? {
          ...found.assessment1,
          device: prefillDeviceRows(found.report.payload, found.report),
          event: prefillEventRows(found.report.payload),
          sectionComments,
          commentAction: (section: string) =>
            `/reports/${found.report.id}/assessment-1/sections/${section}/comments`,
        }
      : undefined;

  // Every submitted secondary review, in ordinal order — a draft in progress is excluded on the
  // same argument the single-slot page always applied: unfinished work is that Officer's alone.
  // Every secondary assessment, submitted or not: the page needs the unsubmitted ones for its
  // assessment-history strip and filters to the submitted ones for the document itself.

  // The picker for the next secondary assessor is offered whenever the report is waiting on the
  // manager to name one — the first time (`awaiting_second_assessor`, right after A1) and every
  // time after (`awaiting_decision`, once a secondary review is in). Both end in the same action.
  const canAssignNext =
    isManager &&
    (found.report.status === "awaiting_second_assessor" ||
      found.report.status === "awaiting_decision") &&
    found.assessment1 !== null;

  // Eligible next assessors: every active Officer except anyone who already holds an assessment on
  // this report, at any ordinal — A1 included.
  const nextAssessorPicker: AssessorOption[] | undefined = canAssignNext
    ? (
        await app.db.execute(sql`
          SELECT id, full_name
            FROM users
           WHERE role = 'assessor'
             AND is_active
             AND id NOT IN (
               SELECT assessor_id FROM assessments WHERE report_id = ${found.report.id}
             )
           ORDER BY full_name
        `)
      ).map((r) => {
        const u = r as { id: string; full_name: string };
        return { id: u.id, fullName: u.full_name };
      })
    : undefined;

  // The work-officer picker is offered once there is at least one finished secondary review to be
  // satisfied with. Unfiltered by design — carrying out recommended work is not a conflict of
  // interest with having assessed the report.
  const canAssignWork = isManager && found.report.status === "awaiting_decision";

  const workOfficerPicker: AssessorOption[] | undefined = canAssignWork
    ? (
        await app.db.execute(
          sql`SELECT id, full_name FROM users WHERE role = 'assessor' AND is_active ORDER BY full_name`,
        )
      ).map((r) => {
        const u = r as { id: string; full_name: string };
        return { id: u.id, fullName: u.full_name };
      })
    : undefined;

  return reply
    .status(status)
    .html(
      <ReportPage
        report={found.report}
        viewerRole={session.role}
        viewerName={session.fullName}
        error={error}
        canAssess={session.role === "assessor" && found.assessor1UserId === session.userId}
        mySecondaryOrdinal={
          session.role === "assessor"
            ? (found.secondaryAssessments.find((a) => a.assessorId === session.userId)?.ordinal ??
              (found.legacyAssessor2UserId === session.userId &&
              found.report.status === "second_assessment"
                ? 2
                : null))
            : null
        }
        assessor1Name={found.assessor1Name}
        assessment1Review={assessment1Review}
        secondaryAssessments={found.secondaryAssessments}
        nextAssessorPicker={nextAssessorPicker}
        workOfficerPicker={workOfficerPicker}
        decisions={found.decisions}
        canComment={isManager && found.assessment1 !== null}
      />,
    );
}

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/reports", async (request, reply) => renderReports(app, request, reply, 200));

  app.get("/reports/:id", async (request, reply) => {
    const target = ReportId.safeParse((request.params as { id: string }).id);
    if (!target.success) return renderReports(app, request, reply, 404, NOT_FOUND);

    return renderReport(app, request, reply, target.data);
  });
}
