import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { A2ReviewPayload, F004Answers } from "../../../domain/f004.js";
import {
  FIRST_ASSESSMENT,
  normalizeSecondReview,
  prefillDeviceRows,
  prefillEventRows,
} from "../../../domain/f004.js";
import { currentSession } from "../session-guard.js";
import type { SectionComment } from "../views/f004.js";
import {
  type AssessorOption,
  type ManagerReviewNote,
  type ReportDetail,
  ReportPage,
  type ReportRow,
  ReportsPage,
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
  // `payload` is deliberately not selected. The list has no use for it, and the largest column in
  // the table has no business crossing the wire two hundred times to be discarded.
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
 * The register, read-only, for every signed-in role.
 *
 * Registered beside the dashboard rather than inside the administrator scope: a manager and an
 * officer need these pages to do the job the system exists for, and an administrator's extra
 * powers are about accounts, not about who may read a report.
 *
 * Nothing here writes. There is no assignment, no assessment, no status change and no attachment
 * download, because each of those needs a decision about who may do it and this slice does not
 * make one. The route file having no INSERT or UPDATE in it is the honest form of that: migration
 * 0005 grants this role SELECT on `reports` and nothing else, so the database agrees.
 */
/**
 * One report in full, with the id of the Officer it belongs to.
 *
 * Exported because the assessment page reads the same row. Two queries for one report is how the
 * page an Officer assesses stops matching the page they were shown.
 *
 * The assignee comes back beside the report rather than on it: `ReportDetail` is what a page
 * prints, and who a report belongs to decides what a reader may do, not what they see.
 */
/**
 * The first assessment, read back for the manager's benefit — never for editing.
 *
 * Present only once ordinal 1 is actually submitted. A draft in progress is the first assessor's
 * unfinished work, not a record for anyone else to read yet, on the same argument `assessment.tsx`
 * already makes for not writing a half-finished one under their name.
 */
export type Assessment1Read = {
  assessorName: string;
  answers: F004Answers;
  conclusion: string | null;
  submittedOn: string;
  /** The manager's review of it, once one has been written. Null until then. */
  managerComment: ManagerReviewNote | null;
};

/**
 * The second assessment, read back: a draft in progress or a finished record.
 *
 * Unlike `Assessment1Read` this is present before it is submitted, because the second assessor's
 * own page has to put their draft back on the form. `submitted` is what separates the two, and
 * every reader other than that Officer is given this only once it is true.
 */
export type Assessment2Read = {
  assessorName: string;
  answers: A2ReviewPayload;
  conclusion: string | null;
  submitted: boolean;
  submittedOn: string | null;
};

export async function loadReport(
  app: FastifyInstance,
  id: string,
): Promise<{
  report: ReportDetail;
  assessor1UserId: string | null;
  assessor2UserId: string | null;
  /** Who holds each half of the review, for the page that says so. Null when nobody does yet. */
  assessor1Name: string | null;
  assessor2Name: string | null;
  assessment1: Assessment1Read | null;
  /** The second assessment, draft or finished. Null until the second assessor first saves. */
  assessment2: Assessment2Read | null;
} | null> {
  // Left joins throughout: `entered_by_user_id` is null for everything the public door filed,
  // `assessor1_user_id` is null for an orphan, and the assessment itself does not exist until the
  // first assessor has saved a draft — an inner join on any of the three would quietly hide rows
  // that belong on this page.
  const rows = await app.db.execute(sql`
    SELECT r.id, r.number, r.received_at, r.device_name, r.severity, r.status, r.channel,
           r.facility, r.reporter_name, r.form_version, r.payload, r.assessor1_user_id,
           r.assessor2_user_id,
           u.full_name AS filled_by,
           a1.full_name AS assessor1_name,
           a2.full_name AS assessor2_name,
           asm.payload AS assessment1_payload,
           asm.conclusion AS assessment1_conclusion,
           asm.submitted_at AS assessment1_submitted_at,
           asm.manager_comment AS assessment1_comment,
           asm.manager_comment_at AS assessment1_comment_at,
           mc.full_name AS assessment1_comment_by,
           asm2.payload AS assessment2_payload,
           asm2.conclusion AS assessment2_conclusion,
           asm2.submitted_at AS assessment2_submitted_at
      FROM reports r
      LEFT JOIN users u ON u.id = r.entered_by_user_id
      LEFT JOIN users a1 ON a1.id = r.assessor1_user_id
      LEFT JOIN users a2 ON a2.id = r.assessor2_user_id
      LEFT JOIN assessments asm ON asm.report_id = r.id AND asm.ordinal = 1
      LEFT JOIN users mc ON mc.id = asm.manager_comment_by
      -- The second assessment, joined on its own ordinal rather than read from the first row.
      -- One report has at most one of each, and asking for ordinal 2 by name is what keeps the
      -- two halves of a review from ever arriving in each other's fields.
      LEFT JOIN assessments asm2 ON asm2.report_id = r.id AND asm2.ordinal = 2
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
    assessor2_name: string | null;
    assessment1_payload: unknown;
    assessment1_conclusion: string | null;
    assessment1_submitted_at: Date | null;
    assessment1_comment: string | null;
    assessment1_comment_at: Date | null;
    assessment1_comment_by: string | null;
    assessment2_payload: unknown;
    assessment2_conclusion: string | null;
    assessment2_submitted_at: Date | null;
  };

  const day = (at: Date) => new Date(at).toISOString().slice(0, 10);

  // `manager_comment_at` is what means "reviewed", not the text: the three columns are written
  // together, and reading the timestamp keeps an empty string from ever being shown as a review.
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

  // Present from the second assessor's first save, unlike ordinal 1: their own page has to put a
  // half-written 7.2 back on the form. Who may be handed it is the caller's question, not this
  // function's — `assessment.tsx` asks the row who it belongs to before rendering anything.
  const assessment2: Assessment2Read | null =
    row.assessment2_payload === null || row.assessment2_payload === undefined
      ? null
      : {
          assessorName: row.assessor2_name ?? "",
          answers: normalizeSecondReview(row.assessment2_payload),
          conclusion: row.assessment2_conclusion,
          submitted: row.assessment2_submitted_at !== null,
          submittedOn:
            row.assessment2_submitted_at === null ? null : day(row.assessment2_submitted_at),
        };

  return {
    report: {
      ...toRow(rows[0]),
      reporterName: row.reporter_name,
      formVersion: row.form_version,
      payload: row.payload,
      filledBy: row.filled_by,
    },
    assessor1UserId: row.assessor1_user_id,
    assessor2UserId: row.assessor2_user_id,
    assessor1Name: row.assessor1_name,
    assessor2Name: row.assessor2_name,
    assessment1,
    assessment2,
  };
}

/**
 * One report's page, with an optional refusal over it.
 *
 * Exported because the manager's review posts to a route of its own and a refused comment belongs
 * back on the page it was written on — with the picker, the first assessment and everything else
 * still there. Two places building this page separately is how the manager's copy of it starts
 * disagreeing with itself.
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

  // The manager's read of the first assessment, and the picker beside it, are both scoped to
  // the manager role alone — an assessor already has their own assessment-1 page for this, and
  // an administrator's business here is unchanged by this slice.
  const isManager = session.role === "manager";

  // The manager's notes against individual sections, fetched only for the reader who may write
  // them. Grouped here rather than in the view: the page wants a count on every section bar and a
  // thread behind each, and both come from one ordered read.
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
        // UTC, minute precision: a timestamp on a regulatory note is read, not calculated with.
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

  // The picker is offered only once there is a second assessment to hand off to someone: the
  // report has reached the status that means so, and the first assessment behind it is actually
  // submitted rather than a draft the guard above already refused to surface.
  const canPickSecondAssessor =
    isManager && found.report.status === "awaiting_second_assessor" && found.assessment1 !== null;

  // The eligible second assessors: every active Officer except the one already holding the first
  // assessment of this report. One report is reviewed by two people, so offering the first
  // assessor as a candidate offers an assignment the POST would refuse — and a control that can
  // only produce a refusal is worse than no control.
  //
  // `IS DISTINCT FROM` rather than `<>`: on an orphaned report `assessor1_user_id` is null, and
  // `id <> NULL` is null for every row, which would empty the list instead of excluding nobody.
  const secondAssessorPicker: AssessorOption[] | undefined = canPickSecondAssessor
    ? (
        await app.db.execute(
          sql`SELECT id, full_name
                FROM users
               WHERE role = 'assessor'
                 AND is_active
                 AND id IS DISTINCT FROM ${found.assessor1UserId}
               ORDER BY full_name`,
        )
      ).map((r) => {
        const u = r as { id: string; full_name: string };
        return { id: u.id, fullName: u.full_name };
      })
    : undefined;

  return reply.status(status).html(
    <ReportPage
      report={found.report}
      viewerRole={session.role}
      viewerName={session.fullName}
      error={error}
      // The way into the first assessment, drawn only for the Officer whose report it is. The
      // route behind it makes the same test for itself — this decides whether a link appears,
      // never whether the page may be opened.
      canAssess={session.role === "assessor" && found.assessor1UserId === session.userId}
      // The same test, one assessor along. Drawn from the assignment rather than from the status,
      // for the reason the first one is: the route asks the row who the work belongs to, and this
      // only decides whether that Officer is shown the way in.
      canAssess2={session.role === "assessor" && found.assessor2UserId === session.userId}
      assessor1Name={found.assessor1Name}
      assessor2Name={found.assessor2Name}
      assessment1Review={assessment1Review}
      secondAssessorPicker={secondAssessorPicker}
      // Submitted only. A draft is the second assessor's unfinished work and stays on their own
      // page, exactly as ordinal 1's does until it is sent. Not scoped to the manager: an Officer
      // reading a report they worked on may see the finished second assessment too, which is the
      // rule the first assessment's read-only render already follows for its own author.
      assessment2Review={
        found.assessment2?.submitted === true
          ? {
              assessorName: found.assessment2.assessorName,
              answers: found.assessment2.answers,
              submittedOn: found.assessment2.submittedOn ?? "",
            }
          : undefined
      }
      // Drawn only for a manager, and only over a submitted first assessment — the same gate the
      // route behind it applies to the POST. `assessment1Review` already carries the saved text.
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
