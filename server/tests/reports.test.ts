import { describe, expect, it } from "vitest";
import {
  deriveDeviceFullName,
  firstIncompleteStep,
  pruneDependents,
  validateStep,
} from "../src/domain/form-schema.js";
import { normalizePhone } from "../src/domain/phone.js";
import {
  type Answers,
  financialYearOf,
  formatReportNumber,
  severityOf,
  validateSubmission,
} from "../src/domain/reports.js";

/** A submission with every required field filled, as the wizard would post it. */
function complete(overrides: Answers = {}): Answers {
  return {
    device_name: "Infusion Pump X",
    report_type: "incident",
    incident_date: "2026-08-01",
    incident_narrative: "Pump stopped mid-infusion.",
    event_type: ["Hospitalization"],
    event_narrative: "Patient was kept overnight for observation.",
    measures_taken: "Stopped using it and set it aside.",
    reporter_name: "A. Mwita",
    facility_address: "Muhimbili National Hospital",
    location: "Dar es Salaam",
    phone: "+255 700 000 000",
    report_date: "2026-08-02",
    device_location: "Sealed in the biomedical workshop",
    ...overrides,
  };
}

describe("submission validation", () => {
  it("accepts a fully filled form", () => {
    const result = validateSubmission(complete());

    expect(result.ok).toBe(true);
  });

  it("keeps answers the normalized columns do not carry", () => {
    const result = validateSubmission(complete({ batch_number: "LOT-42" }));

    // The payload snapshot has to preserve the whole form, not just the indexed fields.
    expect(result.ok && result.submission.batch_number).toBe("LOT-42");
  });

  it("refuses a form the browser never validated", () => {
    // Nothing stops a client posting straight here, so the server cannot rely on `required`.
    const result = validateSubmission({ device_name: "Infusion Pump X" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.length).toBeGreaterThan(0);
  });

  it("names the missing field instead of leaking a type error", () => {
    // A reporter must never be shown "expected string, received undefined".
    const result = validateSubmission(complete({ report_date: undefined as never }));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toContain("Date of report is required");
  });

  it("treats whitespace as empty", () => {
    const result = validateSubmission(complete({ reporter_name: "   " }));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toContain("Name or initials is required");
  });

  it("requires at least one type of event, but only for an adverse event report", () => {
    const result = validateSubmission(complete({ report_type: "adverse_event", event_type: [] }));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toContain("Type of event is required");
  });
});

describe("report type", () => {
  it("requires incident details for an incident report, not event details", () => {
    const result = validateSubmission(
      complete({ report_type: "incident", event_type: [], event_narrative: "" }),
    );

    expect(result.ok).toBe(true);
  });

  it("requires event details for an adverse event report, not incident details", () => {
    const result = validateSubmission(
      complete({
        report_type: "adverse_event",
        incident_date: "",
        incident_narrative: "",
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("still refuses an incident report missing its own incident details", () => {
    const result = validateSubmission(complete({ report_type: "incident", incident_date: "" }));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toContain("Onset date of incident is required");
  });

  it("still refuses an adverse event report missing its own event details", () => {
    const result = validateSubmission(
      complete({ report_type: "adverse_event", event_narrative: "" }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toContain("Event narrative is required");
  });

  it("names the field instead of leaking an enum error", () => {
    const result = validateSubmission(complete({ report_type: undefined as never }));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toContain("Report type is required");
  });

  it("is persisted on the stored submission", () => {
    const result = validateSubmission(complete({ report_type: "adverse_event" }));

    expect(result.ok && result.submission.report_type).toBe("adverse_event");
  });
});

describe("derived device full name", () => {
  it("joins brand and common name", () => {
    expect(deriveDeviceFullName("B. Braun Perfusor", "Infusion Pump")).toBe(
      "B. Braun Perfusor — Infusion Pump",
    );
  });

  it("falls back to whichever half is present", () => {
    expect(deriveDeviceFullName("B. Braun Perfusor", "")).toBe("B. Braun Perfusor");
    expect(deriveDeviceFullName("", "Infusion Pump")).toBe("Infusion Pump");
  });

  it("is empty rather than a stray separator when neither is given", () => {
    expect(deriveDeviceFullName("", "")).toBe("");
    expect(deriveDeviceFullName("  ", "  ")).toBe("");
  });

  it("trims whitespace from each half", () => {
    expect(deriveDeviceFullName("  B. Braun Perfusor  ", "  Infusion Pump  ")).toBe(
      "B. Braun Perfusor — Infusion Pump",
    );
  });
});

describe("phone numbers", () => {
  it("accepts every shape a reporter might reasonably type", () => {
    // All of these are the same number. TMDA sends the report number by SMS, so what lands in
    // the payload has to be something a gateway can dial.
    for (const typed of [
      "712345678",
      "0712345678",
      "+255712345678",
      "255712345678",
      "+255 712 345 678",
      "0712-345-678",
    ]) {
      expect(normalizePhone(typed)).toBe("+255712345678");
    }
  });

  it("refuses what is not a Tanzanian mobile", () => {
    // Landline prefix, too short, too long, and not a number at all.
    expect(normalizePhone("222123456")).toBeNull();
    expect(normalizePhone("71234567")).toBeNull();
    expect(normalizePhone("7123456789")).toBeNull();
    expect(normalizePhone("not a phone")).toBeNull();
  });

  it("stores the number normalized rather than as typed", () => {
    const result = validateSubmission(complete({ phone: "0712 345 678" }));

    expect(result.ok && result.submission.phone).toBe("+255712345678");
  });

  it("names the field instead of leaking a regex", () => {
    const result = validateSubmission(complete({ phone: "12345" }));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toContain(
      "Telephone / mobile phone must be nine digits starting with 7 or 6",
    );
  });
});

describe("conditional answers", () => {
  it("keeps an explanation while its option is chosen", () => {
    const answers = { incident_type: ["Other"], incident_type_other: "Screen cracked" };

    expect(pruneDependents(answers).incident_type_other).toBe("Screen cracked");
  });

  it("drops an explanation once its option is no longer chosen", () => {
    // Otherwise a report carries a reason for an option the reporter did not pick.
    const answers = { incident_type: ["Malfunction"], incident_type_other: "Screen cracked" };

    expect(pruneDependents(answers).incident_type_other).toBeUndefined();
  });

  it("asks for the date only once the supplier has been informed", () => {
    const said = (informed_supplier: string) =>
      validateStep(4, { measures_taken: "Set it aside", informed_supplier }).map(
        (issue) => issue.field,
      );

    expect(said("No")).not.toContain("informed_date");
    expect(said("Yes")).toContain("informed_date");
  });

  it("will not let an unanswered step through", () => {
    // "Refuse moving to the next part if the form is not filled in every point."
    expect(firstIncompleteStep({})).toBe(1);
    expect(validateStep(1, {}).map((issue) => issue.field)).toContain("device_name");
  });
});

describe("severity", () => {
  it("takes the worst outcome when several are ticked", () => {
    // Triage depends on this, so a death must never be filed as a hospitalization.
    expect(severityOf(["Hospitalization", "Death", "Malfunction"])).toBe("death");
    expect(severityOf(["Malfunction", "Life threatening"])).toBe("life_threatening");
  });

  it("falls back to other for outcomes that are not graded", () => {
    expect(severityOf(["Malfunction"])).toBe("other");
    expect(severityOf([])).toBe("other");
  });
});

describe("financial year", () => {
  // Instants are built from Tanzania wall-clock time (`+03:00`, Africa/Dar_es_Salaam has no DST)
  // and then asserted as UTC, so a test cannot accidentally pass by using UTC midnight as if it
  // were the financial-year boundary.

  it("puts 30 June 2026, just before midnight in Tanzania, in the ending financial year", () => {
    const instant = new Date("2026-06-30T23:59:59+03:00");
    expect(instant.toISOString()).toBe("2026-06-30T20:59:59.000Z");
    expect(financialYearOf(instant)).toBe("2025-26");
  });

  it("puts 1 July 2026, just after midnight in Tanzania, in the new financial year", () => {
    const instant = new Date("2026-07-01T00:00:00+03:00");
    expect(instant.toISOString()).toBe("2026-06-30T21:00:00.000Z");
    expect(financialYearOf(instant)).toBe("2026-27");
  });

  it("puts 30 June 2027, just before midnight in Tanzania, in the ending financial year", () => {
    const instant = new Date("2027-06-30T23:59:59+03:00");
    expect(instant.toISOString()).toBe("2027-06-30T20:59:59.000Z");
    expect(financialYearOf(instant)).toBe("2026-27");
  });

  it("puts 1 July 2027, just after midnight in Tanzania, in the new financial year", () => {
    const instant = new Date("2027-07-01T00:00:00+03:00");
    expect(instant.toISOString()).toBe("2027-06-30T21:00:00.000Z");
    expect(financialYearOf(instant)).toBe("2027-28");
  });

  it("is not fooled by UTC midnight: 00:30 Tanzania on 1 July is still 30 June in UTC", () => {
    const instant = new Date("2026-07-01T00:30:00+03:00");
    expect(instant.toISOString()).toBe("2026-06-30T21:30:00.000Z");
    expect(financialYearOf(instant)).toBe("2026-27");
  });

  it("is not fooled by UTC midnight: 23:30 Tanzania on 30 June is still 30 June in UTC", () => {
    const instant = new Date("2026-06-30T23:30:00+03:00");
    expect(instant.toISOString()).toBe("2026-06-30T20:30:00.000Z");
    expect(financialYearOf(instant)).toBe("2025-26");
  });

  it("wraps the ending year across a century boundary", () => {
    expect(financialYearOf(new Date("2099-08-01T00:00:00Z"))).toBe("2099-00");
  });
});

describe("report numbers", () => {
  it("pads the serial to three digits", () => {
    expect(formatReportNumber("2025-26", 3)).toBe("AEMD/2025-26/003");
    expect(formatReportNumber("2025-26", 1)).toBe("AEMD/2025-26/001");
  });

  it("does not truncate once past three digits", () => {
    expect(formatReportNumber("2025-26", 1234)).toBe("AEMD/2025-26/1234");
  });
});
