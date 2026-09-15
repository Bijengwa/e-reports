import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { attachments, auditLog, reports } from "../db/schema/index.js";
import type { Answers } from "./form-schema.js";
import { normalizePhone } from "./phone.js";

/** The paper form this data was collected on. Stored per report so old reports stay readable. */
export const FORM_VERSION = "TMDA/DMD/MDV/F/001 Rev 06";

/**
 * The document's own title, as TMDA prints it on the paper.
 *
 * The staff app calls this document the "Orange Report" everywhere, and will keep doing so — it is
 * what the office calls it and what the colour on screen means. This is the name the document
 * actually carries, shown wherever the reader is looking at the document itself rather than at a
 * reference to it.
 */
export const FORM_TITLE =
  "Medical Devices and In Vitro Diagnostics Adverse Event/Incident Reporting Form for Consumers and Healthcare Facilities";

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

/** A field normalised the same way as `required`, but left blank rather than rejected when empty. */
const optionalText = z.preprocess(
  (value) => (Array.isArray(value) ? value.join(", ") : (value ?? "")),
  z.string().trim(),
);

/** The two kinds of situation the orange form can carry. */
export const REPORT_TYPES = ["incident", "adverse_event"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

const reportType = z.preprocess(
  (value) => (Array.isArray(value) ? value[0] : value),
  z.enum(REPORT_TYPES, { error: "Report type is required" }),
);

/**
 * What the form must contain before it can become a report.
 *
 * These mirror the fields marked with a red asterisk. The browser enforces them too, but browser
 * validation is a convenience for the reporter, not a guarantee to us — anything can post here.
 *
 * Incident details and event details are each required only for the report type that asks for
 * them — see the `superRefine` below, which is the one place both this schema and the wizard's own
 * step rules (`domain/form-schema.ts`) have to agree, since a hand-written POST reaches this schema
 * without ever going through a step.
 */
export const SubmissionSchema = z
  .object({
    device_name: required("Device name"),
    report_type: reportType,
    incident_date: optionalText,
    incident_narrative: optionalText,
    event_type: asList,
    event_narrative: optionalText,
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
  .passthrough()
  .superRefine((data, ctx) => {
    if (data.report_type === "incident") {
      if (data.incident_date.trim() === "") {
        ctx.addIssue({
          code: "custom",
          path: ["incident_date"],
          message: "Onset date of incident is required",
        });
      }
      if (data.incident_narrative.trim() === "") {
        ctx.addIssue({
          code: "custom",
          path: ["incident_narrative"],
          message: "Incident narrative is required",
        });
      }
    }

    if (data.report_type === "adverse_event") {
      if (data.event_type.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["event_type"],
          message: "Type of event is required",
        });
      }
      if (data.event_narrative.trim() === "") {
        ctx.addIssue({
          code: "custom",
          path: ["event_narrative"],
          message: "Event narrative is required",
        });
      }
    }
  });

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

/** The most reports a single financial year's three-digit serial can hold. */
export const MAX_SERIAL = 999;

/** Reads a `Date`'s calendar year and month as they read on a clock in Dar es Salaam. */
const tanzaniaYearMonth = new Intl.DateTimeFormat("en-US", {
  timeZone: "Africa/Dar_es_Salaam",
  year: "numeric",
  month: "numeric",
});

/**
 * Which financial year a date falls in, as `"YYYY-YY"`.
 *
 * The year runs 1 July - 30 June *Tanzania time*, not UTC: TMDA's financial year turns over at
 * midnight in Dar es Salaam, so a report timestamped a few hours either side of that boundary in
 * UTC must still land in the financial year its own clock was in when it was received. Tanzania
 * has kept a fixed UTC+3 offset with no daylight saving since 1961, but the lookup goes through
 * `Intl.DateTimeFormat` with an explicit IANA zone rather than a hand-rolled `+3`, so this stays
 * correct even if that ever changed and does not silently drift the way a hardcoded offset would.
 */
export function financialYearOf(date: Date): string {
  const parts = tanzaniaYearMonth.formatToParts(date);
  const calendarYear = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value); // 1-12

  const startYear = month >= 7 ? calendarYear : calendarYear - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** e.g. `AEMD/2025-26/003`. */
export function formatReportNumber(fy: string, serial: number): string {
  return `AEMD/${fy}/${String(serial).padStart(3, "0")}`;
}

/**
 * Reserves the next serial for `receivedAt`'s financial year and returns the number it makes.
 *
 * Never `SELECT max(...) + 1` as the allocation step itself — two concurrent callers would read
 * the same max and collide on the unique index. The increment is a single atomic upsert instead:
 * `INSERT ... ON CONFLICT DO UPDATE` takes the same row lock an `UPDATE` would, so a second caller
 * for the same financial year blocks until the first commits and then increments what it left
 * behind, rather than recomputing anything.
 *
 * The `max(...)` here runs only the first time a financial year is ever touched, to seed the
 * counter from whatever AEMD numbers for that year already exist (e.g. carried over by a data
 * migration) rather than assuming the year starts at 001. Every allocation after that first one
 * takes the conflict branch and never re-reads `reports` at all.
 *
 * Called with the same `tx` that inserts the report row, so a failure anywhere later in that
 * transaction rolls the reservation back with it — no number is ever burned by a report that did
 * not end up existing.
 */
async function allocateReportNumber(tx: Transaction, receivedAt: Date): Promise<string> {
  const fy = financialYearOf(receivedAt);
  const prefix = `AEMD/${fy}/`;

  const rows = await tx.execute(sql`
    INSERT INTO report_counters (fy, last_serial)
    VALUES (
      ${fy},
      1 + COALESCE(
        (
          SELECT max(substring(number from ${prefix.length + 1}::int)::int)
            FROM reports
           WHERE number LIKE ${`${prefix}%`}
        ),
        0
      )
    )
    ON CONFLICT (fy) DO UPDATE SET last_serial = report_counters.last_serial + 1
    RETURNING last_serial
  `);

  const counter = rows[0] as { last_serial: number } | undefined;
  if (counter === undefined) throw new Error("Could not reserve a report number");

  if (counter.last_serial > MAX_SERIAL) {
    throw new Error(
      `Financial year ${fy} has already issued ${MAX_SERIAL} report numbers; cannot allocate another`,
    );
  }

  return formatReportNumber(fy, counter.last_serial);
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
 * The handle `db.transaction` hands its callback, which is not the same type as the database.
 *
 * Derived rather than named directly, so it follows the driver instead of having to be corrected
 * when drizzle changes it.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

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

  return db.transaction(async (tx) => {
    // Atomic: concurrent submissions each get their own number.
    const number = await allocateReportNumber(tx, now);

    const [row] = await tx
      .insert(reports)
      .values({
        number,
        channel,
        // Same clock reading the number's financial year came from, rather than the database's
        // own `now()` — otherwise a caller passing `filing.now` (as the tests do, to pin a report
        // to a given financial year) would get a number for one year and a stored date in another.
        receivedAt: now,
        severity: severityOf(submission.event_type),
        deviceName: submission.device_name,
        facility: submission.facility_address,
        reporterName: submission.reporter_name,
        formVersion: FORM_VERSION,
        // The immutable snapshot of exactly what was submitted, including fields the
        // normalized columns above do not carry.
        payload: submission,
        enteredByUserId,
        // Always unassigned at intake. Assigning Assessment 1 is now the Manager's manual action,
        // taken after the report exists — not a choice this function makes for them. Every report
        // starts in the Manager's unassigned queue, whether or not an active Officer exists to be
        // handed it.
        assessor1UserId: null,
        assessor1AssignedAt: null,
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
