import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/auth/password.js";
import type { Config } from "../../src/config.js";
import type { DatabaseHandle } from "../../src/db/client.js";
import { buildServer } from "../../src/server.js";
import { INTEGRATION_ENABLED, openOwner, requireTestDatabase, truncateAll } from "./helpers.js";

/**
 * Migration 0013, and the two pages it exists to unbreak.
 *
 * The state under test cannot be produced by this application any more: nothing writes
 * `reports.assessor2_user_id`. It is what a report assigned a secondary assessor *before* the
 * A2..An generalization looks like — the assignment in the old column, the status moved, and no
 * `assessments` row above ordinal 1, because that row used to appear only when the Officer first
 * saved a draft.
 *
 * Every other suite that touches the legacy column writes an `assessments` row beside it, which is
 * what a report looks like *after* its assessor has opened it. That is why they are all green
 * while a real register holds a report neither the manager's Workload nor the assessor's own queue
 * will name. This suite seeds the state those do not, and pins what the shipped migration does to
 * it — read off disk rather than retyped, so a test cannot pass against SQL that is not the SQL
 * that will run.
 */

const STAFF_HOST = "staff.test";
const PUBLIC_HOST = "public.test";
const PASSWORD = "a correct staff password";
const COOKIE = "__Host-ae_session";

const MIGRATION = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "drizzle",
  "0013_backfill_legacy_secondary_assessments.sql",
);

type Role = "administrator" | "manager" | "assessor";
type Staff = { cookie: string; id: string; name: string };

let owner: DatabaseHandle;
let app: FastifyInstance;

function testConfig(): Config {
  return Object.freeze({
    NODE_ENV: "test",
    LOG_LEVEL: "fatal",
    HOST: "127.0.0.1",
    PORT: 3000,
    PUBLIC_HOST,
    STAFF_HOST,
    DATABASE_URL: requireTestDatabase().appUrl,
    STORAGE_DRIVER: "filesystem",
    STORAGE_ROOT: path.join(os.tmpdir(), "e-reports-test-storage"),
    MAX_UPLOAD_MB: 10,
    SESSION_IDLE_MINUTES: 30,
    SESSION_ABSOLUTE_HOURS: 12,
  } satisfies Config);
}

afterAll(async () => {
  await app?.close();
  await owner?.close();
});

async function start(): Promise<void> {
  owner ??= openOwner();
  app ??= await buildServer(testConfig());
  await app.ready();
  await truncateAll(owner.db);
}

let seeded = 0;

async function signedInAs(role: Role, name?: string): Promise<Staff> {
  seeded += 1;
  const email = `legacy-${seeded}@tmda.go.tz`;
  const fullName = name ?? `Officer ${seeded}`;

  const rows = await owner.db.execute(sql`
    INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
    VALUES (${email}, ${fullName}, ${role}::user_role, ${await hashPassword(PASSWORD)}, false, true)
    RETURNING id
  `);

  const res = await app.inject({
    method: "POST",
    url: "/login",
    headers: { host: STAFF_HOST, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ email, password: PASSWORD }).toString(),
  });

  return {
    cookie: `${COOKIE}=${res.cookies.find((c) => c.name === COOKIE)?.value}`,
    id: (rows[0] as { id: string }).id,
    name: fullName,
  };
}

function get(url: string, cookie: string) {
  return app.inject({ url, headers: { host: STAFF_HOST, cookie } });
}

/**
 * A report as the old model left it: assigned, in progress, and with nothing in `assessments` to
 * say so.
 *
 * `secondaryRow` is what separates this from every other fixture in the suite — leaving it out is
 * the legacy state, and passing true is the same report after its assessor saved a first draft.
 */
async function seedLegacy(over: {
  number: string;
  status?: string;
  assessor1: string;
  assessor2?: string;
  secondaryRow?: boolean;
  firstAssessment?: boolean;
}): Promise<string> {
  const rows = await owner.db.execute(sql`
    INSERT INTO reports (number, channel, severity, status, device_name, form_version, payload,
                         received_at, assessor1_user_id, assessor2_user_id, assessor2_assigned_at)
    VALUES (${over.number}, 'online_form', 'other'::report_severity,
            ${over.status ?? "second_assessment"}::report_status, 'Legacy device', 'F001',
            '{}'::jsonb, '2026-08-01T00:00:00Z'::timestamptz,
            ${over.assessor1}, ${over.assessor2 ?? null},
            ${over.assessor2 === undefined ? sql`NULL` : sql`now()`})
    RETURNING id
  `);
  const id = (rows[0] as { id: string }).id;

  if (over.firstAssessment !== false) {
    await owner.db.execute(sql`
      INSERT INTO assessments (report_id, assessor_id, ordinal, form_version, payload, submitted_at)
      VALUES (${id}, ${over.assessor1}, 1, 'F004', '{}'::jsonb, now())
    `);
  }

  if (over.secondaryRow === true && over.assessor2 !== undefined) {
    await owner.db.execute(sql`
      INSERT INTO assessments (report_id, assessor_id, ordinal, form_version, payload)
      VALUES (${id}, ${over.assessor2}, 2, 'F004', '{}'::jsonb)
    `);
  }

  return id;
}

/** The shipped migration, run as the owner exactly as `drizzle-kit migrate` runs it. */
async function runBackfill(): Promise<void> {
  await owner.db.execute(sql.raw(readFileSync(MIGRATION, "utf8")));
}

type SecondaryRow = {
  ordinal: number;
  assessor_id: string;
  submitted_at: Date | null;
  payload: unknown;
};

async function secondaryRowsOf(reportId: string): Promise<SecondaryRow[]> {
  const rows = await owner.db.execute(sql`
    SELECT ordinal, assessor_id, submitted_at, payload FROM assessments
     WHERE report_id = ${reportId} AND ordinal > 1 ORDER BY ordinal
  `);

  return rows as unknown as SecondaryRow[];
}

describe.skipIf(!INTEGRATION_ENABLED)("the state migration 0013 repairs", () => {
  beforeEach(start);

  it("is invisible to both queues before the backfill, which is the bug", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const first = await signedInAs("assessor", "Asha Mrema");
    const second = await signedInAs("assessor", "Baraka Nyoni");

    await seedLegacy({ number: "MD-AE/2026/7001", assessor1: first.id, assessor2: second.id });

    // The manager sees a report being worked on and the wrong person against it: with no
    // `assessments` row above ordinal 1, the latest assessment on the report still looks
    // like A1.
    const workload = (await get("/workload?stage=secondary-assessment", manager.cookie)).body;
    expect(workload).toContain("<td>A1</td>");
    expect(workload).toContain("<td><span>Asha Mrema</span></td>");
    expect(workload).not.toContain("Baraka Nyoni");

    // The Officer it is actually with is told they have nothing at all.
    const queue = (await get("/assessments", second.cookie)).body;
    expect(queue).toContain('Not started <span class="mya-count">0</span>');
    expect(queue).toContain("Nothing is waiting for you to start.");
  });

  it("gives the report its open assessment row, as a draft at the next ordinal", async () => {
    const first = await signedInAs("assessor", "Asha Mrema");
    const second = await signedInAs("assessor", "Baraka Nyoni");

    const id = await seedLegacy({
      number: "MD-AE/2026/7002",
      assessor1: first.id,
      assessor2: second.id,
    });
    expect(await secondaryRowsOf(id)).toHaveLength(0);

    await runBackfill();

    const rows = await secondaryRowsOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ordinal).toBe(2);
    expect(rows[0]?.assessor_id).toBe(second.id);
    // A draft, never a submission: the Officer has not written anything, and stamping
    // `submitted_at` would invent an assessment and move the report past its own assessor.
    expect(rows[0]?.submitted_at).toBeNull();
    expect(rows[0]?.payload).toEqual({});
  });

  it("names the current secondary assessor on both queues once it has run", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const first = await signedInAs("assessor", "Asha Mrema");
    const second = await signedInAs("assessor", "Baraka Nyoni");

    const id = await seedLegacy({
      number: "MD-AE/2026/7003",
      assessor1: first.id,
      assessor2: second.id,
    });
    await runBackfill();

    // The report is with A2 now, and the manager's row names them rather than the assessor
    // whose turn is over.
    const workload = (await get("/workload?stage=secondary-assessment", manager.cookie)).body;
    expect(workload).toContain("<td>A2</td>");
    expect(workload).toContain("<td><span>Baraka Nyoni</span></td>");

    const queue = (await get("/assessments", second.cookie)).body;
    expect(queue).toContain('Not started <span class="mya-count">1</span>');
    expect(queue).toContain("MD-AE/2026/7003");
    expect(queue).toContain("<td>A2</td>");
    // The way in, at the ordinal that is actually theirs.
    expect(queue).toContain(`href="/reports/${id}/secondary-assessment"`);
    // Still their own work to do, and never yet opened — not something already sent on.
    expect(queue).toContain('<span class="tag muted">Not started</span>');
    expect(queue).not.toContain('<span class="tag muted">Submitted</span>');
  });

  it("leaves the assessor's own way into the form working", async () => {
    const first = await signedInAs("assessor", "Asha Mrema");
    const second = await signedInAs("assessor", "Baraka Nyoni");

    const id = await seedLegacy({
      number: "MD-AE/2026/7004",
      assessor1: first.id,
      assessor2: second.id,
    });
    await runBackfill();

    // It worked before the backfill too, through the legacy fallback in `resolveMine`. The point
    // is that repairing the data did not take it away.
    expect((await get(`/reports/${id}/secondary-assessment`, second.cookie)).statusCode).toBe(200);
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("what migration 0013 must not touch", () => {
  beforeEach(start);

  it("adds nothing on a second run", async () => {
    const first = await signedInAs("assessor", "Asha Mrema");
    const second = await signedInAs("assessor", "Baraka Nyoni");

    const id = await seedLegacy({
      number: "MD-AE/2026/7010",
      assessor1: first.id,
      assessor2: second.id,
    });

    await runBackfill();
    await runBackfill();

    expect(await secondaryRowsOf(id)).toHaveLength(1);
  });

  it("leaves a report whose assessor already opened it exactly as it is", async () => {
    const first = await signedInAs("assessor", "Asha Mrema");
    const second = await signedInAs("assessor", "Baraka Nyoni");

    const id = await seedLegacy({
      number: "MD-AE/2026/7011",
      assessor1: first.id,
      assessor2: second.id,
      secondaryRow: true,
    });

    await runBackfill();

    const rows = await secondaryRowsOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.assessor_id).toBe(second.id);
  });

  it("leaves every status but second_assessment alone", async () => {
    const first = await signedInAs("assessor", "Asha Mrema");
    const second = await signedInAs("assessor", "Baraka Nyoni");

    // `awaiting_decision` with no secondary row would mean a submission nobody made. Inventing one
    // here would hand the manager an assessment to approve that no Officer ever wrote.
    const id = await seedLegacy({
      number: "MD-AE/2026/7012",
      status: "awaiting_decision",
      assessor1: first.id,
      assessor2: second.id,
    });

    await runBackfill();

    expect(await secondaryRowsOf(id)).toHaveLength(0);
  });

  it("refuses to make one Officer both assessors of the same report", async () => {
    const only = await signedInAs("assessor", "Asha Mrema");

    const id = await seedLegacy({
      number: "MD-AE/2026/7013",
      assessor1: only.id,
      assessor2: only.id,
    });

    await runBackfill();

    // The duplicate-assessor rule is not expressible in the schema, so the migration asserts it
    // rather than trusting the old data. A row like this is left for a human to look at.
    expect(await secondaryRowsOf(id)).toHaveLength(0);
  });

  it("does not invent a second assessment where there was never a first", async () => {
    const first = await signedInAs("assessor", "Asha Mrema");
    const second = await signedInAs("assessor", "Baraka Nyoni");

    const id = await seedLegacy({
      number: "MD-AE/2026/7014",
      assessor1: first.id,
      assessor2: second.id,
      firstAssessment: false,
    });

    await runBackfill();

    expect(await secondaryRowsOf(id)).toHaveLength(0);
  });

  it("touches no report that never had a legacy assessor", async () => {
    const first = await signedInAs("assessor", "Asha Mrema");

    const id = await seedLegacy({
      number: "MD-AE/2026/7015",
      status: "awaiting_second_assessor",
      assessor1: first.id,
    });

    await runBackfill();

    expect(await secondaryRowsOf(id)).toHaveLength(0);
  });
});
