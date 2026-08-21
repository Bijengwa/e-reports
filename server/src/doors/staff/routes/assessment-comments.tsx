import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { F004_SECTION_KEYS, FIRST_ASSESSMENT } from "../../../domain/f004.js";
import { currentSession } from "../session-guard.js";
import { ForbiddenPage } from "../views/forbidden.js";
import { loadReport, renderReport } from "./reports.js";

/** Same reason as every other report address: a uuid column against arbitrary text raises 22P02. */
const ReportId = z.uuid();

/**
 * Which part of the form the comment is about.
 *
 * Read from the document's own list rather than from a copy kept here, so a section the F004 does
 * not have cannot be commented on — the check the brief asks for, answered by the same constant
 * the form renders its anchors from.
 */
const Section = z.enum(F004_SECTION_KEYS);

/**
 * The comment itself. Trimmed before measuring, so a box of spaces is the empty comment it looks
 * like. Same ceiling as the overall review: a paragraph, not a place to paste a document.
 */
const Body = z.string().trim().min(1).max(4000);

const EMPTY = "Write a comment before sending it.";

/**
 * One manager comment on one section of a submitted first assessment.
 *
 * Beside `assessment-review`, not instead of it. That route stores the manager's one verdict on
 * the whole assessment; this stores their notes against its parts, and a review normally has both.
 *
 * Manager-only by scope, then held to the row on the same three tests the manager's own read of
 * the assessment makes: the report exists, ordinal 1 exists, and it is actually submitted. A draft
 * in progress is the first assessor's unfinished work and there is nothing yet to comment on.
 *
 * The report is named by the address and the assessment is looked up from it by ordinal, so there
 * is no assessment id in the body at all: a comment cannot be pointed at another report's
 * assessment by editing what was posted, and it cannot land on ordinal 2 by any route through
 * here. That lookup repeats `submitted_at IS NOT NULL` because reading the row and writing the
 * comment are two statements, and this is the one the database evaluates.
 */
export async function assessmentCommentRoutes(app: FastifyInstance): Promise<void> {
  /** Refused, and told so on a page that still carries the reader's own rail. */
  const forbid = (reply: FastifyReply, role: string, code: 403 | 404 = 403) =>
    reply.status(code).html(ForbiddenPage({ role }));

  app.post("/reports/:id/assessment-1/sections/:section/comments", async (request, reply) => {
    const session = currentSession(request);
    const params = request.params as { id: string; section: string };

    const target = ReportId.safeParse(params.id);
    if (!target.success) return forbid(reply, session.role, 404);

    // A section the form does not have is not a page that is missing, it is an address that was
    // never valid. 403 rather than 404, on the same reading the other refusals here take.
    const section = Section.safeParse(params.section);
    if (!section.success) return forbid(reply, session.role);

    const found = await loadReport(app, target.data);
    if (found === null) return forbid(reply, session.role, 404);

    // Nothing to comment on yet. 403 rather than 404: the report is real and the manager sees it.
    if (found.assessment1 === null) return forbid(reply, session.role);

    const body = (request.body ?? {}) as Record<string, unknown>;
    const posted = Body.safeParse(typeof body.body === "string" ? body.body : "");

    // 422, not 403. The manager may write this; this attempt just said nothing. Re-rendered on the
    // report itself so the assessment they were reading is still in front of them.
    if (!posted.success) {
      return renderReport(app, request, reply, found.report.id, 422, EMPTY);
    }

    // The assessment named by the address, and only while it is still a submitted first
    // assessment. Looked up rather than posted, so the body carries nothing that selects a row.
    const assessment = await app.db.execute(sql`
      SELECT id FROM assessments
       WHERE report_id = ${found.report.id}
         AND ordinal = ${FIRST_ASSESSMENT}
         AND submitted_at IS NOT NULL
    `);
    if (assessment.length === 0) return forbid(reply, session.role);

    const assessmentId = (assessment[0] as { id: string }).id;

    await app.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO assessment_comments (assessment_id, section, author_user_id, body)
        VALUES (${assessmentId}, ${section.data}, ${session.userId}, ${posted.data})
      `);

      // The trail records that a section was commented on and which one, not the words. The text
      // is on the assessment for anyone entitled to read the assessment; repeating it here would
      // put the same sentence in a second place with a different lifetime.
      await tx.execute(sql`
        INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
        VALUES (${session.userId}, 'assessment.section_commented', 'report', ${found.report.id},
                ${JSON.stringify({
                  number: found.report.number,
                  ordinal: FIRST_ASSESSMENT,
                  section: section.data,
                })}::jsonb)
      `);
    });

    request.log.info(
      { report: found.report.number, ordinal: FIRST_ASSESSMENT, section: section.data },
      "assessment section commented",
    );

    // Post/redirect/get, as the other writing routes in this door do, and back to the section that
    // was commented on rather than to the top of a long document.
    return reply.redirect(`/reports/${found.report.id}#section-${section.data}`, 302);
  });
}
