import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  computeDueAt,
  DEADLINE_UNITS,
  DEFAULT_DEADLINE,
  isDeadlineUnit,
  isDeadlineValue,
} from "../../../../domain/assignment.js";
import { F004_VERSION, FIRST_ASSESSMENT } from "../../../../domain/f004.js";
import { currentSession } from "../../session-guard.js";
import { ForbiddenPage } from "../../shared/forbidden.js";
import { loadReport, renderReport } from "../../reports/routes/reports.js";

const ReportId = z.uuid();
const UserId = z.uuid();

/**
 * The Manager's manual hand-off of Assessment 1.
 *
 * The gap `storeReport` leaves on purpose: a newly filed report now arrives with no Officer and no
 * deadline, and this is the only route that may give it either. It writes the same shape a later
 * ordinal's own assignment will — `assigned_by_user_id`, `assigned_at`, `deadline_value`,
 * `deadline_unit`, `due_at`, all on the `assessments` row itself — rather than a fifth report-level
 * column that would describe A1 alone and nothing after it.
 */
export async function firstAssessorRoutes(app: FastifyInstance): Promise<void> {
  const forbid = (reply: FastifyReply, role: string, code: 403 | 404 = 403) =>
    reply.status(code).html(ForbiddenPage({ role }));

  app.post("/reports/:id/assign-first-assessor", async (request, reply) => {
    const session = currentSession(request);

    const target = ReportId.safeParse((request.params as { id: string }).id);
    if (!target.success) return forbid(reply, session.role, 404);

    const found = await loadReport(app, target.data);
    if (found === null) return forbid(reply, session.role, 404);

    // The only state this route may act on: nobody has been named yet, and nothing has started.
    // A report already under assessment has its own next-assessor route on `decisions.tsx`; this
    // one closes the moment either fact stops being true, whichever goes first.
    if (found.report.status !== "received" || found.assessor1UserId !== null) {
      return forbid(reply, session.role);
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const posted = UserId.safeParse(body.assessor_id);
    if (!posted.success) return forbid(reply, session.role);

    const chosenId = posted.data;

    const rawValue = typeof body.deadline_value === "string" ? body.deadline_value.trim() : "";
    const rawUnit = typeof body.deadline_unit === "string" ? body.deadline_unit.trim() : "";

    const deadlineValue = rawValue === "" ? DEFAULT_DEADLINE.value : Number(rawValue);
    const deadlineUnit = rawUnit === "" ? DEFAULT_DEADLINE.unit : rawUnit;

    if (!isDeadlineValue(deadlineValue)) {
      return renderReport(
        app,
        request,
        reply,
        found.report.id,
        422,
        "The deadline must be a whole number of at least one.",
      );
    }
    if (!isDeadlineUnit(deadlineUnit)) {
      return renderReport(
        app,
        request,
        reply,
        found.report.id,
        422,
        `The deadline unit must be one of: ${DEADLINE_UNITS.join(", ")}.`,
      );
    }

    // Active and an Officer — the same test every other assignment route in this door makes.
    const candidate = await app.db.execute(sql`
      SELECT id FROM users WHERE id = ${chosenId} AND role = 'assessor' AND is_active
    `);
    if (candidate.length === 0) return forbid(reply, session.role);

    const now = new Date();
    const dueAt = computeDueAt(now, deadlineValue, deadlineUnit);
    // Postgres.js's raw parameter binding accepts a string or a Buffer, not a bare `Date` — every
    // timestamp interpolated into a template below is its ISO form for that reason alone.
    const nowIso = now.toISOString();
    const dueAtIso = dueAt.toISOString();

    await app.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE reports SET assessor1_user_id = ${chosenId}, assessor1_assigned_at = ${nowIso}
         WHERE id = ${found.report.id} AND status = 'received' AND assessor1_user_id IS NULL
      `);

      // The generic shape, from the moment of assignment rather than the moment the Officer first
      // opens it. Assessment 1's own save upserts on (report_id, ordinal) and will find this row
      // waiting, touching only `payload`/`conclusion`/`form_version`/`submitted_at` — the five
      // columns this insert sets are never in that later statement's SET list.
      await tx.execute(sql`
        INSERT INTO assessments (report_id, assessor_id, ordinal, form_version, payload,
                                 assigned_by_user_id, assigned_at, deadline_value, deadline_unit,
                                 due_at)
        VALUES (${found.report.id}, ${chosenId}, ${FIRST_ASSESSMENT}, ${F004_VERSION}, '{}'::jsonb,
                ${session.userId}, ${nowIso}, ${deadlineValue}, ${deadlineUnit}, ${dueAtIso})
      `);

      await tx.execute(sql`
        INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
        VALUES (${session.userId}, 'report.assign_first_assessor', 'report', ${found.report.id},
                ${JSON.stringify({
                  number: found.report.number,
                  assessorUserId: chosenId,
                  deadlineValue,
                  deadlineUnit,
                  dueAt: dueAtIso,
                })}::jsonb)
      `);
    });

    request.log.info(
      { report: found.report.number, assessorUserId: chosenId, dueAt: dueAtIso },
      "first assessor assigned",
    );

    return reply.redirect(`/reports/${found.report.id}`, 302);
  });
}







