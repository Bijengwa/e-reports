import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  collect,
  collectSecondaryReview,
  F004_VERSION,
  type F004Answers,
  FIRST_ASSESSMENT,
  type Issue,
  normalizeSecondaryReview,
  prefillDeviceRows,
  prefillEventRows,
  validateForSubmit,
  validateSecondaryReviewForSubmit,
  value,
} from "../../../domain/f004.js";
import { currentSession } from "../session-guard.js";
import { Assessment1Page } from "../views/assessment.js";
import { ForbiddenPage } from "../views/forbidden.js";
import { SecondaryAssessmentPage } from "../views/secondary-assessment.js";
import { loadReport } from "./reports.js";

/** Same reason as the register's: a uuid column compared against arbitrary text raises 22P02. */
const ReportId = z.uuid();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The body as name → value(s), which is what `collect` filters down to the form's own fields. */
function fields(request: FastifyRequest): Record<string, string | string[]> {
  const body = (request.body ?? {}) as Record<string, unknown>;
  const out: Record<string, string | string[]> = {};

  for (const [name, raw] of Object.entries(body)) {
    if (typeof raw === "string") out[name] = raw;
    else if (Array.isArray(raw)) out[name] = raw.filter((v): v is string => typeof v === "string");
  }

  return out;
}

type Draft = { answers: F004Answers; submitted: boolean; submittedOn: string | null };

/** The assessor's own draft, or an empty one. Only ordinal 1 is ever read or written here. */
async function loadDraft(app: FastifyInstance, reportId: string): Promise<Draft> {
  const rows = await app.db.execute(sql`
    SELECT payload, submitted_at
      FROM assessments
     WHERE report_id = ${reportId} AND ordinal = ${FIRST_ASSESSMENT}
  `);

  if (rows.length === 0) return { answers: {}, submitted: false, submittedOn: null };

  const row = rows[0] as { payload: unknown; submitted_at: Date | null };

  return {
    answers: (row.payload ?? {}) as F004Answers,
    submitted: row.submitted_at !== null,
    submittedOn:
      row.submitted_at === null ? null : new Date(row.submitted_at).toISOString().slice(0, 10),
  };
}

export async function assessmentRoutes(app: FastifyInstance): Promise<void> {
  /** Refused, and told so on a page that still carries the reader's own rail. */
  const forbid = (reply: FastifyReply, role: string, code: 403 | 404 = 403) =>
    reply.status(code).html(ForbiddenPage({ role }));

  app.get("/reports/:id/assessment-1", async (request, reply) => {
    const session = currentSession(request);

    const target = ReportId.safeParse((request.params as { id: string }).id);
    if (!target.success) return forbid(reply, session.role, 404);

    const found = await loadReport(app, target.data);
    if (found === null) return forbid(reply, session.role, 404);
    if (found.assessor1UserId !== session.userId) return forbid(reply, session.role);

    const draft = await loadDraft(app, found.report.id);

    return reply.html(
      <Assessment1Page
        report={found.report}
        viewerRole={session.role}
        viewerName={session.fullName}
        answers={draft.answers}
        device={prefillDeviceRows(found.report.payload, found.report)}
        event={prefillEventRows(found.report.payload)}
        assessedOn={draft.submittedOn ?? today()}
        submitted={draft.submitted}
        issues={[]}
      />,
    );
  });

  app.post("/reports/:id/assessment-1", async (request, reply) => {
    const session = currentSession(request);

    const target = ReportId.safeParse((request.params as { id: string }).id);
    if (!target.success) return forbid(reply, session.role, 404);

    const found = await loadReport(app, target.data);
    if (found === null) return forbid(reply, session.role, 404);
    if (found.assessor1UserId !== session.userId) return forbid(reply, session.role);

    const existing = await loadDraft(app, found.report.id);

    if (existing.submitted) return forbid(reply, session.role);

    const posted = fields(request);
    const answers = collect(posted);
    const submitting = value(posted, "intent") === "submit";

    const issues: Issue[] = submitting ? validateForSubmit(answers, session.fullName) : [];

    const page = (status: 200 | 422, shown: readonly Issue[]) =>
      reply
        .status(status)
        .html(
          <Assessment1Page
            report={found.report}
            viewerRole={session.role}
            viewerName={session.fullName}
            answers={answers}
            device={prefillDeviceRows(found.report.payload, found.report)}
            event={prefillEventRows(found.report.payload)}
            assessedOn={today()}
            submitted={false}
            issues={shown}
          />,
        );

    if (issues.length > 0) return page(422, issues);

    const conclusion = value(answers, "conclusion").trim();
    const assessorId = found.assessor1UserId;

    await app.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO assessments (report_id, assessor_id, ordinal, form_version, payload,
                                 conclusion, submitted_at)
        VALUES (${found.report.id}, ${assessorId}, ${FIRST_ASSESSMENT}, ${F004_VERSION},
                ${JSON.stringify(answers)}::jsonb, ${conclusion === "" ? null : conclusion},
                ${submitting ? sql`now()` : sql`NULL`})
        ON CONFLICT (report_id, ordinal) DO UPDATE
           SET payload      = EXCLUDED.payload,
               conclusion   = EXCLUDED.conclusion,
               form_version = EXCLUDED.form_version,
               submitted_at = COALESCE(assessments.submitted_at, EXCLUDED.submitted_at)
      `);

      if (submitting) {
        await tx.execute(sql`
          UPDATE reports SET status = 'awaiting_second_assessor' WHERE id = ${found.report.id}
        `);

        await tx.execute(sql`
          INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
          VALUES (${session.userId}, 'assessment.submitted', 'report', ${found.report.id},
                  ${JSON.stringify({ number: found.report.number, ordinal: FIRST_ASSESSMENT })}::jsonb)
        `);
      } else {
        await tx.execute(sql`
          UPDATE reports SET status = 'first_assessment'
           WHERE id = ${found.report.id} AND status = 'received'
        `);
      }
    });

    request.log.info(
      { report: found.report.number, ordinal: FIRST_ASSESSMENT, submitted: submitting },
      "assessment saved",
    );

    return reply.redirect(
      submitting ? `/reports/${found.report.id}` : `/reports/${found.report.id}/assessment-1`,
      302,
    );
  });

  /**
   * The secondary assessment belonging to the signed-in Officer — whichever ordinal it is.
   *
   * One stable address for the whole A2..An chain, unlike `/assessment-1`: the Officer does not
   * pick their own ordinal and does not need to know it to find their way in. What names their row
   * is `assessments.assessor_id = session.userId AND ordinal > 1`, which the duplicate-assessor
   * rule in `assign-next-assessor` guarantees is at most one row per report, ever.
   *
   * The legacy fallback exists for exactly one case: a report assigned a second assessor before
   * this generalization existed, where the manager wrote `reports.assessor2_user_id` directly and
   * no `assessments` row was created eagerly — the row only appears once that Officer's first
   * draft is saved, the same lazy-creation behaviour this route always had at ordinal 2.
   */
  const resolveMine = async (request: FastifyRequest, reply: FastifyReply) => {
    const session = currentSession(request);

    const target = ReportId.safeParse((request.params as { id: string }).id);
    if (!target.success) return { refused: forbid(reply, session.role, 404) } as const;

    const found = await loadReport(app, target.data);
    if (found === null) return { refused: forbid(reply, session.role, 404) } as const;
    if (found.assessment1 === null) return { refused: forbid(reply, session.role) } as const;

    const mine = found.secondaryAssessments.find((a) => a.assessorId === session.userId);

    const ordinal =
      mine?.ordinal ??
      (found.legacyAssessor2UserId === session.userId && found.report.status === "second_assessment"
        ? 2
        : null);

    if (ordinal === null) return { refused: forbid(reply, session.role) } as const;

    return { found, session, first: found.assessment1, ordinal, mine } as const;
  };

  app.get("/reports/:id/secondary-assessment", async (request, reply) => {
    const resolved = await resolveMine(request, reply);
    if ("refused" in resolved) return resolved.refused;

    const { found, session, first, ordinal, mine } = resolved;

    // Every OTHER submitted secondary review is this Officer's read-only context — never their own
    // row, whether it is the legacy row (not yet present at all) or the one they are writing.
    const priorReviews = found.secondaryAssessments
      .filter((a) => a.ordinal !== ordinal && a.submitted)
      .map((a) => ({
        ordinal: a.ordinal,
        assessorName: a.assessorName,
        submittedOn: a.submittedOn ?? "",
        review: a.answers,
      }));

    // The manager's instruction for THIS assignment, prominently — not the whole decision
    // history. That is the decision whose `nextOrdinal` is this ordinal: the manager read up
    // through the previous one and then created this row.
    const myAssignment = found.decisions.find(
      (d) => d.kind === "assign_next_assessor" && d.nextOrdinal === ordinal,
    );

    return reply.html(
      <SecondaryAssessmentPage
        report={found.report}
        viewerRole={session.role}
        viewerName={session.fullName}
        ordinal={ordinal}
        first={{
          assessorName: first.assessorName,
          answers: first.answers,
          submittedOn: first.submittedOn,
          device: prefillDeviceRows(found.report.payload, found.report),
          event: prefillEventRows(found.report.payload),
        }}
        managerComment={first.managerComment}
        managerInstruction={myAssignment?.comment ?? null}
        priorReviews={priorReviews}
        review={normalizeSecondaryReview(mine?.answers)}
        submitted={mine?.submitted ?? false}
        issues={[]}
      />,
    );
  });

  app.post("/reports/:id/secondary-assessment", async (request, reply) => {
    const resolved = await resolveMine(request, reply);
    if ("refused" in resolved) return resolved.refused;

    const { found, session, first, ordinal, mine } = resolved;

    if (mine?.submitted === true) return forbid(reply, session.role);

    const posted = fields(request);
    const answers = collectSecondaryReview(posted, first.answers);
    const submitting = value(posted, "intent") === "submit";

    const issues: Issue[] = submitting
      ? validateSecondaryReviewForSubmit(answers, first.answers)
      : [];

    if (issues.length > 0) {
      const priorReviews = found.secondaryAssessments
        .filter((a) => a.ordinal !== ordinal && a.submitted)
        .map((a) => ({
          ordinal: a.ordinal,
          assessorName: a.assessorName,
          submittedOn: a.submittedOn ?? "",
          review: a.answers,
        }));

      const myAssignment = found.decisions.find(
        (d) => d.kind === "assign_next_assessor" && d.nextOrdinal === ordinal,
      );

      return reply.status(422).html(
        <SecondaryAssessmentPage
          report={found.report}
          viewerRole={session.role}
          viewerName={session.fullName}
          ordinal={ordinal}
          first={{
            assessorName: first.assessorName,
            answers: first.answers,
            submittedOn: first.submittedOn,
            device: prefillDeviceRows(found.report.payload, found.report),
            event: prefillEventRows(found.report.payload),
          }}
          managerComment={first.managerComment}
          managerInstruction={myAssignment?.comment ?? null}
          priorReviews={priorReviews}
          review={answers}
          submitted={false}
          issues={issues}
        />,
      );
    }

    const assessorId = session.userId;

    await app.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO assessments (report_id, assessor_id, ordinal, form_version, payload,
                                 conclusion, submitted_at)
        VALUES (${found.report.id}, ${assessorId}, ${ordinal}, ${F004_VERSION},
                ${JSON.stringify(answers)}::jsonb, NULL,
                ${submitting ? sql`now()` : sql`NULL`})
        ON CONFLICT (report_id, ordinal) DO UPDATE
           SET payload      = EXCLUDED.payload,
               conclusion   = EXCLUDED.conclusion,
               form_version = EXCLUDED.form_version,
               submitted_at = COALESCE(assessments.submitted_at, EXCLUDED.submitted_at)
      `);

      if (submitting) {
        await tx.execute(sql`
          UPDATE reports SET status = 'awaiting_decision'
           WHERE id = ${found.report.id} AND status = 'second_assessment'
        `);

        await tx.execute(sql`
          INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
          VALUES (${session.userId}, 'assessment.submitted', 'report', ${found.report.id},
                  ${JSON.stringify({ number: found.report.number, ordinal })}::jsonb)
        `);
      }
    });

    request.log.info(
      { report: found.report.number, ordinal, submitted: submitting },
      "secondary assessment saved",
    );

    return reply.redirect(
      submitting
        ? `/reports/${found.report.id}`
        : `/reports/${found.report.id}/secondary-assessment`,
      302,
    );
  });
}
