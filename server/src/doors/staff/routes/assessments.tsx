import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { currentSession } from "../session-guard.js";
import { MyAssessmentsPage, type SecondAssessmentRow } from "../views/assessments.js";
import type { ReceivedRow } from "../views/reports.js";

/** The statuses a report is in once its first assessment has been sent on. */
const SENT_ON = ["awaiting_second_assessor", "second_assessment", "awaiting_decision", "closed"];

/** One report as this page's query returns it, before it is sorted into the reader's two roles. */
type Row = {
  id: string;
  number: string;
  received_at: Date;
  device_name: string;
  severity: string;
  status: string;
  assessor1_user_id: string | null;
  assessor2_user_id: string | null;
};

function toRow(report: Row): ReceivedRow & { status: string } {
  return {
    id: report.id,
    number: report.number,
    receivedAt: report.received_at,
    deviceName: report.device_name,
    severity: report.severity,
    status: report.status,
    // Only the rows the reader holds as first assessor reach this mapper, so every one offers the
    // way into the F004 that is theirs to write.
    mine: true,
  };
}

/**
 * The same report, as work the reader holds as second assessor rather than first.
 *
 * A narrower row on purpose: it carries no `mine`, because the way in that flag decides is the
 * first assessment's page, and that page is not this Officer's to open on this report.
 */
function toSecondRow(report: Row): SecondAssessmentRow {
  return {
    id: report.id,
    number: report.number,
    receivedAt: report.received_at,
    deviceName: report.device_name,
    severity: report.severity,
    status: report.status,
  };
}

/**
 * One Officer's own work.
 *
 * Registered in the assessor scope, so a manager and an administrator are refused rather than
 * shown an empty page — neither is ever assigned a report, and a page that could only say
 * "nothing here" is a worse answer than saying it is not theirs.
 *
 * One query, grouped in code rather than run three times. The three groups partition one set —
 * what is assigned to the reader — and three statements could return a report twice, or not at
 * all, if its status changed between them.
 */
export async function myAssessmentsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/assessments", async (request, reply) => {
    const session = currentSession(request);

    const rows = await app.db.execute(sql`
      SELECT id, number, received_at, device_name, severity, status::text AS status,
             assessor1_user_id, assessor2_user_id
        FROM reports
       WHERE assessor1_user_id = ${session.userId}
          OR assessor2_user_id = ${session.userId}
       ORDER BY received_at DESC, number DESC
    `);

    // Sorted by which role the reader holds on each report rather than by status alone. The same
    // Officer is first assessor on some reports and second on others, and those are different jobs
    // on different reports — a report cannot be both, because the assignment refuses to name the
    // first assessor as the second.
    const all = rows as unknown as Row[];
    const asFirst = all.filter((row) => row.assessor1_user_id === session.userId);
    const asSecond = all.filter((row) => row.assessor2_user_id === session.userId);

    const mine = asFirst.map(toRow);

    return reply.html(
      <MyAssessmentsPage
        viewerRole={session.role}
        viewerName={session.fullName}
        notStarted={mine.filter((row) => row.status === "received")}
        inProgress={mine.filter((row) => row.status === "first_assessment")}
        submitted={mine.filter((row) => SENT_ON.includes(row.status))}
        secondAssessment={asSecond.map(toSecondRow)}
      />,
    );
  });
}
