import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { FIRST_ASSESSMENT } from "../../../../domain/f004.js";
import { currentSession } from "../../session-guard.js";
import { ForbiddenPage } from "../../shared/forbidden.js";
import { loadReport, renderReport } from "../../reports/routes/reports.js";

/** Same reason as every other report address: a uuid column against arbitrary text raises 22P02. */
const ReportId = z.uuid();

/**
 * The comment itself.
 *
 * Trimmed before the length is measured, so a box of spaces is the empty comment it looks like.
 * The ceiling is generous enough for a real review and low enough that a text column does not
 * become somewhere to paste a document — an attachment is a different feature with a different
 * store, and this is a paragraph a second assessor reads before starting.
 */
const Comment = z.string().trim().min(1).max(4000);

const EMPTY = "Write a comment before saving the review.";

/**
 * The manager's review of a submitted first assessment.
 *
 * Manager-only by scope, and then held to the row: being a manager is permission to review an
 * assessment, not permission to review this one before it exists. `loadReport` returns
 * `assessment1` only once ordinal 1 is actually submitted, which is the same test the manager's
 * own read of it on `/reports/:id` makes — a draft in progress is the first assessor's unfinished
 * work and there is nothing yet to agree or differ with.
 *
 * The report is named by the address and the assessment by its ordinal, both in the UPDATE's own
 * WHERE clause. There is no id in the body at all, so a comment cannot be pointed at another
 * report by editing what was posted, and it cannot land on ordinal 2 by any route through here.
 *
 * Writing over an earlier review is allowed and is not silent: the trail carries what was there
 * before beside what replaced it, which is what makes a changed finding readable afterwards
 * rather than merely current.
 */
export async function assessmentReviewRoutes(app: FastifyInstance): Promise<void> {
  /** Refused, and told so on a page that still carries the reader's own rail. */
  const forbid = (reply: FastifyReply, role: string, code: 403 | 404 = 403) =>
    reply.status(code).html(ForbiddenPage({ role }));

  app.post("/reports/:id/assessment-1/comment", async (request, reply) => {
    const session = currentSession(request);

    const target = ReportId.safeParse((request.params as { id: string }).id);
    if (!target.success) return forbid(reply, session.role, 404);

    const found = await loadReport(app, target.data);
    if (found === null) return forbid(reply, session.role, 404);

    // Nothing to review yet. 403 rather than 404: the report is real and the manager can see it.
    if (found.assessment1 === null) return forbid(reply, session.role);

    // The same test the report page makes before it draws the box, made again here.
    //
    // The page hiding a control is a courtesy to the reader; this is the rule. A manager who left
    // the report open in a tab, decided on it in another, and then saved the stale form would
    // otherwise rewrite a review the next assessor has already read and acted on — the one case
    // where "the UI does not offer it" is no protection at all. Same discipline as
    // `assign-next-assessor`, which re-checks the status a POST claims to be acting from.
    if (found.report.status !== "awaiting_second_assessor") return forbid(reply, session.role);

    const body = (request.body ?? {}) as Record<string, unknown>;
    const posted = Comment.safeParse(typeof body.comment === "string" ? body.comment : "");

    // 422, not 403. The manager may write this review; this attempt just said nothing. Re-rendered
    // on the report itself so the assessment they were reading is still in front of them.
    if (!posted.success) {
      return renderReport(app, request, reply, found.report.id, 422, EMPTY);
    }

    const text = posted.data;
    const previous = found.assessment1.managerComment;

    await app.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE assessments
           SET manager_comment = ${text},
               manager_comment_by = ${session.userId},
               manager_comment_at = now()
         WHERE report_id = ${found.report.id}
           AND ordinal = ${FIRST_ASSESSMENT}
           -- The same gate a third time, and the only one that is not racing: a submission cannot
           -- be withdrawn, but reading the row and writing it are two statements, and this is the
           -- one the database evaluates.
           AND submitted_at IS NOT NULL
      `);

      // Neither the text nor the trail carries anything about the reporter or the patient — this
      // is the manager's own words about an assessment, and the row it belongs to is named by id.
      await tx.execute(sql`
        INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, before, after)
        VALUES (
          ${session.userId}, 'assessment.commented', 'report', ${found.report.id},
          ${previous === null ? null : JSON.stringify({ comment: previous.text })}::jsonb,
          ${JSON.stringify({
            number: found.report.number,
            ordinal: FIRST_ASSESSMENT,
            comment: text,
          })}::jsonb
        )
      `);
    });

    request.log.info(
      { report: found.report.number, ordinal: FIRST_ASSESSMENT },
      "manager review saved",
    );

    // Post/redirect/get, as the other writing routes in this door do: the review is on the report
    // page and a refresh must not offer to save it again.
    return reply.redirect(`/reports/${found.report.id}`, 302);
  });
}







