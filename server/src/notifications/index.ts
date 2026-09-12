import type { FastifyBaseLogger } from "fastify";

/**
 * Submission notifications: email and SMS, on a successful Submit only.
 *
 * There is no email or SMS provider wired into this application yet — no SMTP client, no SMS
 * gateway, and no phone number column on `users`. `sendEmail` and `sendSms` below are the two
 * seams a real provider plugs into later; today they log the composed message instead of
 * delivering it, so the submission path, its content and its call sites are all already correct
 * and swapping in a real transport is a change to these two functions alone.
 *
 * Deliberately best-effort: a submitted assessment is a fact the database already holds by the
 * time either function runs, and a notification that cannot be sent must never make that
 * submission look like it failed. Every caller awaits this and every failure inside it is caught
 * and logged, never thrown.
 */

export type AssessmentSubmittedNotice = {
  /** The Orange Report's own number, e.g. "AE-2026-00042" — what the officer recognises. */
  reportNumber: string;
  /** 1 for the first assessment, 2, 3, 4, … for each secondary assessment. */
  ordinal: number;
  officerName: string;
  officerEmail: string;
  /** Absent until `users` carries a phone number — see the file comment. */
  officerPhone?: string | null;
  /** Already formatted for reading, the same way the rest of the app prints a date. */
  submittedOn: string;
  /** The report's own page on the staff portal, absolute, for the email's reference link. */
  reportUrl: string;
};

function stageLabel(ordinal: number): string {
  return ordinal === 1 ? "First assessment (A1)" : `Secondary assessment (A${String(ordinal)})`;
}

/** No SMTP client exists in this application. See the file comment for why this only logs. */
async function sendEmail(
  log: FastifyBaseLogger,
  message: { to: string; subject: string; body: string },
): Promise<void> {
  log.info({ channel: "email", ...message }, "notification.dispatch");
}

/**
 * No SMS gateway exists in this application, and `users` carries no phone number either — see the
 * file comment. Skipped rather than logged as sent when there is no number to log against, so the
 * log cannot be misread as a delivery that happened.
 */
async function sendSms(
  log: FastifyBaseLogger,
  message: { to: string | null | undefined; body: string },
): Promise<void> {
  if (message.to === null || message.to === undefined || message.to.trim() === "") {
    log.info({ channel: "sms", body: message.body }, "notification.sms.skipped_no_phone_on_file");
    return;
  }

  log.info({ channel: "sms", to: message.to, body: message.body }, "notification.dispatch");
}

/** Both halves of the "your assessment was submitted" notice, sent once a submission succeeds. */
export async function notifyAssessmentSubmitted(
  log: FastifyBaseLogger,
  notice: AssessmentSubmittedNotice,
): Promise<void> {
  const stage = stageLabel(notice.ordinal);

  const subject = `TMDA: Assessment submitted — ${notice.reportNumber}`;
  const body = [
    `Dear ${notice.officerName},`,
    "",
    `Your assessment for report ${notice.reportNumber} has been submitted to TMDA.`,
    "",
    `Report reference: ${notice.reportNumber}`,
    `Assessment stage: ${stage}`,
    `Submitted on: ${notice.submittedOn}`,
    `View the report: ${notice.reportUrl}`,
    "",
    "This is an automated message from AE Reports.",
  ].join("\n");

  const smsBody = `TMDA: Your assessment for report ${notice.reportNumber} has been submitted successfully.`;

  try {
    await sendEmail(log, { to: notice.officerEmail, subject, body });
  } catch (err) {
    log.error({ err, channel: "email", reportNumber: notice.reportNumber }, "notification.failed");
  }

  try {
    await sendSms(log, { to: notice.officerPhone, body: smsBody });
  } catch (err) {
    log.error({ err, channel: "sms", reportNumber: notice.reportNumber }, "notification.failed");
  }
}
