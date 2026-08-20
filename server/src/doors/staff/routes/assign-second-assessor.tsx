import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { currentSession } from "../session-guard.js";
import { ForbiddenPage } from "../views/forbidden.js";
import { loadReport } from "./reports.js";

/** Same reason as every other report address: a uuid column against arbitrary text raises 22P02. */
const ReportId = z.uuid();
const AssessorId = z.uuid();

/**
 * Naming a second assessor for a report that is waiting for one.
 *
 * Manager-only by scope, and re-checked here against the row: the picker on `/reports/:id` was
 * drawn from exactly `status === 'awaiting_second_assessor' && assessment1 !== null`, and a POST
 * that skips straight past that page must be held to the same test, not merely to the role. The
 * candidate is re-checked the same way — `role = 'assessor' AND is_active` is the one query that
 * built the picker's own options, so this asks it again rather than trusting a body that only
 * claims to have come from that list.
 *
 * A single UPDATE, guarded a second time in its own WHERE clause on the same status and
 * `assessor2_user_id IS NULL` the pre-checks already read — the same defence `assessment-1`'s save
 * puts on its own status write, against the same race: two requests reading the row as still open
 * before either has written to it.
 */
export async function assignSecondAssessorRoutes(app: FastifyInstance): Promise<void> {
  /** Refused, and told so on a page that still carries the reader's own rail. */
  const forbid = (reply: FastifyReply, role: string, code: 403 | 404 = 403) =>
    reply.status(code).html(ForbiddenPage({ role }));

  app.post("/reports/:id/assign-assessor-2", async (request, reply) => {
    const session = currentSession(request);

    const target = ReportId.safeParse((request.params as { id: string }).id);
    if (!target.success) return forbid(reply, session.role, 404);

    const found = await loadReport(app, target.data);
    if (found === null) return forbid(reply, session.role, 404);

    // Exactly the picker's own gate: a report not waiting, or waiting on a first assessment that
    // is not actually submitted yet, offers nothing to post to.
    if (found.report.status !== "awaiting_second_assessor") return forbid(reply, session.role);
    if (found.assessment1 === null) return forbid(reply, session.role);
    if (found.assessor2UserId !== null) return forbid(reply, session.role);

    const body = (request.body ?? {}) as Record<string, unknown>;
    const posted = AssessorId.safeParse(body.assessor_id);
    if (!posted.success) return forbid(reply, session.role);

    const chosenId = posted.data;

    // Neither the first assessor nor the manager posting this may be named the second. The first
    // check is a business rule -- one report, two different Officers; the second is defensive,
    // since a manager's own id could never pass the role check below regardless.
    if (chosenId === found.assessor1UserId) return forbid(reply, session.role);
    if (chosenId === session.userId) return forbid(reply, session.role);

    // The same predicate the picker's own options came from. A chosen id that fails it is either
    // not a real user, not an Officer, or not active -- three different mistakes, one guard, and
    // the one that keeps this route's idea of "eligible" from ever drifting from the page's.
    const candidate = await app.db.execute(sql`
      SELECT id, full_name FROM users WHERE id = ${chosenId} AND role = 'assessor' AND is_active
    `);
    if (candidate.length === 0) return forbid(reply, session.role);

    await app.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE reports
           SET assessor2_user_id = ${chosenId},
               assessor2_assigned_at = now(),
               status = 'second_assessment'
         WHERE id = ${found.report.id}
           AND status = 'awaiting_second_assessor'
           AND assessor2_user_id IS NULL
      `);

      await tx.execute(sql`
        INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
        VALUES (${session.userId}, 'assessor2.assigned', 'report', ${found.report.id},
                ${JSON.stringify({
                  number: found.report.number,
                  assessor1UserId: found.assessor1UserId,
                  assessor2UserId: chosenId,
                })}::jsonb)
      `);
    });

    request.log.info(
      { report: found.report.number, assessor2UserId: chosenId },
      "second assessor assigned",
    );

    return reply.redirect(`/reports/${found.report.id}`, 302);
  });
}
