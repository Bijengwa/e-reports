import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { currentSession } from "../session-guard.js";
import { MyAssessmentsPage, type SecondaryAssessmentRow } from "../views/assessments.js";
import type { ReceivedRow } from "../views/reports.js";

/** One report as the primary-assessment query returns it. */
type Row = {
  id: string;
  number: string;
  received_at: Date;
  device_name: string;
  severity: string;
  status: string;
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
 * One Officer's own work.
 *
 * Registered in the assessor scope, so a manager and an administrator are refused rather than
 * shown an empty page — neither is ever assigned a report, and a page that could only say
 * "nothing here" is a worse answer than saying it is not theirs.
 *
 * Two queries rather than one, unlike before this generalization: "first assessor" is still read
 * from `reports.assessor1_user_id`, but "secondary assessor" is now `assessments.assessor_id` at
 * any ordinal above 1 — the whole point of not being a fixed second column any more.
 */
export async function myAssessmentsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/assessments", async (request, reply) => {
    const session = currentSession(request);

    const primary = await app.db.execute(sql`
      SELECT id, number, received_at, device_name, severity, status::text AS status
        FROM reports
       WHERE assessor1_user_id = ${session.userId}
       ORDER BY received_at DESC, number DESC
    `);

    const secondary = await app.db.execute(sql`
      SELECT r.id, r.number, r.received_at, r.device_name, r.severity, r.status::text AS status,
             a.ordinal, a.submitted_at
        FROM assessments a
        JOIN reports r ON r.id = a.report_id
       WHERE a.assessor_id = ${session.userId} AND a.ordinal > 1
       ORDER BY r.received_at DESC, r.number DESC
    `);

    const mine = (primary as unknown as Row[]).map(toRow);

    const secondaryRows: SecondaryAssessmentRow[] = secondary.map((raw) => {
      const r = raw as Row & { ordinal: number; submitted_at: Date | null };
      return {
        id: r.id,
        number: r.number,
        receivedAt: r.received_at,
        deviceName: r.device_name,
        severity: r.severity,
        status: r.status,
        ordinal: r.ordinal,
        submitted: r.submitted_at !== null,
      };
    });

    return reply.html(
      <MyAssessmentsPage
        viewerRole={session.role}
        viewerName={session.fullName}
        notStarted={mine.filter((row) => row.status === "received")}
        inProgress={mine.filter((row) => row.status === "first_assessment")}
        submitted={mine.filter(
          (row) => row.status !== "received" && row.status !== "first_assessment",
        )}
        secondaryAssessments={secondaryRows}
      />,
    );
  });
}
