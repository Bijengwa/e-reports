import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { computeDueAt, DEFAULT_DEADLINE } from "../../../domain/assignment.js";
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

    const now = new Date();
    const dueAt = computeDueAt(now, DEFAULT_DEADLINE.value, DEFAULT_DEADLINE.unit);
    // Postgres.js's raw parameter binding accepts a string or a Buffer, not a bare `Date` — every
    // timestamp interpolated into a template below is its ISO form for that reason alone.
    const nowIso = now.toISOString();
    const dueAtIso = dueAt.toISOString();

    await app.db.transaction(async (tx) => {
      // The same generic assignment shape `assign-first-assessor` writes for A1, so a deadline
      // exists on every ordinal from the moment it is handed out rather than only the first. No
      // form on this page asks the Manager to choose one yet, so every secondary assessment gets
      // the same default until it does — a real deadline, not an absent one.
      await tx.execute(sql`
        INSERT INTO assessments (report_id, assessor_id, ordinal, form_version, payload,
                                 assigned_by_user_id, assigned_at, deadline_value, deadline_unit,
                                 due_at)
        VALUES (${found.report.id}, ${chosenId}, ${nextOrdinal}, ${F004_VERSION}, '{}'::jsonb,
                ${session.userId}, ${nowIso}, ${DEFAULT_DEADLINE.value}, ${DEFAULT_DEADLINE.unit},
                ${dueAtIso})
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

    /*
     * A first assessment is never approved on its own.
     *
     * The office's rule is that A1 is always read by a second assessor before anything is decided,
     * so the shortest legitimate path is A1 → assign A2 → A2 submits → approve. There is no
     * A1 → approve, and this is where that is enforced rather than left to the status.
     *
     * Counted off the assessment rows, not off `ordinal = 2` and not off the status. The status
     * says where the report is; the rows say what has actually been submitted, and the rule is
     * about the work. Any submitted secondary satisfies it, at whatever ordinal the chain reached
     * — a report resolved through A4 is as approvable as one resolved through A2.
     *
     * The second half refuses while a secondary assessment is still open. `assign-next-assessor`
     * moves the report to `second_assessment` and the status test above already covers today's
     * path, but an assessment nobody has finished is not a finding, and approving over one would
     * freeze a Final F004 that omits work already commissioned.
     */
    const submittedSecondary = found.secondaryAssessments.filter((a) => a.submitted).length;
    const openSecondary = found.secondaryAssessments.some((a) => !a.submitted);
    if (submittedSecondary < 1 || openSecondary) return forbid(reply, session.role);

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
