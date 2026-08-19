import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { currentSession } from "../session-guard.js";
import { DashboardPage } from "../views/dashboard.js";
import type { ReceivedRow } from "../views/reports.js";
import { loadActivity } from "./activity.js";

/** Enough of the trail to see what happened last, without becoming a second /activity. */
const RECENT_ACTIVITY = 5;

/** Enough of the queue to see what is waiting, without becoming a second /reports. */
const RECEIVED_PREVIEW = 5;

/** The five columns the queue prints. `payload` is no more welcome here than in the register. */
function toReceivedRow(row: unknown): ReceivedRow {
  const report = row as {
    id: string;
    number: string;
    received_at: Date;
    device_name: string;
    severity: string;
  };

  return {
    id: report.id,
    number: report.number,
    receivedAt: report.received_at,
    deviceName: report.device_name,
    severity: report.severity,
  };
}

/** Registered in the innermost scope, so both guards have already run by the time this answers. */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dashboard", async (request, reply) => {
    const session = currentSession(request);
    const isAdministrator = session.role === "administrator";
    // The enum, not the caption. `assessor` is what the column stores; "Officer" is what the page
    // calls it, and a branch written against the caption would break the day the caption changes.
    const isOfficer = session.role === "assessor";

    // Counted with ::int rather than left as bigint, which the driver hands back as a string.
    // A vigilance register that outgrows an int is not a problem this line will be around for.
    const totals = await app.db.execute(sql`SELECT count(*)::int AS reports FROM reports`);
    const reportCount = (totals[0] as { reports: number }).reports;

    // The administrator's extras are fetched only for an administrator. A manager's dashboard
    // must not run the queries behind a page they would be refused.
    const staffRows = isAdministrator
      ? await app.db.execute(sql`SELECT count(*)::int AS staff FROM users WHERE is_active`)
      : [];
    const activeStaff = isAdministrator ? (staffRows[0] as { staff: number }).staff : undefined;

    const recent = isAdministrator ? await loadActivity(app, RECENT_ACTIVITY) : [];

    // The Officer's queue: what has arrived and had nothing done to it. Fetched for an Officer
    // alone, on the same argument as the administrator's extras above.
    //
    // One query rather than a count and a list. A window function is computed before LIMIT, so the
    // figure and the rows come off one scan of one snapshot and cannot disagree — two statements
    // could print "seven waiting" over six rows if a report arrived between them. Cast to int
    // because count() is bigint, which the driver hands back as a string.
    const queue = isOfficer
      ? await app.db.execute(sql`
          SELECT id, number, received_at, device_name, severity,
                 (count(*) OVER ())::int AS received
            FROM reports
           WHERE status = 'received'
           ORDER BY received_at DESC, number DESC
           LIMIT ${RECEIVED_PREVIEW}
        `)
      : [];

    const received = isOfficer
      ? {
          // No rows is nothing waiting. The window count only exists on a row, so an empty result
          // has to say so here rather than be read off one.
          count: queue.length === 0 ? 0 : (queue[0] as { received: number }).received,
          rows: queue.map(toReceivedRow),
        }
      : undefined;

    return reply.html(
      <DashboardPage
        fullName={session.fullName}
        role={session.role}
        reportCount={reportCount}
        activeStaff={activeStaff}
        received={received}
        recent={recent}
      />,
    );
  });
}
