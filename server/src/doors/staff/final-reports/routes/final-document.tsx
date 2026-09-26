import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prefillDeviceRows, prefillEventRows } from "../../../../domain/f004.js";
import {
  type FinalDocument,
  isConcludedFinalDocument,
  normalizeFinalDocument,
} from "../../../../domain/final-document.js";
import type { ReportDetail, SecondaryAssignment } from "../../../../domain/report-detail.js";
import { loadReport } from "../../../../domain/report-detail.js";
import { sanitizeFilename } from "../../../../storage/index.js";
import { currentSession } from "../../session-guard.js";
import type { PriorSecondaryReview } from "../../shared/components/f004.js";
import { refuse } from "../../shared/forbidden.js";
import {
  FinalDocumentPage,
  FinalDocumentPrintPage,
  type FinalDocumentType,
} from "../pages/final-document.js";

/** Same reason as every other report address: a uuid column against arbitrary text raises 22P02. */
const ReportId = z.uuid();

/** `?type=` on either route — anything else (including absent) reads as "clean". */
const TypeParam = z.enum(["clean", "history"]).catch("clean");

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
 * The Final Document of one report, as it was approved.
 *
 * Read from the snapshot and never re-resolved. That is the whole point of the table: this page
 * shows what the manager approved on the day they approved it, not what the current assessment
 * rows would resolve to if asked again today.
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
 * The id in the address is never trusted. It selects a row; the row decides the answer. There is
 * no branch here that renders first and checks afterwards.
 *
 * 404 rather than 403 for a report that has no final document, and the same for an A1-only legacy
 * snapshot — see `isConcludedFinalDocument`. There is nothing being withheld in either case: a
 * concluded document does not exist until a manager approves one over a second assessment, and
 * saying so is the honest answer.
 */
/** What both routes below need, once the row has been loaded and the reader cleared to see it. */
type ResolvedFinalDocument = {
  report: ReportDetail;
  document: FinalDocument;
  device: Record<string, string>;
  event: Record<string, string>;
  approvedByName: string;
  approvedOn: string;
  workOfficerName: string | null;
  /** Whether this reader is the assigned Officer rather than the manager — decides the rail entry
   *  and the way back on the screen route, and nothing on the download route. */
  officer: boolean;
  role: string;
  fullName: string;
  /** Every submitted secondary assessment in the chain — the "Assessment History" type's raw
   *  material. Read once here rather than a second time per route. */
  secondaryAssessments: readonly SecondaryAssignment[];
};

/**
 * The authorization and the data-loading, shared by the screen and the download.
 *
 * Everything the module doc comment above says about who may read a final document is enforced
 * here, once, on the one row this function loads — see that comment for the rule in full. A caller
 * gets a value back only once every check has passed; the moment access is refused, this replies
 * with the 403/404 itself and returns `null`, so neither route can go on to render past that point.
 */
async function resolveFinalDocument(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<ResolvedFinalDocument | null> {
  const session = currentSession(request);
  const forbid = (code: 403 | 404 = 403): null => {
    refuse(reply, session.role, code);
    return null;
  };

  // Neither a manager nor an Officer has any business here, and there is no report-shaped
  // question to ask on their behalf. Refused before a single row is read.
  if (session.role !== "manager" && session.role !== "assessor") {
    return forbid();
  }

  const target = ReportId.safeParse((request.params as { id: string }).id);
  if (!target.success) return forbid(404);

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
      LEFT JOIN users wo ON wo.id = d.work_officer_user_id
     WHERE f.report_id = ${target.data}
  `);

  if (rows.length === 0) return forbid(404);

  const row = rows[0] as Row;

  // The authorization, on the row that was actually loaded, and ahead of everything else this
  // function might say about the document. A reader who may not have it is told nothing about it —
  // not whether it is concluded, and not whether it is a repairable legacy row.
  const officer = session.role === "assessor";
  if (officer && row.work_officer_user_id !== session.userId) {
    return forbid();
  }

  // An A1-only snapshot is history, not a concluded document. It stays in the table untouched and
  // is not served as a Final F004 to anybody, the manager included — offering one would be
  // presenting an unreviewed first assessment as the office's settled position.
  if (!isConcludedFinalDocument(row.resolved_through_ordinal)) {
    return forbid(404);
  }

  const found = await loadReport(app, target.data);
  if (found === null) return forbid(404);

  return {
    report: found.report,
    document: normalizeFinalDocument(row.payload),
    // Section 1's device rows and section 2's event rows, prefilled off the Orange Report's own
    // payload — the same call both assessment workspaces make, so the final F004 reads the
    // reporter's facts from exactly where every other rendering of this form reads them.
    device: prefillDeviceRows(found.report.payload, found.report),
    event: prefillEventRows(found.report.payload),
    approvedByName: row.approved_by_name,
    approvedOn: day(row.approved_at),
    workOfficerName: row.work_officer_name,
    officer,
    role: session.role,
    fullName: session.fullName,
    secondaryAssessments: found.secondaryAssessments,
  };
}

/**
 * Every submitted secondary assessment in the chain, in the shape `A2InlineDecision`'s per-item
 * history already knows how to read — the same builder `routes/assessment.tsx` uses for its own
 * `priorReviews`, with nobody excluded: the working page leaves out the reader's own still-open
 * row, but nobody is "reviewing" a concluded Final F004, so every submitted entry belongs here.
 *
 * `[]` for "clean" — see `FinalDocumentPage`'s module doc comment for what that empty list buys.
 */
function priorReviewsFor(
  type: FinalDocumentType,
  secondaryAssessments: readonly SecondaryAssignment[],
): PriorSecondaryReview[] {
  if (type === "clean") return [];

  return secondaryAssessments
    .filter((a) => a.submitted)
    .map((a) => ({
      ordinal: a.ordinal,
      assessorName: a.assessorName,
      submittedOn: a.submittedOn ?? "",
      review: a.answers,
    }));
}

export async function finalDocumentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/reports/:id/final-document", async (request, reply) => {
    const resolved = await resolveFinalDocument(app, request, reply);
    if (resolved === null) return; // 403/404 already sent by resolveFinalDocument.

    // "Assessment History" names every secondary assessor and shows their individual positions —
    // exactly what `MyWorkItemPage` (`doors/staff/my-work/pages/my-work.tsx`) deliberately keeps
    // from an Officer carrying out the work: they are handed the office's settled position, not
    // the internal argument that produced it. The manager, who already reads the full decision
    // history on the report page, has no such restriction. An Officer's `?type=history` is refused
    // the same way a stale link to a page they've lost access to would be — silently read as
    // "clean" — rather than answering with an error over a query string nobody but a curious
    // Officer would ever type by hand.
    const canViewHistory = !resolved.officer;
    const type = canViewHistory
      ? TypeParam.parse((request.query as { type?: string }).type)
      : "clean";
    const base = `/reports/${resolved.report.id}/final-document`;

    return reply.html(
      <FinalDocumentPage
        report={resolved.report}
        viewerRole={resolved.role}
        viewerName={resolved.fullName}
        // The manager reads this as one of the Final Reports they hold the register of; the
        // Officer reads it as the document attached to one item of their own work. Two readers,
        // two rail entries, and no third sidebar concept invented for the page itself.
        active={resolved.officer ? "my-work" : "final-reports"}
        document={resolved.document}
        device={resolved.device}
        event={resolved.event}
        approvedByName={resolved.approvedByName}
        approvedOn={resolved.approvedOn}
        workOfficerName={resolved.workOfficerName}
        // Back goes to where this reader actually came FROM to open the document, not to the
        // Orange Report's own case-detail page (`/reports/:id`, under the register). A manager
        // opens a Final F004 from the Final Reports register they hold; an Officer opens it from
        // My Work. Neither reader arrived here by way of Register, so neither goes back to it.
        backHref={resolved.officer ? "/my-work" : "/final-reports"}
        backLabel={resolved.officer ? "Back to My Work" : "Back to Final Reports"}
        type={type}
        typeHrefs={canViewHistory ? { clean: base, history: `${base}?type=history` } : null}
        downloadHref={`${base}/download${type === "history" ? "?type=history" : ""}`}
        priorReviews={priorReviewsFor(type, resolved.secondaryAssessments)}
      />,
    );
  });

  /**
   * The same approved document, as a real PDF attachment.
   *
   * Same resolver, same row, same authorization as the screen above — `resolveFinalDocument` is
   * the one place either route asks "may this reader see this document", so the two can never
   * disagree. What differs is only what wraps the answers: `FinalDocumentPrintPage` renders to
   * plain HTML (no rail, no title bar, no toolbar), which `app.pdf.render` turns into a PDF the
   * response sends back as `Content-Disposition: attachment` — a file the browser downloads,
   * never a second page it navigates to. See `../../../../pdf/index.js`.
   */
  app.get("/reports/:id/final-document/download", async (request, reply) => {
    const resolved = await resolveFinalDocument(app, request, reply);
    if (resolved === null) return; // 403/404 already sent by resolveFinalDocument.

    // Same restriction as the screen route, and for the same reason — see its own comment. An
    // Officer's download is always the clean document, whatever `?type=` says.
    const type = resolved.officer
      ? "clean"
      : TypeParam.parse((request.query as { type?: string }).type);

    const rendered = (
      <FinalDocumentPrintPage
        report={resolved.report}
        document={resolved.document}
        device={resolved.device}
        event={resolved.event}
        approvedByName={resolved.approvedByName}
        approvedOn={resolved.approvedOn}
        workOfficerName={resolved.workOfficerName}
        type={type}
        priorReviews={priorReviewsFor(type, resolved.secondaryAssessments)}
      />
    );
    const html = typeof rendered === "string" ? rendered : await rendered;

    const pdf = await app.pdf.render(html);
    const suffix = type === "history" ? "-history" : "";
    const filename = `Final-F004-${sanitizeFilename(resolved.report.number)}${suffix}.pdf`;

    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(pdf);
  });
}
