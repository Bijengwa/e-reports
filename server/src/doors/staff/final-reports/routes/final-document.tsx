import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  type AssessmentHistoryInput,
  buildAssessmentHistory,
} from "../../../../domain/assessment-history.js";
import { prefillDeviceRows, prefillEventRows } from "../../../../domain/f004.js";
import {
  isConcludedFinalDocument,
  normalizeFinalDocument,
} from "../../../../domain/final-document.js";
import { loadReport } from "../../reports/routes/reports.js";
import { currentSession } from "../../session-guard.js";
import { ForbiddenPage } from "../../shared/forbidden.js";
import {
  type FinalDocumentMode,
  FinalDocumentPage,
  FinalDocumentPrintPage,
} from "../pages/final-document.js";

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
  work_officer_user_id: string | null;
  work_officer_name: string | null;
};

/**
 * Who may read the working record of a concluded assessment.
 *
 * The manager, and nobody else. This is the repository's existing rule rather than a new one: the
 * Officer's work item was stripped of the assessments and the decision history on exactly this
 * argument — being handed the conclusion to carry out is not being given the internal record of
 * who was overruled reaching it — and `/reports/:id`, which carries that record, is refused to an
 * Officer once the case is assigned for work. The history presentation is that same record
 * attached to the final document, so it answers to the same rule.
 *
 * `manager` is also the audit reader today. There is no separate audit role in `user_role`, and
 * inventing one to widen this would be this route deciding who audits the office. When such a role
 * exists, it is added here and the four addresses below all follow, because they all ask this
 * function.
 */
function mayReadHistory(role: string): boolean {
  return role === "manager";
}

/**
 * The Final Document of one report, as it was approved.
 *
 * Read from the snapshot and never re-resolved. That is the whole point of the table: this page
 * shows what the manager approved on the day they approved it, not what the current assessment
 * rows would resolve to if asked again today.
 *
 * Four addresses, one document. The clean F004 and the F004 with its assessment history are two
 * presentations of one concluded case — see `FinalDocumentMode` — and each is served both to the
 * screen and as a printable document the browser turns into a PDF. All four go through
 * `serve` below, so there is one authorization and one resolution behind every one of them.
 *
 * Registered in the broad signed-in scope, and authorized per request rather than by that scope.
 * This is the one route in the staff door where those two must differ, because who may read a
 * final document is a question about the row and not about the reader's role alone: a manager may
 * read any of them, and an Officer may read exactly the one whose approval named them as the
 * officer who has to carry it out. A scope hook cannot ask that question, so the route asks it.
 *
 * The rule, in full:
 *
 *   - manager: allowed, always. They approve these documents and they hold the register of them.
 *   - assessor: allowed only when the `assign_work_officer` decision THIS document was written
 *     from names them. Not "has an assignment on this report" and not "assessed this report" —
 *     the exact decision, reached through `f.decision_id`, so the officer shown on the page and
 *     the officer allowed to open it are read from one row and cannot disagree.
 *   - anyone else: refused. An administrator's powers are over accounts, and the concluded
 *     assessment of a vigilance report is not an account.
 *
 * And on the two history addresses, additionally: `mayReadHistory`. An Officer who may open the
 * clean document of their own assignment is refused its history, on the address as much as in the
 * page — the link is simply not drawn for them, and the route would refuse them if it were.
 *
 * The id in the address is never trusted. It selects a row; the row decides the answer. There is
 * no branch here that renders first and checks afterwards.
 *
 * 404 rather than 403 for a report that has no final document, and the same for an A1-only legacy
 * snapshot — see `isConcludedFinalDocument`. There is nothing being withheld in either case: a
 * concluded document does not exist until a manager approves one over a second assessment, and
 * saying so is the honest answer.
 */
export async function finalDocumentRoutes(app: FastifyInstance): Promise<void> {
  const forbid = (reply: FastifyReply, role: string, code: 403 | 404 = 403) =>
    reply.status(code).html(ForbiddenPage({ role }));

  async function serve(
    request: FastifyRequest,
    reply: FastifyReply,
    mode: FinalDocumentMode,
    presentation: "screen" | "print",
  ): Promise<unknown> {
    const session = currentSession(request);

    // Neither a manager nor an Officer has any business here, and there is no report-shaped
    // question to ask on their behalf. Refused before a single row is read.
    if (session.role !== "manager" && session.role !== "assessor") {
      return forbid(reply, session.role);
    }

    // The working record, before anything about this report is loaded. An Officer asking for the
    // history address is refused it whether or not the report exists and whether or not they are
    // the officer named on it: widening it by one reader is what this route must not do.
    if (mode === "history" && !mayReadHistory(session.role)) {
      return forbid(reply, session.role);
    }

    const target = ReportId.safeParse((request.params as { id: string }).id);
    if (!target.success) return forbid(reply, session.role, 404);

    // The work officer comes off the decision this document was written from, not off a second
    // lookup that could name a different one: `decision_id` is the join, and it was set inside the
    // same transaction that inserted this row. That is also what makes it safe to authorize from.
    const rows = await app.db.execute(sql`
      SELECT f.payload, f.approved_at, f.resolved_through_ordinal,
             u.full_name AS approved_by_name,
             d.work_officer_user_id,
             wo.full_name AS work_officer_name
        FROM report_final_documents f
        JOIN users u ON u.id = f.approved_by_user_id
        JOIN report_decisions d ON d.id = f.decision_id
       WHERE f.report_id = ${target.data}
    `);

    if (rows.length === 0) return forbid(reply, session.role, 404);

    const row = rows[0] as Row;

    // The authorization, on the row that was actually loaded, and ahead of everything else this
    // route might say about the document. A reader who may not have it is told nothing about it —
    // not whether it is concluded, and not whether it is a repairable legacy row.
    const officer = session.role === "assessor";
    if (officer && row.work_officer_user_id !== session.userId) {
      return forbid(reply, session.role);
    }

    // An A1-only snapshot is history, not a concluded document. It stays in the table untouched and
    // is not served as a Final F004 to anybody, the manager included — offering one would be
    // presenting an unreviewed first assessment as the office's settled position.
    if (!isConcludedFinalDocument(row.resolved_through_ordinal)) {
      return forbid(reply, session.role, 404);
    }

    const found = await loadReport(app, target.data);
    if (found === null) return forbid(reply, session.role, 404);

    // Built only for the presentation that prints it. The clean document must not so much as
    // assemble the working record, which is the strongest available statement that it does not
    // contain it.
    const history =
      mode === "history"
        ? buildAssessmentHistory({
            first:
              found.assessment1 === null
                ? null
                : {
                    assessorName: found.assessment1.assessorName,
                    answers: found.assessment1.answers,
                    submittedOn: found.assessment1.submittedOn,
                    managerComment: found.assessment1.managerComment,
                  },
            // Submitted only. A draft is one Officer's unfinished work and has never been a
            // finding, which is the same rule the resolver applies to the chain it folds.
            secondary: found.secondaryAssessments
              .filter((entry) => entry.submitted)
              .map((entry) => ({
                ordinal: entry.ordinal,
                assessorName: entry.assessorName,
                submittedOn: entry.submittedOn ?? "",
                review: entry.answers,
                managerComment: entry.managerComment,
              })),
            decisions: found.decisions,
          } satisfies AssessmentHistoryInput)
        : undefined;

    const props = {
      report: found.report,
      viewerRole: session.role,
      viewerName: session.fullName,
      // The manager reads this as one of the Final Reports they hold the register of; the
      // Officer reads it as the document attached to one item of their own work. Two readers,
      // two rail entries, and no third sidebar concept invented for the page itself.
      active: (officer ? "my-work" : "final-reports") as "my-work" | "final-reports",
      document: normalizeFinalDocument(row.payload),
      // Section 1's device rows and section 2's event rows, prefilled off the Orange Report's
      // own payload — the same call both assessment workspaces make, so the final F004 reads
      // the reporter's facts from exactly where every other rendering of this form reads them.
      device: prefillDeviceRows(found.report.payload, found.report),
      event: prefillEventRows(found.report.payload),
      approvedByName: row.approved_by_name,
      approvedOn: day(row.approved_at),
      workOfficerName: row.work_officer_name,
      // The manager may walk from the concluded document back to the Orange Report it was
      // assessed from — that page is theirs. An Officer may not: `/reports/:id` is the general
      // workflow, carrying every assessment and the manager's whole decision history, and this
      // page must not be the door into it. Their way back is their own work item.
      backHref: officer ? `/my-work/${found.report.id}` : `/reports/${found.report.id}`,
      backLabel: officer ? "← Back to my work" : "Open Orange Report",
      mode,
      history,
      canReadHistory: mayReadHistory(session.role),
    };

    return reply.html(
      presentation === "print" ? FinalDocumentPrintPage(props) : FinalDocumentPage(props),
    );
  }

  app.get("/reports/:id/final-document", (request, reply) =>
    serve(request, reply, "clean", "screen"),
  );

  app.get("/reports/:id/final-document/print", (request, reply) =>
    serve(request, reply, "clean", "print"),
  );

  app.get("/reports/:id/final-document/history", (request, reply) =>
    serve(request, reply, "history", "screen"),
  );

  app.get("/reports/:id/final-document/history/print", (request, reply) =>
    serve(request, reply, "history", "print"),
  );
}
