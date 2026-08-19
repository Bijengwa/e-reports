import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { currentSession } from "../session-guard.js";
import { MyAssessmentsPage } from "../views/assessments.js";
import type { ReceivedRow } from "../views/reports.js";

/** The statuses a report is in once its first assessment has been sent on. */
const SENT_ON = ["awaiting_second_assessor", "second_assessment", "awaiting_decision", "closed"];

function toRow(row: unknown): ReceivedRow & { status: string } {
  const report = row as {
    id: string;
    number: string;
    received_at: Date;
    device_name: string;
    severity: string;
    status: string;
  };

  return {
    id: report.id,
    number: report.number,
    receivedAt: report.received_at,
    deviceName: report.device_name,
    severity: report.severity,
    status: report.status,
    // Every row on this page is the reader's own by construction, so every one offers the way in.
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
 * One query, grouped in code rather than run three times. The three groups partition one set —
 * what is assigned to the reader — and three statements could return a report twice, or not at
 * all, if its status changed between them.
 */
export async function myAssessmentsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/assessments", async (request, reply) => {
    const session = currentSession(request);

    const rows = await app.db.execute(sql`
      SELECT id, number, received_at, device_name, severity, status::text AS status
        FROM reports
       WHERE assessor1_user_id = ${session.userId}
       ORDER BY received_at DESC, number DESC
    `);

    const mine = rows.map(toRow);

    return reply.html(
      <MyAssessmentsPage
        viewerRole={session.role}
        viewerName={session.fullName}
        notStarted={mine.filter((row) => row.status === "received")}
        inProgress={mine.filter((row) => row.status === "first_assessment")}
        submitted={mine.filter((row) => SENT_ON.includes(row.status))}
      />,
    );
  });
}
