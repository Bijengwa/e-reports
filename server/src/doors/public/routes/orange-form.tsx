import type { FastifyInstance } from "fastify";
import {
  type Issue,
  LAST_STEP,
  parseStep,
  pruneDependents,
  type Step,
} from "../../../domain/form-schema.js";
import { storeReport } from "../../../domain/reports.js";
import { FIRST_STEP, MAX_UPLOAD_MB, OrangeFormPage } from "../../../forms/orange-form.js";
import {
  advance,
  carriedAttachments,
  collectAnswers,
  parseForm,
} from "../../../forms/submission.js";
import { LOCALE_COOKIE, type Locale, parseLocale, t } from "../../../i18n/index.js";
import { MAX_ATTACHMENTS } from "../../../storage/index.js";

export async function orangeFormRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request, reply) => {
    const locale = parseLocale(request.cookies[LOCALE_COOKIE]);
    return reply.html(<OrangeFormPage step={FIRST_STEP} locale={locale} />);
  });

  app.post("/orange-form", async (request, reply) => {
    const { fields, uploaded, rejected } = await parseForm(app, request);

    const step = parseStep(fields.step);
    const action = typeof fields.action === "string" ? fields.action : "next";
    const locale = parseLocale(typeof fields.locale === "string" ? fields.locale : undefined);

    // Dropping answers whose controlling question no longer selects them is what makes the
    // greyed-out input on screen true of the record, not merely true of the screen.
    const answers = pruneDependents(collectAnswers(fields));
    const attachments = [...carriedAttachments(fields), ...uploaded].slice(0, MAX_ATTACHMENTS);

    const uploadNotice =
      rejected.length > 0
        ? t(locale, "error.upload", { name: rejected.join(", "), size: MAX_UPLOAD_MB })
        : undefined;

    /** Re-render some step, carrying everything the reporter has given us so far. */
    const page = (target: Step, issues: readonly Issue[] = [], notice = uploadNotice) => (
      <OrangeFormPage
        step={target}
        answers={answers}
        issues={issues}
        locale={locale}
        attachments={attachments}
        notice={notice}
      />
    );

    // ---- Language ------------------------------------------------------------
    if (action.startsWith("lang:")) {
      const chosen: Locale = parseLocale(action.slice("lang:".length));

      reply.setCookie(LOCALE_COOKIE, chosen, {
        path: "/",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
      });

      return reply.html(
        <OrangeFormPage
          step={step}
          answers={answers}
          locale={chosen}
          attachments={attachments}
          notice={uploadNotice}
        />,
      );
    }

    // ---- Navigation, and final submission -------------------------------------
    // The rules live in `advance`, which the staff door runs too. A reporter and an Officer
    // filing the same form must be held to the same standard, and two copies of these branches
    // is how they stop being.
    const turn = advance(step, action, answers);

    if (turn.kind === "step") {
      return reply.status(turn.status).html(page(turn.step, turn.issues));
    }

    if (turn.kind === "rejected") {
      return reply.status(422).html(page(LAST_STEP, [], turn.errors.join("; ")));
    }

    try {
      const { number } = await storeReport(app.db, turn.submission, attachments);
      request.log.info({ number, attachments: attachments.length }, "public report stored");

      return reply.html(<OrangeFormPage reportNumber={number} locale={locale} />);
    } catch (error) {
      // The reporter must not be told this succeeded, and must not lose what they typed.
      request.log.error({ err: error }, "could not store public report");

      return reply.status(503).html(page(LAST_STEP, [], t(locale, "error.notFiled")));
    }
  });

  // Unauthenticated liveness probe, scoped to this door.
  app.get("/healthz", async () => ({ status: "ok", door: "public" }));
}
