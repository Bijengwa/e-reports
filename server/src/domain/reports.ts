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
 * Store one public submission and return the number the reporter should keep.
 *
 * Everything happens in a single transaction: the counter increment, the report row and the audit
 * entry stand or fall together, so a failure part way through cannot burn a report number or
 * leave a report nobody can trace.
 */
export async function storeReport(
  db: Database,
  submission: Submission,
  files: readonly AttachmentInput[] = [],
  now: Date = new Date(),
): Promise<string> {
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

    const [row] = await tx
      .insert(reports)
      .values({
        number,
        channel: "online_form",
        severity: severityOf(submission.event_type),
        deviceName: submission.device_name,
        facility: submission.facility_address,
        reporterName: submission.reporter_name,
        formVersion: FORM_VERSION,
        // The immutable snapshot of exactly what was submitted, including fields the
        // normalized columns above do not carry.
        payload: submission,
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
      // Null actor: the public door is anonymous by design.
      actorUserId: null,
      action: "report.submitted",
      entityType: "report",
      entityId: row.id,
      after: { number, channel: "online_form" },
    });

    return number;
  });
}
