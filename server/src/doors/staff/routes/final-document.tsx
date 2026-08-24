import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prefillDeviceRows, prefillEventRows } from "../../../domain/f004.js";
import { normalizeFinalDocument } from "../../../domain/final-document.js";
import { currentSession } from "../session-guard.js";
import { FinalDocumentPage } from "../views/final-document.js";
import { ForbiddenPage } from "../views/forbidden.js";
import { loadReport } from "./reports.js";

/** Same reason as every other report address: a uuid column against arbitrary text raises 22P02. */
const ReportId = z.uuid();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `19 Aug 2026`, as the workload and the Orange identity print a date. */
function day(at: Date): string {
  const on = new Date(at);
  return `${String(on.getUTCDate()).padStart(2, "0")} ${MONTHS[on.getUTCMonth()]} ${on.getUTCFullYear()}`;
}

type Row = {
  payload: unknown;
  approved_at: Date;
  resolved_through_ordinal: number;
  approved_by_name: string;
  work_officer_name: string | null;
};

/**
 * The Final Document of one report, as it was approved.
 *
 * Read from the snapshot and never re-resolved. That is the whole point of the table: this page
 * shows what the manager approved on the day they approved it, not what the current assessment
 * rows would resolve to if asked again today.
 *
 * Registered in the same scope as the register itself, so every signed-in role may read it. A
 * manager needs it because they approved it, the Officer carrying out the work needs it because it
 * is what they are carrying out, and an administrator can already read every report — this is the
 * clean version of one, not a new class of secret.
 *
 * 404 rather than 403 for a report that has no final document. There is nothing being withheld:
 * the document does not exist until a manager approves, and saying so is the honest answer.
 */
export async function finalDocumentRoutes(app: FastifyInstance): Promise<void> {
  const forbid = (reply: FastifyReply, role: string, code: 403 | 404 = 403) =>
    reply.status(code).html(ForbiddenPage({ role }));

  app.get("/reports/:id/final-document", async (request, reply) => {
    const session = currentSession(request);

    const target = ReportId.safeParse((request.params as { id: string }).id);
    if (!target.success) return forbid(reply, session.role, 404);

    const found = await loadReport(app, target.data);
    if (found === null) return forbid(reply, session.role, 404);

    // The work officer comes off the decision this document was written from, not off a second
    // lookup that could name a different one: `decision_id` is the join, and it was set inside the
    // same transaction that inserted this row.
    const rows = await app.db.execute(sql`
      SELECT f.payload, f.approved_at, f.resolved_through_ordinal,
             u.full_name AS approved_by_name,
             wo.full_name AS work_officer_name
        FROM report_final_documents f
        JOIN users u ON u.id = f.approved_by_user_id
        JOIN report_decisions d ON d.id = f.decision_id
        LEFT JOIN users wo ON wo.id = d.work_officer_user_id
       WHERE f.report_id = ${found.report.id}
    `);

    if (rows.length === 0) return forbid(reply, session.role, 404);

    const row = rows[0] as Row;

    // An Officer reached this from their own work list and a manager from the report; sending
    // either back to the other's page would be sending them somewhere they may not be able to open.
    const officer = session.role === "assessor";

    return reply.html(
      <FinalDocumentPage
        report={found.report}
        viewerRole={session.role}
        viewerName={session.fullName}
        document={normalizeFinalDocument(row.payload)}
        // Section 1's device rows and section 2's event rows, prefilled off the Orange Report's
        // own payload — the same call both assessment workspaces make, so the final F004 reads
        // the reporter's facts from exactly where every other rendering of this form reads them.
        device={prefillDeviceRows(found.report.payload, found.report)}
        event={prefillEventRows(found.report.payload)}
        // The F004's own assessor strip names whoever wrote A1, not whoever approved the result.
        assessorName={found.assessment1?.assessorName ?? found.assessor1Name ?? ""}
        assessedOn={found.assessment1?.submittedOn ?? ""}
        approvedByName={row.approved_by_name}
        approvedOn={day(row.approved_at)}
        resolvedThroughOrdinal={row.resolved_through_ordinal}
        workOfficerName={row.work_officer_name}
        backHref={officer ? `/my-work/${found.report.id}` : `/reports/${found.report.id}`}
        backLabel={officer ? "← Back to my work" : "← Back to the report"}
      />,
    );
  });
}
