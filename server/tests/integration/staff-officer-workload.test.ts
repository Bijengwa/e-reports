import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/auth/password.js";
import type { Config } from "../../src/config.js";
import type { DatabaseHandle } from "../../src/db/client.js";
import { buildServer } from "../../src/server.js";
import { INTEGRATION_ENABLED, openOwner, requireTestDatabase, truncateAll } from "./helpers.js";

/**
 * The workload a Manager reads beside each Officer's name when assigning an assessment.
 *
 * Derived entirely from `assessments` — no table of its own — so these cases are about the
 * arithmetic (`officerWorkloadOptions` in `routes/reports.tsx`) and where it surfaces, not about
 * new storage.
 */

const STAFF_HOST = "staff.test";
const PASSWORD = "a correct staff password";
const COOKIE = "__Host-ae_session";

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
    PUBLIC_HOST: "public.test",
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
  const email = `wl-${seeded}@tmda.go.tz`;
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

async function seedReport(number: string): Promise<string> {
  const rows = await owner.db.execute(sql`
    INSERT INTO reports (number, channel, severity, status, device_name, form_version, payload)
    VALUES (${number}, 'online_form', 'other', 'received', 'Seeded device', 'F001', '{}'::jsonb)
    RETURNING id
  `);
  return (rows[0] as { id: string }).id;
}

/** One assessment row on a report of its own, so ordinal collisions never enter into it. */
async function seedAssessment(over: {
  assessorId: string;
  ordinal?: number;
  submitted?: boolean;
  dueInPast?: boolean;
  reportNumber: string;
}): Promise<void> {
  const reportId = await seedReport(over.reportNumber);
  await owner.db.execute(sql`
    INSERT INTO assessments (report_id, assessor_id, ordinal, form_version, payload,
                             assigned_by_user_id, assigned_at, deadline_value, deadline_unit, due_at,
                             submitted_at)
    VALUES (${reportId}, ${over.assessorId}, ${over.ordinal ?? 1}, 'TMDA/DMD/MDV/F/004 Rev 05',
            '{}'::jsonb, ${over.assessorId}, now(), 3, 'days'::deadline_unit,
            now() + INTERVAL '1 day' * (CASE WHEN ${over.dueInPast ?? false} THEN -3 ELSE 3 END),
            ${(over.submitted ?? false) ? sql`now()` : sql`NULL`})
  `);
}

/** Pulls the "Name — active (overdue overdue)" text out of the manager's assign-first-assessor form. */
function optionLine(body: string, name: string): string | undefined {
  const match = body.match(new RegExp(`<option value="[0-9a-f-]+">([^<]*${name}[^<]*)</option>`));
  return match?.[1];
}

describe.skipIf(!INTEGRATION_ENABLED)("officer workload in the assignment picker", () => {
  beforeEach(start);

  it("shows zero for an Officer with nothing assigned", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    await signedInAs("assessor", "Asha Mrema");
    const unclaimed = await seedReport("MD-AE/2026/8801");

    const body = (await get(`/reports/${unclaimed}`, manager.cookie)).body;

    expect(optionLine(body, "Asha Mrema")).toBe("Asha Mrema — 0 (0 overdue)");
  });

  it("counts active assignments not yet overdue", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    await seedAssessment({ assessorId: officer.id, reportNumber: "MD-AE/2026/8802" });
    await seedAssessment({ assessorId: officer.id, reportNumber: "MD-AE/2026/8803" });
    const unclaimed = await seedReport("MD-AE/2026/8804");

    const body = (await get(`/reports/${unclaimed}`, manager.cookie)).body;

    expect(optionLine(body, "Asha Mrema")).toBe("Asha Mrema — 2 (0 overdue)");
  });

  it("counts overdue assignments as both active and overdue", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    await seedAssessment({
      assessorId: officer.id,
      reportNumber: "MD-AE/2026/8805",
      dueInPast: true,
    });
    const unclaimed = await seedReport("MD-AE/2026/8806");

    const body = (await get(`/reports/${unclaimed}`, manager.cookie)).body;

    expect(optionLine(body, "Asha Mrema")).toBe("Asha Mrema — 1 (1 overdue)");
  });

  it("excludes a submitted assessment from the active count, whatever its deadline was", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    // Submitted, and its deadline was in the past — completed late, not overdue.
    await seedAssessment({
      assessorId: officer.id,
      reportNumber: "MD-AE/2026/8807",
      submitted: true,
      dueInPast: true,
    });
    const unclaimed = await seedReport("MD-AE/2026/8808");

    const body = (await get(`/reports/${unclaimed}`, manager.cookie)).body;

    expect(optionLine(body, "Asha Mrema")).toBe("Asha Mrema — 0 (0 overdue)");
  });

  it("sums every ordinal an Officer holds, across every report", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    await seedAssessment({ assessorId: officer.id, ordinal: 1, reportNumber: "MD-AE/2026/8809" });
    await seedAssessment({
      assessorId: officer.id,
      ordinal: 2,
      reportNumber: "MD-AE/2026/8810",
      dueInPast: true,
    });
    await seedAssessment({ assessorId: officer.id, ordinal: 3, reportNumber: "MD-AE/2026/8811" });
    const unclaimed = await seedReport("MD-AE/2026/8812");

    const body = (await get(`/reports/${unclaimed}`, manager.cookie)).body;

    expect(optionLine(body, "Asha Mrema")).toBe("Asha Mrema — 3 (1 overdue)");
  });

  it("lets a manager see the workload figures", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    await signedInAs("assessor", "Asha Mrema");
    const unclaimed = await seedReport("MD-AE/2026/8813");

    const res = await get(`/reports/${unclaimed}`, manager.cookie);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Asha Mrema — 0 (0 overdue)");
  });

  it("never shows workload figures, or the assignment form, to an Officer or an administrator", async () => {
    const officer = await signedInAs("assessor", "Asha Mrema");
    const admin = await signedInAs("administrator", "Adm");
    const target = await signedInAs("assessor", "Baraka Nyoni");
    const unclaimed = await seedReport("MD-AE/2026/8814");

    for (const staff of [officer, admin]) {
      const body = (await get(`/reports/${unclaimed}`, staff.cookie)).body;
      expect(body).not.toContain("assign-first-assessor");
      expect(body).not.toContain(`${target.name} — `);
    }
  });
});
