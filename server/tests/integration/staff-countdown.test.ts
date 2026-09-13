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
 * The countdown/deadline display on the Officer's "My assessments" page and the Manager's report
 * page — both built on `Countdown` (views/countdown.tsx), which renders the server's own
 * `deadlineStateOf`/`countdownLabel`. `countdown.js`'s live ticking is a browser behaviour this
 * suite cannot exercise; what it verifies is that the server renders the right state and label,
 * and the right `data-due-at`/`data-completed` for that script to take over from.
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
  const email = `cd-${seeded}@tmda.go.tz`;
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

/** An A1 assessment on its own report, with the given deadline/completion state. */
async function seedFirstAssessment(over: {
  reportNumber: string;
  assessorId: string;
  managerId: string;
  dueAt: string | null;
  submitted?: boolean;
}): Promise<string> {
  const reportId = await seedReport(over.reportNumber);
  await owner.db.execute(sql`
    UPDATE reports SET assessor1_user_id = ${over.assessorId}, assessor1_assigned_at = now()
     WHERE id = ${reportId}
  `);
  await owner.db.execute(sql`
    INSERT INTO assessments (report_id, assessor_id, ordinal, form_version, payload,
                             assigned_by_user_id, assigned_at, deadline_value, deadline_unit, due_at,
                             submitted_at)
    VALUES (${reportId}, ${over.assessorId}, 1, 'TMDA/DMD/MDV/F/004 Rev 05', '{}'::jsonb,
            ${over.managerId}, now(), 3, 'days'::deadline_unit,
            ${over.dueAt === null ? sql`NULL` : sql`${over.dueAt}::timestamptz`},
            ${(over.submitted ?? false) ? sql`now()` : sql`NULL`})
  `);
  return reportId;
}

describe.skipIf(!INTEGRATION_ENABLED)("the deadline countdown", () => {
  beforeEach(start);

  it("shows an on-track countdown for a comfortable deadline, on the Officer's own list", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    await seedFirstAssessment({
      reportNumber: "MD-AE/2026/9101",
      assessorId: officer.id,
      managerId: manager.id,
      dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });

    const body = (await get("/assessments", officer.cookie)).body;

    expect(body).toContain('class="countdown countdown-on-track"');
    expect(body).not.toContain('data-completed="true"');
  });

  it("shows the near-deadline state inside the warning threshold", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    await seedFirstAssessment({
      reportNumber: "MD-AE/2026/9102",
      assessorId: officer.id,
      managerId: manager.id,
      dueAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    });

    const body = (await get("/assessments", officer.cookie)).body;

    expect(body).toContain('class="countdown countdown-near"');
  });

  it("shows the overdue state, with elapsed time, past the deadline", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    await seedFirstAssessment({
      reportNumber: "MD-AE/2026/9103",
      assessorId: officer.id,
      managerId: manager.id,
      dueAt: new Date(Date.now() - (2 * 3_600_000 + 5 * 60_000)).toISOString(),
    });

    const body = (await get("/assessments", officer.cookie)).body;

    expect(body).toContain('class="countdown countdown-overdue"');
    expect(body).toMatch(/OVERDUE.{1,10}2h 0[45]m/);
  });

  it("stops the countdown and shows Completed once submitted, even past its deadline", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    await seedFirstAssessment({
      reportNumber: "MD-AE/2026/9104",
      assessorId: officer.id,
      managerId: manager.id,
      dueAt: new Date(Date.now() - 86_400_000).toISOString(),
      submitted: true,
    });

    const body = (await get("/assessments", officer.cookie)).body;

    expect(body).toContain('class="countdown countdown-completed"');
    expect(body).toContain('data-completed="true"');
    expect(body).not.toContain("OVERDUE");
  });

  it("carries data-due-at for the client script to keep ticking from", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    const dueAt = new Date(Date.now() + 3 * 86_400_000);
    await seedFirstAssessment({
      reportNumber: "MD-AE/2026/9105",
      assessorId: officer.id,
      managerId: manager.id,
      dueAt: dueAt.toISOString(),
    });

    const body = (await get("/assessments", officer.cookie)).body;

    expect(body).toContain(`data-due-at="${dueAt.toISOString()}"`);
    expect(body).toContain('src="/assets/countdown.js"');
  });

  it("shows the same countdown on the Manager's report page", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    const reportId = await seedFirstAssessment({
      reportNumber: "MD-AE/2026/9106",
      assessorId: officer.id,
      managerId: manager.id,
      dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });

    const body = (await get(`/reports/${reportId}`, manager.cookie)).body;

    expect(body).toContain('class="countdown countdown-on-track"');
  });

  it("shows no countdown, only the checkmark, for a report with no deadline recorded", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    await seedFirstAssessment({
      reportNumber: "MD-AE/2026/9107",
      assessorId: officer.id,
      managerId: manager.id,
      dueAt: null,
    });

    const body = (await get("/assessments", officer.cookie)).body;

    expect(body).toContain('class="countdown countdown-none"');
    expect(body).toContain("No deadline");
  });
});
