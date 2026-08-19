import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { attachments, auditLog, reportCounters, reports } from "../db/schema/index.js";
import type { Answers } from "./form-schema.js";
import { normalizePhone } from "./phone.js";

/** The paper form this data was collected on. Stored per report so old reports stay readable. */
export const FORM_VERSION = "TMDA/DMD/MDV/F/001 Rev 06";

export type { Answers };

/** One attachment already written to object storage, waiting to be tied to a report. */
export type AttachmentInput = {
  objectKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
};

/**
 * A field the reporter must fill in.
 *
 * A missing field is normalised to "" rather than left undefined, so the reporter is told "Date of
 * report is required" instead of being shown Zod's "expected string, received undefined".
 */
const required = (label: string) =>
  z.preprocess(
    (value) => (Array.isArray(value) ? value.join(", ") : (value ?? "")),
    z.string().trim().min(1, `${label} is required`),
  );

const asList = z.preprocess(
  (value) => (Array.isArray(value) ? value : value === undefined ? [] : [value]),
  z.array(z.string().trim().min(1)),
);

/**
 * What the form must contain before it can become a report.
 *
 * These mirror the fields marked with a red asterisk. The browser enforces them too, but browser
 * validation is a convenience for the reporter, not a guarantee to us — anything can post here.
 */
export const SubmissionSchema = z
  .object({
    device_name: required("Device name"),
    incident_date: required("Onset date of incident"),
    incident_narrative: required("Incident narrative"),
    event_type: asList.refine((types) => types.length > 0, "Type of event is required"),
    event_narrative: required("Event narrative"),
    measures_taken: required("Measures taken"),
    reporter_name: required("Name or initials"),
    facility_address: required("Physical address"),
    location: required("District / region / city"),
    // Normalised, not merely checked: what lands in the payload is what an SMS gateway can dial.
    phone: z.preprocess(
      (value) => (Array.isArray(value) ? value.join(", ") : (value ?? "")),
      z
        .string()
        .trim()
        .min(1, "Telephone / mobile phone is required")
        .transform((raw, ctx) => {
          const e164 = normalizePhone(raw);

          if (e164 === null) {
            ctx.addIssue({
              code: "custom",
              message: "Telephone / mobile phone must be nine digits starting with 7 or 6",
            });
            return z.NEVER;
          }

          return e164;
        }),
    ),
    report_date: required("Date of report"),
    device_location: required("Current location of the device"),
  })
  .passthrough();

export type Submission = z.infer<typeof SubmissionSchema>;

export type Severity = "death" | "life_threatening" | "hospitalization" | "other";

/**
 * How badly it went, taken from the event checkboxes.
 *
 * Worst outcome wins: a report that is both a hospitalization and a death is a death. This drives
 * triage, so it is derived here rather than trusted from a field the reporter could leave blank.
 */
export function severityOf(eventTypes: readonly string[]): Severity {
  if (eventTypes.includes("Death")) return "death";
  if (eventTypes.includes("Life threatening")) return "life_threatening";
  if (eventTypes.includes("Hospitalization")) return "hospitalization";
  return "other";
}

/** e.g. `MD-AE/2026/0179`. */
export function formatReportNumber(year: number, issued: number): string {
  return `MD-AE/${year}/${String(issued).padStart(4, "0")}`;
}

export type ValidationResult =
  | { ok: false; errors: string[] }
  | { ok: true; submission: Submission };

export function validateSubmission(answers: Answers): ValidationResult {
  const result = SubmissionSchema.safeParse(answers);
  if (result.success) return { ok: true, submission: result.data };

  return { ok: false, errors: result.error.issues.map((issue) => issue.message) };
}

/**
 * Arbitrary but permanent, and deliberately not the bootstrap key.
 *
 * Two unrelated races must not share a lock, or one would serialise the other for nothing.
 * Changing this reopens the race it exists to close, because two processes holding different keys
 * do not exclude one another.
 */
export const ASSIGNMENT_LOCK_KEY = 7_312_884_501n;

/**
 * The handle `db.transaction` hands its callback, which is not the same type as the database.
 *
 * Derived rather than named directly, so it follows the driver instead of having to be corrected
 * when drizzle changes it. Taking this rather than `Database` is what stops the pick below being
 * callable outside the transaction that locks for it.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Who should assess this report first.
 *
 * The least loaded active Officer, where load is the reports already theirs that nobody has
 * finished with — `received` and `first_assessment`. Ties go to whoever has waited longest for
 * work, and then to the lowest id so the answer is never arbitrary.
 *
 * "Waited longest" is the *latest* time each candidate was given something, oldest first, with
 * never-assigned ahead of everyone. Taking the oldest of their open assignments instead would be
 * null for every candidate whenever the queue is clear, collapsing every tie onto the lowest id
 * and funnelling a promptly-worked queue to one Officer forever.
 *
 * Whoever typed the report in is not treated differently. An Officer transcribing an emailed form
 * competes on the same terms as everyone else: this is a split of work, and making the typist
 * more or less likely to own what they typed would be a policy nobody asked for.
 *
 * Managers and administrators are not candidates. The filter is the assessor role, so there is no
 * exclusion clause anyone could forget to keep in step with the roles.
 *
 * Returns null when there is no active assessor at all — the report is still filed.
 */
async function pickFirstAssessor(tx: Transaction): Promise<string | null> {
  const rows = await tx.execute(sql`
    SELECT u.id
      FROM users u
     WHERE u.role = 'assessor'
       AND u.is_active
     ORDER BY (
               SELECT count(*)
                 FROM reports r
                WHERE r.assessor1_user_id = u.id
                  AND r.status IN ('received', 'first_assessment')
             ) ASC,
             (
               SELECT max(r.assessor1_assigned_at)
                 FROM reports r
                WHERE r.assessor1_user_id = u.id
             ) ASC NULLS FIRST,
             u.id ASC
     LIMIT 1
  `);

  return rows.length === 0 ? null : (rows[0] as { id: string }).id;
}

/** How a report reached us, and who keyed it in if it did not arrive by itself. */
export type Filing = {
  /** Defaults to `online_form`: the public door files what a reporter typed, unattended. */
  channel?: "online_form" | "email" | "hard_copy";
  /**
   * The staff member who transcribed it. Null for anything the public filed.
   *
   * Who typed it, not who owns it. Nothing assigns work yet, and this column must not quietly
   * become the thing that does — an Officer transcribing a report is not thereby its assessor.
   */
  enteredByUserId?: string | null;
  now?: Date;
};

/**
 * Store one submission and return the row it became.
 *
 * Everything happens in a single transaction: the counter increment, the report row and the audit
 * entry stand or fall together, so a failure part way through cannot burn a report number or
 * leave a report nobody can trace.
 *
 * `status` is never named here. The column defaults to `received`, so a report filed at either
 * door lands in the same pool, and the one way to file something already assessed would be to add
 * a line to this function.
 *
 * The id comes back as well as the number because a staff filer is sent to the report they just
 * created, and looking it up again by number would be a second query for what this one knows.
 */
export async function storeReport(
  db: Database,
  submission: Submission,
  files: readonly AttachmentInput[] = [],
  filing: Filing = {},
): Promise<{ id: string; number: string }> {
  const now = filing.now ?? new Date();
  const channel = filing.channel ?? "online_form";
  const enteredByUserId = filing.enteredByUserId ?? null;
  const year = now.getUTCFullYear();

  return db.transaction(async (tx) => {
    // Atomic: concurrent submissions each get their own number.
    const [counter] = await tx
      .insert(reportCounters)
      .values({ year, issued: 1 })
      .onConflictDoUpdate({
        target: reportCounters.year,
        set: { issued: sql`${reportCounters.issued} + 1` },
      })
      .returning({ issued: reportCounters.issued });

    if (counter === undefined) throw new Error("Could not reserve a report number");

    const number = formatReportNumber(year, counter.issued);

    // Held until this transaction ends, and taken before the workload is counted rather than
    // after. Two filings landing together would otherwise both read the same counts, both decide
    // the same Officer is the least loaded, and both hand it to them — the count each read was
    // true when it was read and stale by the time it was used.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ASSIGNMENT_LOCK_KEY})`);

    const assessor1UserId = await pickFirstAssessor(tx);

    const [row] = await tx
      .insert(reports)
      .values({
        number,
        channel,
        severity: severityOf(submission.event_type),
        deviceName: submission.device_name,
        facility: submission.facility_address,
        reporterName: submission.reporter_name,
        formVersion: FORM_VERSION,
        // The immutable snapshot of exactly what was submitted, including fields the
        // normalized columns above do not carry.
        payload: submission,
        enteredByUserId,
        // Set on the insert, never by a later UPDATE. That is not a stylistic preference: the
        // application's database role holds INSERT on this table and not UPDATE, so a report is
        // assigned as it is written or it is an orphan waiting for a route that can reassign it.
        assessor1UserId,
        assessor1AssignedAt: assessor1UserId === null ? null : now,
      })
      .returning({ id: reports.id });

    if (row === undefined) throw new Error("Report insert returned no row");

    // Inside the same transaction: a report that lost its photographs is a different report, and
    // the bytes are already in object storage by the time we get here.
    if (files.length > 0) {
      await tx.insert(attachments).values(
        files.map((file) => ({
          reportId: row.id,
          objectKey: file.objectKey,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          checksumSha256: file.checksumSha256,
        })),
      );
    }

    await tx.insert(auditLog).values({
      // Null actor when the public door filed it: that door is anonymous by design. A staff
      // filing names the Officer who typed it, which is the whole reason the trail exists.
      actorUserId: enteredByUserId,
      action: "report.submitted",
      entityType: "report",
      entityId: row.id,
      after: { number, channel },
    });

    return { id: row.id, number };
  });
}
