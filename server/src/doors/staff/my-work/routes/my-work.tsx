import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { loadReport } from "../../../../domain/report-detail.js";
import { currentSession } from "../../session-guard.js";
import { ForbiddenPage } from "../../shared/forbidden.js";
import { MyWorkItemPage, MyWorkPage, type WorkRow } from "../pages/my-work.js";

/** Same reason as every other page's: a uuid column compared against arbitrary text raises 22P02. */
const ReportId = z.uuid();

/** Newest first, and only this many, on the same argument as `REPORTS_LIMIT`. */
const WORK_LIMIT = 200;

/**
 * The assignment itself, read from where it actually lives.
 *
 * There is no `reports.work_officer_user_id`. Approving a report writes one `report_decisions` row
 * of kind `assign_work_officer`, and that row is the only record of who was named — so this page
 * reads the decision and joins the report to it, rather than the other way round.
 *
 * `ORDER BY decided_at DESC LIMIT 1` rather than assuming one: `assign-work-officer` only fires
 * from `awaiting_decision` and moves the report out of it, so today there is at most one per
 * report. The day something reassigns the work, the latest decision is still the true one, and
 * this reads that without having to be corrected.
 */
type AssignmentRow = {
  report_id: string;
  assigned_by_name: string;
  assigned_at: Date;
  comment: string | null;
};

async function assignmentFor(
  app: FastifyInstance,
  reportId: string,
  officerId: string,
): Promise<AssignmentRow | null> {
  const rows = await app.db.execute(sql`
    SELECT d.report_id, d.decided_at AS assigned_at, d.comment, m.full_name AS assigned_by_name
      FROM report_decisions d
      JOIN users m ON m.id = d.decided_by_user_id
     WHERE d.report_id = ${reportId}
       AND d.kind = 'assign_work_officer'
       AND d.work_officer_user_id = ${officerId}
     ORDER BY d.decided_at DESC
     LIMIT 1
  `);

  return rows.length === 0 ? null : (rows[0] as AssignmentRow);
}

function toRow(raw: unknown): WorkRow {
  const row = raw as AssignmentRow & {
    number: string;
    received_at: Date;
    device_name: string;
    severity: string;
    status: string;
  };

  return {
    reportId: row.report_id,
    number: row.number,
    receivedAt: row.received_at,
    deviceName: row.device_name,
    severity: row.severity,
    assignedByName: row.assigned_by_name,
    assignedAt: row.assigned_at,
    status: row.status,
  };
}

/**
 * One Officer's assigned work — the read side of the manager's approval.
 *
 * Registered in the assessor scope, so a manager and an administrator are refused rather than
 * shown an empty page: neither is ever assigned work, and a page that could only say "nothing
 * here" is a worse answer than saying it is not theirs. The same argument `myAssessmentsRoutes`
 * makes about the Officer's other queue.
 *
 * The authorization is the WHERE clause, on both routes, and it is the same clause. The list can
 * only build rows from decisions that name the reader, and the item is refused unless a decision
 * naming the reader exists for that exact report — so editing the id in the address meets the same
 * test the list passed rather than a weaker one. There is no branch here that loads a report first
 * and checks ownership afterwards, because that is the shape in which such a check gets forgotten.
 *
 * Nothing writes. The MVP ends at the manager's decision, so this page carries no action.
 */
export async function myWorkRoutes(app: FastifyInstance): Promise<void> {
  const forbid = (reply: FastifyReply, role: string, code: 403 | 404 = 403) =>
    reply.status(code).html(ForbiddenPage({ role }));

  app.get("/my-work", async (request, reply) => {
    const session = currentSession(request);

    const rows = await app.db.execute(sql`
      SELECT d.report_id, d.decided_at AS assigned_at, d.comment,
             m.full_name AS assigned_by_name,
             r.number, r.received_at, r.device_name, r.severity, r.status::text AS status
        FROM report_decisions d
        JOIN reports r ON r.id = d.report_id
        JOIN users m ON m.id = d.decided_by_user_id
       WHERE d.kind = 'assign_work_officer'
         AND d.work_officer_user_id = ${session.userId}
       ORDER BY d.decided_at DESC, r.number DESC
       LIMIT ${WORK_LIMIT}
    `);

    return reply.html(
      <MyWorkPage viewerRole={session.role} viewerName={session.fullName} rows={rows.map(toRow)} />,
    );
  });

  app.get("/my-work/:id", async (request, reply) => {
    const session = currentSession(request);

    const target = ReportId.safeParse((request.params as { id: string }).id);
    if (!target.success) return forbid(reply, session.role, 404);

    // Ownership first, and from the decision rather than from the report. A report this Officer
    // was not named on is refused here, before anything about it has been read — which is what
    // makes "change the id in the address" answer 403 rather than somebody else's work.
    const assignment = await assignmentFor(app, target.data, session.userId);
    if (assignment === null) return forbid(reply, session.role);

    const found = await loadReport(app, target.data);
    if (found === null) return forbid(reply, session.role, 404);

    return reply.html(
      <MyWorkItemPage
        report={found.report}
        viewerRole={session.role}
        viewerName={session.fullName}
        assignedByName={assignment.assigned_by_name}
        assignedAt={new Date(assignment.assigned_at).toISOString().slice(0, 10)}
        instruction={assignment.comment}
      />,
    );
  });
}
