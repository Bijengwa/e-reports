import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  collect,
  F004_VERSION,
  type F004Answers,
  FIRST_ASSESSMENT,
  type Issue,
  prefillDeviceRows,
  prefillEventRows,
  validateForSubmit,
  value,
} from "../../../domain/f004.js";
import { currentSession } from "../session-guard.js";
import { Assessment1Page } from "../views/assessment.js";
import { ForbiddenPage } from "../views/forbidden.js";
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

/**
 * The first assessment of one report.
 *
 * Who may stand here is settled twice over: the scope requires the assessor role, and this asks
 * the row whether the reader is the Officer it was given to. Being an assessor is not enough —
 * a colleague's report is a colleague's to assess, and an orphan is nobody's, which the same
 * comparison covers because `null === userId` is false.
 *
 * 403 rather than 404. The report exists and the reader can already see it on `/reports/:id`, so
 * pretending it is missing would be a lie they could disprove in one click.
 *
 * The assessor written onto the row is `assessor1_user_id`, never the session id. They are equal
 * here — the guard just proved it — but the assignment is the fact, and reading it from the report
 * is what keeps `assessments.ordinal = 1` and `reports.assessor1_user_id` naming one person.
 */
export async function assessmentRoutes(app: FastifyInstance): Promise<void> {
  /** Refused, and told so on a page that still carries the reader’s own rail. */
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

    // A submitted assessment is finished. Refused rather than quietly ignored, because a POST that
    // answers 200 and changes nothing is indistinguishable from one that worked.
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

    // Nothing is written when a submission is incomplete. Saving half of it under the assessor's
    // signature and telling them it failed would leave the record disagreeing with the page.
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
               -- Never cleared by a later save: submitting is one-way, and the guard above means
               -- only a draft can reach this statement at all.
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
        // The first save is what starts the assessment. Guarded on the current status rather than
        // set unconditionally, so a later draft save cannot drag a report backwards.
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

    // Submitted, so it leaves the assessor's hands and they are shown the report. Saved, so they
    // are put back where they were working, on a GET that a refresh cannot repeat.
    return reply.redirect(
      submitting ? `/reports/${found.report.id}` : `/reports/${found.report.id}/assessment-1`,
      302,
    );
  });
}
