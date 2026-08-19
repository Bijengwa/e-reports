import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { currentSession } from "../session-guard.js";
import { DashboardPage } from "../views/dashboard.js";
import { loadActivity } from "./activity.js";

/** Enough of the trail to see what happened last, without becoming a second /activity. */
const RECENT_ACTIVITY = 5;

/** Registered in the innermost scope, so both guards have already run by the time this answers. */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dashboard", async (request, reply) => {
    const session = currentSession(request);
    const isAdministrator = session.role === "administrator";

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

    return reply.html(
      <DashboardPage
        fullName={session.fullName}
        role={session.role}
        reportCount={reportCount}
        activeStaff={activeStaff}
        recent={recent}
      />,
    );
  });
}
