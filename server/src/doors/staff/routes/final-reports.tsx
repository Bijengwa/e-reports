import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { currentSession } from "../session-guard.js";
import { type FinalReportRow, FinalReportsPage } from "../views/final-reports.js";

/** Newest first, and only this many, on the same argument as `REPORTS_LIMIT` and `WORKLOAD_LIMIT`. */
const FINAL_REPORTS_LIMIT = 200;

function toRow(raw: unknown): FinalReportRow {
  const row = raw as {
    report_id: string;
    number: string;
    received_at: Date;
    device_name: string;
    severity: string;
    status: string;
    approved_at: Date;
    resolved_through_ordinal: number;
    approved_by_name: string;
    work_officer_name: string | null;
  };

  return {
    reportId: row.report_id,
    number: row.number,
    receivedAt: row.received_at,
    deviceName: row.device_name,
    severity: row.severity,
    status: row.status,
    approvedAt: row.approved_at,
    resolvedThroughOrdinal: row.resolved_through_ordinal,
    approvedByName: row.approved_by_name,
    workOfficerName: row.work_officer_name,
  };
}

/**
 * Every approved F004, newest approval first.
 *
 * The missing index over documents that already exist. `report_final_documents` has held them
 * since approval started writing one, and `/reports/:id/final-document` has always rendered one —
 * but the only way to a final document was to already know which report it belonged to. This is
 * the list, and nothing more: it writes nothing, creates no table, and adds no status.
 *
 * Registered in the manager scope, beside the workload and the decision routes. Approving is the
 * manager's alone, so the index over what has been approved is theirs too — an Officer reaches the
 * final document of their own assigned work from My work, which is the one they have business
 * with, and is refused this page rather than shown a register-wide list.
 *
 * The work officer is joined through `decision_id` rather than looked up separately. That column
 * names the exact `assign_work_officer` decision this document was written from, in the same
 * transaction, so the officer shown beside a document is the officer that document was approved
 * with — not whoever the latest decision on the report happens to name.
 *
 * Nothing here writes, and the route file having no INSERT or UPDATE in it is the honest form of
 * that: migration 0014 grants this role SELECT on the table, and this page needs nothing more.
 */
export async function finalReportsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/final-reports", async (request, reply) => {
    const session = currentSession(request);

    const rows = await app.db.execute(sql`
      SELECT f.report_id, f.approved_at, f.resolved_through_ordinal,
             r.number, r.received_at, r.device_name, r.severity, r.status::text AS status,
             approver.full_name AS approved_by_name,
             wo.full_name AS work_officer_name
        FROM report_final_documents f
        JOIN reports r ON r.id = f.report_id
        JOIN users approver ON approver.id = f.approved_by_user_id
        JOIN report_decisions d ON d.id = f.decision_id
        LEFT JOIN users wo ON wo.id = d.work_officer_user_id
       ORDER BY f.approved_at DESC, r.number DESC
       LIMIT ${FINAL_REPORTS_LIMIT}
    `);

    return reply.html(
      <FinalReportsPage
        viewerRole={session.role}
        viewerName={session.fullName}
        rows={rows.map(toRow)}
      />,
    );
  });
}
