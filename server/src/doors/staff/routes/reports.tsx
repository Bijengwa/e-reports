import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { F004Answers } from "../../../domain/f004.js";
import { prefillDeviceRows, prefillEventRows } from "../../../domain/f004.js";
import { currentSession } from "../session-guard.js";
import {
  type AssessorOption,
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
};

export async function loadReport(
  app: FastifyInstance,
  id: string,
): Promise<{
  report: ReportDetail;
  assessor1UserId: string | null;
  assessor2UserId: string | null;
  assessment1: Assessment1Read | null;
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
           asm.payload AS assessment1_payload,
           asm.conclusion AS assessment1_conclusion,
           asm.submitted_at AS assessment1_submitted_at
      FROM reports r
      LEFT JOIN users u ON u.id = r.entered_by_user_id
      LEFT JOIN users a1 ON a1.id = r.assessor1_user_id
      LEFT JOIN assessments asm ON asm.report_id = r.id AND asm.ordinal = 1
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
  };

  const assessment1: Assessment1Read | null =
    row.assessment1_submitted_at === null
      ? null
      : {
          assessorName: row.assessor1_name ?? "",
          answers: (row.assessment1_payload ?? {}) as F004Answers,
          conclusion: row.assessment1_conclusion,
          submittedOn: new Date(row.assessment1_submitted_at).toISOString().slice(0, 10),
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
    assessment1,
  };
}

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/reports", async (request, reply) => renderReports(app, request, reply, 200));

  app.get("/reports/:id", async (request, reply) => {
    const session = currentSession(request);

    const target = ReportId.safeParse((request.params as { id: string }).id);
    if (!target.success) return renderReports(app, request, reply, 404, NOT_FOUND);

    const found = await loadReport(app, target.data);
    if (found === null) return renderReports(app, request, reply, 404, NOT_FOUND);

    // The manager's read of the first assessment, and the picker beside it, are both scoped to
    // the manager role alone — an assessor already has their own assessment-1 page for this, and
    // an administrator's business here is unchanged by this slice.
    const isManager = session.role === "manager";

    const assessment1Review =
      isManager && found.assessment1 !== null
        ? {
            ...found.assessment1,
            device: prefillDeviceRows(found.report.payload, found.report),
            event: prefillEventRows(found.report.payload),
          }
        : undefined;

    // The picker is offered only once there is a second assessment to hand off to someone: the
    // report has reached the status that means so, and the first assessment behind it is actually
    // submitted rather than a draft the guard above already refused to surface.
    const canPickSecondAssessor =
      isManager && found.report.status === "awaiting_second_assessor" && found.assessment1 !== null;

    const secondAssessorPicker: AssessorOption[] | undefined = canPickSecondAssessor
      ? (
          await app.db.execute(
            sql`SELECT id, full_name FROM users WHERE role = 'assessor' AND is_active ORDER BY full_name`,
          )
        ).map((r) => {
          const u = r as { id: string; full_name: string };
          return { id: u.id, fullName: u.full_name };
        })
      : undefined;

    return reply.html(
      <ReportPage
        report={found.report}
        viewerRole={session.role}
        viewerName={session.fullName}
        // The way into the first assessment, drawn only for the Officer whose report it is. The
        // route behind it makes the same test for itself — this decides whether a link appears,
        // never whether the page may be opened.
        canAssess={session.role === "assessor" && found.assessor1UserId === session.userId}
        assessment1Review={assessment1Review}
        secondAssessorPicker={secondAssessorPicker}
      />,
    );
  });
}
