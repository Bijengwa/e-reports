import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentSession } from "../session-guard.js";
import { Assessment1Page } from "../views/assessment.js";
import { ForbiddenPage } from "../views/forbidden.js";
import { loadReport } from "./reports.js";

/** Same reason as the register's: a uuid column compared against arbitrary text raises 22P02. */
const ReportId = z.uuid();

/**
 * The first assessment of one report.
 *
 * Read-only, and a doorway rather than a form. What it settles is who may stand in it: the Officer
 * this report was given to, and nobody else.
 *
 * Being an assessor is not enough, which is why the scope's `requireRole` is not the whole answer
 * and this route tests the row as well. A colleague's report is a colleague's to assess — reading
 * it stays fine, and `/reports/:id` still shows it to everyone, but the page where an assessment
 * will be written belongs to one person.
 *
 * An unassigned report is refused too. Nobody has been given it, so nobody may open its
 * assessment; the route that hands out an orphan does not exist yet, and this must not quietly
 * become it by letting whoever asks first walk in.
 *
 * 403 rather than 404. The report exists and the reader can already see it on `/reports/:id`, so
 * pretending it is missing would be a lie they could disprove in one click.
 */
export async function assessmentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/reports/:id/assessment-1", async (request, reply) => {
    const session = currentSession(request);

    const target = ReportId.safeParse((request.params as { id: string }).id);
    if (!target.success) return reply.status(404).html(ForbiddenPage({ role: session.role }));

    const found = await loadReport(app, target.data);
    if (found === null) return reply.status(404).html(ForbiddenPage({ role: session.role }));

    // An orphan fails this too: nobody has been given it, and `null === userId` is false.
    if (found.assessor1UserId !== session.userId) {
      return reply.status(403).html(ForbiddenPage({ role: session.role }));
    }

    return reply.html(
      <Assessment1Page
        report={found.report}
        viewerRole={session.role}
        viewerName={session.fullName}
      />,
    );
  });
}
