import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { F004_VERSION } from "../../../domain/f004.js";
import { resolveFinalDocument } from "../../../domain/final-document.js";
import { currentSession } from "../session-guard.js";
import { ForbiddenPage } from "../views/forbidden.js";
import { loadReport, renderReport } from "./reports.js";

const ReportId = z.uuid();
const UserId = z.uuid();

/**
 * The manager's two decisions on a report — the workflow's actual terminus, and the loop back
 * into it.
 *
 * `assign-next-assessor` fires from two different statuses that both mean the same thing to a
 * manager: "name the next secondary assessor" — the first time, right after A1, and every time
 * after, once a secondary review is in. `assign-work-officer` fires from the second of those
 * alone, once there is something submitted to be satisfied with.
 *
 * Both write one `report_decisions` row rather than anything on `assessments`: a decision is not
 * about any one assessment, including the one just read, and overloading `manager_comment` for it
 * would make a later decision look like it belongs to whichever assessor's row it landed on.
 */
export async function decisionRoutes(app: FastifyInstance): Promise<void> {
  const forbid = (reply: FastifyReply, role: string, code: 403 | 404 = 403) =>
    reply.status(code).html(ForbiddenPage({ role }));

  app.post("/reports/:id/assign-next-assessor", async (request, reply) => {
    const session = currentSession(request);

    const target = ReportId.safeParse((request.params as { id: string }).id);
    if (!target.success) return forbid(reply, session.role, 404);

    const found = await loadReport(app, target.data);
    if (found === null) return forbid(reply, session.role, 404);

    // The same two statuses the report page offers the form from. A POST that skips past that
    // page must be held to the same test, not merely to the role.
    if (
      found.report.status !== "awaiting_second_assessor" &&
      found.report.status !== "awaiting_decision"
    ) {
      return forbid(reply, session.role);
    }
    if (found.assessment1 === null) return forbid(reply, session.role);

    const body = (request.body ?? {}) as Record<string, unknown>;
    const posted = UserId.safeParse(body.assessor_id);
    if (!posted.success) return forbid(reply, session.role);

    const chosenId = posted.data;

    // Required once there is a prior secondary review the manager is responding to; optional for
    // the very first handoff, matching the UX this replaces (naming A2 has never asked for words).
    const rawComment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (found.report.status === "awaiting_decision" && rawComment === "") {
      return renderReport(
        app,
        request,
        reply,
        found.report.id,
        422,
        "Say why another assessment is needed before assigning it.",
      );
    }

    // Every ordinal this report has ever had — A1 and every secondary assessor, submitted or not.
    // Excluding all of them, not only A1, is the duplicate-assessor rule: nobody assesses the same
    // report twice.
    const held = await app.db.execute(sql`
      SELECT max(ordinal) AS max_ordinal FROM assessments WHERE report_id = ${found.report.id}
    `);
    const reviewedThroughOrdinal = (held[0] as { max_ordinal: number }).max_ordinal;
    const nextOrdinal = reviewedThroughOrdinal + 1;

    const candidate = await app.db.execute(sql`
      SELECT id FROM users
       WHERE id = ${chosenId}
         AND role = 'assessor'
         AND is_active
         AND id NOT IN (SELECT assessor_id FROM assessments WHERE report_id = ${found.report.id})
    `);
    if (candidate.length === 0) return forbid(reply, session.role);

    await app.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO assessments (report_id, assessor_id, ordinal, form_version, payload)
        VALUES (${found.report.id}, ${chosenId}, ${nextOrdinal}, ${F004_VERSION}, '{}'::jsonb)
      `);

      await tx.execute(sql`
        UPDATE reports SET status = 'second_assessment'
         WHERE id = ${found.report.id}
           AND status IN ('awaiting_second_assessor', 'awaiting_decision')
      `);

      await tx.execute(sql`
        INSERT INTO report_decisions (report_id, decided_by_user_id, kind, comment,
                                       reviewed_through_ordinal, next_assessor_user_id, next_ordinal)
        VALUES (${found.report.id}, ${session.userId}, 'assign_next_assessor',
                ${rawComment === "" ? null : rawComment}, ${reviewedThroughOrdinal}, ${chosenId},
                ${nextOrdinal})
      `);

      await tx.execute(sql`
        INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
        VALUES (${session.userId}, 'decision.assign_next_assessor', 'report', ${found.report.id},
                ${JSON.stringify({
                  number: found.report.number,
                  assessorUserId: chosenId,
                  ordinal: nextOrdinal,
                })}::jsonb)
      `);
    });

    request.log.info(
      { report: found.report.number, assessorUserId: chosenId, ordinal: nextOrdinal },
      "next assessor assigned",
    );

    return reply.redirect(`/reports/${found.report.id}`, 302);
  });

  app.post("/reports/:id/assign-work-officer", async (request, reply) => {
    const session = currentSession(request);

    const target = ReportId.safeParse((request.params as { id: string }).id);
    if (!target.success) return forbid(reply, session.role, 404);

    const found = await loadReport(app, target.data);
    if (found === null) return forbid(reply, session.role, 404);

    if (found.report.status !== "awaiting_decision") return forbid(reply, session.role);

    // Stated rather than inferred. `awaiting_decision` is only reachable through a submitted A1,
    // so this cannot fail today — but approving is what freezes the Final Document, and a snapshot
    // resolved from an absent first assessment would be an approved document of nothing.
    if (found.assessment1 === null) return forbid(reply, session.role);

    const body = (request.body ?? {}) as Record<string, unknown>;
    const posted = UserId.safeParse(body.officer_id);
    if (!posted.success) return forbid(reply, session.role);

    const chosenId = posted.data;
    const rawComment = typeof body.comment === "string" ? body.comment.trim() : "";

    // Unfiltered by design: carrying out the recommended work is not a conflict of interest with
    // having assessed the report, unlike naming the next secondary assessor.
    const candidate = await app.db.execute(sql`
      SELECT id FROM users WHERE id = ${chosenId} AND role = 'assessor' AND is_active
    `);
    if (candidate.length === 0) return forbid(reply, session.role);

    const held = await app.db.execute(sql`
      SELECT max(ordinal) AS max_ordinal FROM assessments WHERE report_id = ${found.report.id}
    `);
    const reviewedThroughOrdinal = (held[0] as { max_ordinal: number }).max_ordinal;

    // The Final Document, resolved before the transaction opens: it is a pure fold over rows
    // `loadReport` has already read, so computing it inside would only hold the write lock while
    // this thinks. Only submitted assessments are folded in — a draft is one Officer's unfinished
    // work and has never been a finding, which is the same test every other reader applies.
    const chain = found.secondaryAssessments
      .filter((a) => a.submitted)
      .map((a) => ({ ordinal: a.ordinal, review: a.answers }));

    const finalDocument = resolveFinalDocument(found.assessment1.answers, chain);

    await app.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE reports SET status = 'assigned_for_work'
         WHERE id = ${found.report.id} AND status = 'awaiting_decision'
      `);

      const [decision] = await tx.execute(sql`
        INSERT INTO report_decisions (report_id, decided_by_user_id, kind, comment,
                                       reviewed_through_ordinal, work_officer_user_id)
        VALUES (${found.report.id}, ${session.userId}, 'assign_work_officer',
                ${rawComment === "" ? null : rawComment}, ${reviewedThroughOrdinal}, ${chosenId})
        RETURNING id
      `);

      if (decision === undefined) throw new Error("Decision insert returned no row");

      // Inside the same transaction as the decision and the status change, and pointing at that
      // decision by id. A report that reached `assigned_for_work` without the document the manager
      // approved would be a report nobody can answer "approved what?" about, and the three facts
      // are one event — they stand or fall together.
      await tx.execute(sql`
        INSERT INTO report_final_documents (report_id, decision_id, approved_by_user_id,
                                            resolved_through_ordinal, form_version, payload)
        VALUES (${found.report.id}, ${(decision as { id: string }).id}, ${session.userId},
                ${reviewedThroughOrdinal}, ${F004_VERSION},
                ${JSON.stringify(finalDocument)}::jsonb)
      `);

      await tx.execute(sql`
        INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
        VALUES (${session.userId}, 'decision.assign_work_officer', 'report', ${found.report.id},
                ${JSON.stringify({
                  number: found.report.number,
                  workOfficerUserId: chosenId,
                  resolvedThroughOrdinal: reviewedThroughOrdinal,
                })}::jsonb)
      `);
    });

    request.log.info(
      { report: found.report.number, workOfficerUserId: chosenId },
      "work officer assigned",
    );

    return reply.redirect(`/reports/${found.report.id}`, 302);
  });
}
