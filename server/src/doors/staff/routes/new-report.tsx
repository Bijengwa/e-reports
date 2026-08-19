import type { Children } from "@kitajs/html";
import type { FastifyInstance } from "fastify";
import type { StaffSession } from "../../../auth/session.js";
import {
  type Issue,
  LAST_STEP,
  parseStep,
  pruneDependents,
  type Step,
} from "../../../domain/form-schema.js";
import { storeReport } from "../../../domain/reports.js";
import { FIRST_STEP, MAX_UPLOAD_MB, OrangeForm } from "../../../forms/orange-form.js";
import {
  advance,
  carriedAttachments,
  collectAnswers,
  parseForm,
} from "../../../forms/submission.js";
import { t } from "../../../i18n/index.js";
import { MAX_ATTACHMENTS } from "../../../storage/index.js";
import { currentSession } from "../session-guard.js";
import { StaffShell } from "../views/shell.js";

/** Where the staff wizard posts, and the address the rail's entry points at. */
const ACTION = "/reports/new";

/**
 * The staff door's chrome around the form.
 *
 * The same shell `/reports` and `/dashboard` render, so the Officer keeps their rail — with "New
 * report" marked as the page they are on — and the form is content in the main pane rather than a
 * page that replaced the portal. Every branch of the POST renders through here too, so a 422 on
 * step three does not throw the Officer out of the application they are working in.
 */
function NewReportPage({
  session,
  children,
}: {
  session: StaffSession;
  children?: Children;
}): JSX.Element {
  return (
    <StaffShell
      title="New report — AE Reports"
      pageTitle="New report"
      role={session.role}
      fullName={session.fullName}
      active="new-report"
    >
      {children}
    </StaffShell>
  );
}

/**
 * Registering a report that arrived by email.
 *
 * The same orange form, filed by an Officer instead of by the reporter. The page and the wizard
 * both come from `forms/`, so a field that is mandatory for a reporter is mandatory for an Officer
 * transcribing one, and neither door can drift from the other.
 *
 * What differs is only what this door knows: the portal is English, the form posts here, and the
 * row records who typed it. `channel` is `email` because that is how the document reached TMDA;
 * `status` is not named at all, so the report lands in the same `received` pool as a public filing
 * and appears on the Officer queue beside everything else. Nothing here assigns it — having
 * transcribed a report is not the same as being the person who will assess it, and this slice has
 * no way to say the second thing.
 *
 * Registered inside a scope that requires the assessor role, so a manager or an administrator is
 * refused both the page and the submission by the guard rather than by a check written here.
 */
export async function newReportRoutes(app: FastifyInstance): Promise<void> {
  app.get(ACTION, async (request, reply) => {
    const session = currentSession(request);

    return reply.html(
      <NewReportPage session={session}>
        <OrangeForm step={FIRST_STEP} locale="en" action={ACTION} languages={false} embedded />
      </NewReportPage>,
    );
  });

  app.post(ACTION, async (request, reply) => {
    const session = currentSession(request);
    const { fields, uploaded, rejected } = await parseForm(app, request);

    const step = parseStep(fields.step);
    const action = typeof fields.action === "string" ? fields.action : "next";

    // Dropping answers whose controlling question no longer selects them is what makes the
    // greyed-out input on screen true of the record, not merely true of the screen.
    const answers = pruneDependents(collectAnswers(fields));
    const attachments = [...carriedAttachments(fields), ...uploaded].slice(0, MAX_ATTACHMENTS);

    const uploadNotice =
      rejected.length > 0
        ? t("en", "error.upload", { name: rejected.join(", "), size: MAX_UPLOAD_MB })
        : undefined;

    /** Re-render some step, carrying everything the Officer has keyed in so far. */
    const page = (target: Step, issues: readonly Issue[] = [], notice = uploadNotice) => (
      <NewReportPage session={session}>
        <OrangeForm
          step={target}
          answers={answers}
          issues={issues}
          locale="en"
          attachments={attachments}
          notice={notice}
          action={ACTION}
          languages={false}
          embedded
        />
      </NewReportPage>
    );

    const turn = advance(step, action, answers);

    if (turn.kind === "step") {
      return reply.status(turn.status).html(page(turn.step, turn.issues));
    }

    if (turn.kind === "rejected") {
      return reply.status(422).html(page(LAST_STEP, [], turn.errors.join("; ")));
    }

    try {
      const { id, number } = await storeReport(app.db, turn.submission, attachments, {
        channel: "email",
        enteredByUserId: session.userId,
      });

      request.log.info(
        { number, attachments: attachments.length, enteredBy: session.userId },
        "staff report stored",
      );

      // Straight to the report they just filed, rather than to a confirmation page: an Officer
      // has no number to quote back at anybody, they need to see what they entered. A redirect
      // rather than a render, so a refresh cannot post the form a second time.
      return reply.redirect(`/reports/${id}`, 302);
    } catch (error) {
      // The Officer must not be told this succeeded, and must not lose what they typed.
      request.log.error({ err: error }, "could not store staff report");

      return reply.status(503).html(page(LAST_STEP, [], t("en", "error.notFiled")));
    }
  });
}
