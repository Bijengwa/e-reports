import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { currentSession } from "../session-guard.js";
import { type ReportDetail, ReportPage, type ReportRow, ReportsPage } from "../views/reports.js";

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
export async function loadReport(
  app: FastifyInstance,
  id: string,
): Promise<{ report: ReportDetail; assessor1UserId: string | null } | null> {
  // Left join, not inner: `entered_by_user_id` is null for everything the public door filed, and
  // an inner join would quietly hide every one of those reports.
  const rows = await app.db.execute(sql`
    SELECT r.id, r.number, r.received_at, r.device_name, r.severity, r.status, r.channel,
           r.facility, r.reporter_name, r.form_version, r.payload, r.assessor1_user_id,
           u.full_name AS filled_by
      FROM reports r
      LEFT JOIN users u ON u.id = r.entered_by_user_id
     WHERE r.id = ${id}
  `);

  if (rows.length === 0) return null;

  const row = rows[0] as {
    reporter_name: string | null;
    form_version: string;
    payload: unknown;
    filled_by: string | null;
    assessor1_user_id: string | null;
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

    return reply.html(
      <ReportPage
        report={found.report}
        viewerRole={session.role}
        viewerName={session.fullName}
        // The way into the first assessment, drawn only for the Officer whose report it is. The
        // route behind it makes the same test for itself — this decides whether a link appears,
        // never whether the page may be opened.
        canAssess={session.role === "assessor" && found.assessor1UserId === session.userId}
      />,
    );
  });
}
