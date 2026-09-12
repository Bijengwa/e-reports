import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.js";
import { storeReport, validateSubmission } from "../../src/domain/reports.js";
import { INTEGRATION_ENABLED, openOwner, truncateAll } from "./helpers.js";

/**
 * The AEMD/YYYY-YY/NNN allocator, end to end against a real Postgres transaction.
 *
 * The pure date arithmetic (which financial year a date falls in, how the number is padded) is
 * covered in `tests/reports.test.ts` without a database. What only a database can prove is the
 * concurrency and rollback behaviour the allocator exists for, which is what this file is for.
 */

let owner: DatabaseHandle;

afterAll(async () => {
  await owner?.close();
});

beforeEach(async () => {
  owner ??= openOwner();
  await truncateAll(owner.db);
});

/** A submission with every required field filled, as the wizard would post it. */
function submission() {
  const result = validateSubmission({
    device_name: "Infusion Pump X",
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
  });

  if (!result.ok)
    throw new Error(`fixture submission failed validation: ${result.errors.join(", ")}`);
  return result.submission;
}

/**
 * One report, inserted directly rather than through `storeReport`, standing in for a number a
 * migration or a legacy import left behind with no counter row backing it.
 */
async function seedReportNumbered(number: string): Promise<void> {
  await owner.db.execute(sql`
    INSERT INTO reports (number, channel, severity, device_name, form_version, payload)
    VALUES (${number}, 'online_form', 'other', 'Seeded device', 'F001', '{}'::jsonb)
  `);
}

async function lastSerial(fy: string): Promise<number | null> {
  const rows = await owner.db.execute(sql`
    SELECT last_serial FROM report_counters WHERE fy = ${fy}
  `);

  return rows.length === 0 ? null : (rows[0] as { last_serial: number }).last_serial;
}

describe.skipIf(!INTEGRATION_ENABLED)("AEMD financial-year report numbers", () => {
  it("puts a report received on 30 June in the financial year that is ending", async () => {
    const { number } = await storeReport(owner.db, submission(), [], {
      now: new Date("2026-06-30T23:00:00Z"),
    });

    expect(number).toBe("AEMD/2025-26/001");
  });

  it("puts a report received on 1 July in the new financial year", async () => {
    const { number } = await storeReport(owner.db, submission(), [], {
      now: new Date("2026-07-01T00:00:00Z"),
    });

    expect(number).toBe("AEMD/2026-27/001");
  });

  it("is the first report of a financial year nothing has touched yet", async () => {
    expect(await lastSerial("2031-32")).toBeNull();

    const { number } = await storeReport(owner.db, submission(), [], {
      now: new Date("2031-09-01T00:00:00Z"),
    });

    expect(number).toBe("AEMD/2031-32/001");
    expect(await lastSerial("2031-32")).toBe(1);
  });

  it("continues from the highest existing AEMD serial rather than starting at 001", async () => {
    const fy = "2032-33";
    await seedReportNumbered(`AEMD/${fy}/001`);
    await seedReportNumbered(`AEMD/${fy}/007`);

    const { number } = await storeReport(owner.db, submission(), [], {
      now: new Date("2032-10-01T00:00:00Z"),
    });

    expect(number).toBe(`AEMD/${fy}/008`);
  });

  it("hands two concurrent allocations for the same year different numbers", async () => {
    const now = new Date("2033-08-01T00:00:00Z");

    const [a, b] = await Promise.all([
      storeReport(owner.db, submission(), [], { now }),
      storeReport(owner.db, submission(), [], { now }),
    ]);

    expect(a.number).not.toBe(b.number);
    expect([a.number, b.number].sort()).toEqual(["AEMD/2033-34/001", "AEMD/2033-34/002"]);
  });

  it("does not leave the sequence advanced when the report insert rolls back", async () => {
    const fy = "2034-35";
    // The number the allocator is about to produce, already taken — so the insert inside
    // storeReport's own transaction hits the unique constraint on `number` and everything in
    // that transaction, the counter increment included, rolls back with it.
    await seedReportNumbered(`AEMD/${fy}/001`);

    await expect(
      storeReport(owner.db, submission(), [], { now: new Date("2034-08-01T00:00:00Z") }),
    ).rejects.toThrow();

    // Rolled back to nothing reserved, not stuck at 1: the next real attempt must still see this
    // financial year as untouched, seed from the surviving AEMD/2034-35/001 and land on 002.
    expect(await lastSerial(fy)).toBeNull();

    const { number } = await storeReport(owner.db, submission(), [], {
      now: new Date("2034-08-02T00:00:00Z"),
    });

    expect(number).toBe(`AEMD/${fy}/002`);
  });

  it("keeps the report number unique even for a hand-inserted collision", async () => {
    await storeReport(owner.db, submission(), [], { now: new Date("2035-08-01T00:00:00Z") });

    await expect(seedReportNumbered("AEMD/2035-36/001")).rejects.toThrow(/unique|duplicate/i);
  });
});
