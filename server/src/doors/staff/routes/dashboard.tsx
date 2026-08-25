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

/** The queue’s columns. `payload` is no more welcome here than in the register. */
function toReceivedRow(row: unknown, viewerId: string): ReceivedRow {
  const report = row as {
    id: string;
    number: string;
    received_at: Date;
    device_name: string;
    severity: string;
    assessor1_user_id: string | null;
  };

  return {
    id: report.id,
    number: report.number,
    receivedAt: report.received_at,
    deviceName: report.device_name,
    severity: report.severity,
    // The queue holds the reader’s own reports and the orphans. Only the first are theirs to
    // assess, and the row says which it is rather than the view guessing from a missing name.
    mine: report.assessor1_user_id === viewerId,
  };
}

/** Registered in the innermost scope, so both guards have already run by the time this answers. */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dashboard", async (request, reply) => {
    const session = currentSession(request);

    const isManager = session.role === "manager";
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

    // The Officer's queue: what has arrived, has had nothing done to it, and is theirs to do.
    // Fetched for an Officer alone, on the same argument as the administrator's extras above.
    //
    // Theirs, plus the orphans. A report filed while no assessor was active carries no assignee,
    // and showing it to nobody would leave it waiting on a route that does not exist yet — so
    // every Officer sees it and whoever picks it up has it. What is assigned to a colleague is
    // that colleague's queue and stays off this page.
    //
    // One query rather than a count and a list. A window function is computed before LIMIT, so
    // the figure and the rows come off one scan of one snapshot and cannot disagree — two
    // statements could print "seven waiting" over six rows if a report arrived between them. The
    // count sits inside this WHERE, so the figure counts exactly the reports the list draws from.
    // Cast to int because count() is bigint, which the driver hands back as a string.
    const queue = isOfficer
      ? await app.db.execute(sql`
          SELECT id, number, received_at, device_name, severity, assessor1_user_id,
                 (count(*) OVER ())::int AS received
            FROM reports
           WHERE status = 'received'
             AND (assessor1_user_id = ${session.userId} OR assessor1_user_id IS NULL)
           ORDER BY received_at DESC, number DESC
           LIMIT ${RECEIVED_PREVIEW}
        `)
      : [];

    /*
     * The manager's summary: the whole register, folded into the four states their own workload
     * page is divided by, plus how many have been approved.
     *
     * One query, and one `FILTER` per state rather than five round trips, because five counts
     * taken separately are five different moments — a report that moved between them would be
     * counted twice or not at all, and the figures on a summary page have to add up to the total
     * printed beside them.
     *
     * The mapping is `BUCKETS`' own, restated here because SQL cannot read it: `received` is not
     * started, either assessment status is in progress, either waiting-on-the-manager status is a
     * decision, and `assigned_for_work` is done. `closed` is in none of them, exactly as the
     * workload bar has no tab for it — nothing writes it and the MVP has no closing workflow. It
     * is therefore counted in `reports` and in no state, which is the honest answer.
     */
    const summaryRows = isManager
      ? await app.db.execute(sql`
          SELECT
            count(*) FILTER (WHERE status = 'received')::int AS not_started,
            count(*) FILTER (
              WHERE status IN ('first_assessment', 'second_assessment')
            )::int AS in_progress,
            count(*) FILTER (
              WHERE status IN ('awaiting_second_assessor', 'awaiting_decision')
            )::int AS decision,
            count(*) FILTER (WHERE status = 'assigned_for_work')::int AS assigned_for_work,
            (SELECT count(*) FROM report_final_documents)::int AS final_reports
          FROM reports
        `)
      : [];

    const managerSummary = isManager
      ? (() => {
          const row = summaryRows[0] as {
            not_started: number;
            in_progress: number;
            decision: number;
            assigned_for_work: number;
            final_reports: number;
          };
          return {
            notStarted: row.not_started,
            inProgress: row.in_progress,
            decision: row.decision,
            assignedForWork: row.assigned_for_work,
            finalReports: row.final_reports,
          };
        })()
      : undefined;

    const received = isOfficer
      ? {
          // No rows is nothing waiting. The window count only exists on a row, so an empty result
          // has to say so here rather than be read off one.
          count: queue.length === 0 ? 0 : (queue[0] as { received: number }).received,
          rows: queue.map((row) => toReceivedRow(row, session.userId)),
        }
      : undefined;

    return reply.html(
      <DashboardPage
        fullName={session.fullName}
        role={session.role}
        reportCount={reportCount}
        managerSummary={managerSummary}
        activeStaff={activeStaff}
        received={received}
        recent={recent}
      />,
    );
  });
}
