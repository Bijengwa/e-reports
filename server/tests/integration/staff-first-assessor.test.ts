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
 * The Manager's manual hand-off of Assessment 1.
 *
 * `staff-assignment` pins that intake no longer names an Officer. This is the other half: the one
 * route that may, and the generic `assessments` shape it writes — the same shape `assign-next-
 * assessor` is taught to write for every ordinal after it, in `staff-second-assessor`.
 */

const STAFF_HOST = "staff.test";
const PASSWORD = "a correct staff password";
const COOKIE = "__Host-ae_session";

/** A uuid that is well-formed and names nothing. */
const NOBODY = "00000000-0000-4000-8000-000000000000";

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
  const email = `first-${seeded}@tmda.go.tz`;
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

async function inactiveAssessor(): Promise<string> {
  seeded += 1;
  const rows = await owner.db.execute(sql`
    INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
    VALUES (${`first-${seeded}@tmda.go.tz`}, 'On leave', 'assessor',
            ${await hashPassword(PASSWORD)}, false, false)
    RETURNING id
  `);
  return (rows[0] as { id: string }).id;
}

function get(url: string, cookie: string) {
  return app.inject({ url, headers: { host: STAFF_HOST, cookie } });
}

function post(url: string, cookie: string, form: Record<string, string>) {
  return app.inject({
    method: "POST",
    url,
    headers: { host: STAFF_HOST, cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(form).toString(),
  });
}

async function seedReport(over: {
  number: string;
  status?: string;
  assessor1?: string;
}): Promise<string> {
  const rows = await owner.db.execute(sql`
    INSERT INTO reports (number, channel, severity, status, device_name, form_version, payload,
                         assessor1_user_id, assessor1_assigned_at)
    VALUES (${over.number}, 'online_form', 'other', ${(over.status ?? "received") as string}::report_status,
            'Seeded device', 'F001', '{}'::jsonb,
            ${over.assessor1 ?? null}, ${over.assessor1 ? sql`now()` : sql`NULL`})
    RETURNING id
  `);
  return (rows[0] as { id: string }).id;
}

type ReportRow = {
  id: string;
  status: string;
  assessor1_user_id: string | null;
  assessor1_assigned_at: Date | null;
};

async function reportRow(id: string): Promise<ReportRow> {
  const rows = await owner.db.execute(sql`
    SELECT id, status::text AS status, assessor1_user_id, assessor1_assigned_at
      FROM reports WHERE id = ${id}
  `);
  expect(rows.length).toBe(1);
  return rows[0] as ReportRow;
}

type AssessmentRow = {
  assessor_id: string;
  ordinal: number;
  form_version: string;
  submitted_at: Date | null;
  assigned_by_user_id: string | null;
  assigned_at: Date | null;
  deadline_value: number | null;
  deadline_unit: string | null;
  due_at: Date | null;
};

async function assessmentOne(reportId: string): Promise<AssessmentRow | undefined> {
  const rows = await owner.db.execute(sql`
    SELECT assessor_id, ordinal, form_version, submitted_at, assigned_by_user_id, assigned_at,
           deadline_value, deadline_unit::text AS deadline_unit, due_at
      FROM assessments WHERE report_id = ${reportId} AND ordinal = 1
  `);
  return rows[0] as AssessmentRow | undefined;
}

describe.skipIf(!INTEGRATION_ENABLED)("assigning the first assessor", () => {
  beforeEach(start);

  it("lets a manager assign an unclaimed report, with the default three-day deadline", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    const id = await seedReport({ number: "MD-AE/2026/9001" });

    const before = Date.now();
    const res = await post(`/reports/${id}/assign-first-assessor`, manager.cookie, {
      assessor_id: officer.id,
    });
    const after = Date.now();

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`/reports/${id}`);

    const report = await reportRow(id);
    expect(report.assessor1_user_id).toBe(officer.id);
    expect(report.assessor1_assigned_at).not.toBeNull();

    const assessment = await assessmentOne(id);
    expect(assessment).toBeDefined();
    expect(assessment?.assessor_id).toBe(officer.id);
    expect(assessment?.submitted_at).toBeNull();
    expect(assessment?.assigned_by_user_id).toBe(manager.id);
    expect(assessment?.deadline_value).toBe(3);
    expect(assessment?.deadline_unit).toBe("days");

    const dueAt = new Date(assessment?.due_at as unknown as string).getTime();
    // Three days, give or take the width of this test running.
    expect(dueAt).toBeGreaterThan(before + 3 * 86_400_000 - 5_000);
    expect(dueAt).toBeLessThan(after + 3 * 86_400_000 + 5_000);
  });

  it("honours a deadline the manager chooses instead of the default", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    const id = await seedReport({ number: "MD-AE/2026/9002" });

    const before = Date.now();
    const res = await post(`/reports/${id}/assign-first-assessor`, manager.cookie, {
      assessor_id: officer.id,
      deadline_value: "4",
      deadline_unit: "hours",
    });

    expect(res.statusCode).toBe(302);

    const assessment = await assessmentOne(id);
    expect(assessment?.deadline_value).toBe(4);
    expect(assessment?.deadline_unit).toBe("hours");

    const dueAt = new Date(assessment?.due_at as unknown as string).getTime();
    expect(dueAt).toBeGreaterThan(before + 4 * 3_600_000 - 5_000);
    expect(dueAt).toBeLessThan(before + 4 * 3_600_000 + 5_000);
  });

  it("refuses an Officer and an administrator", async () => {
    const officer = await signedInAs("assessor", "Asha Mrema");
    const admin = await signedInAs("administrator", "Adm");
    const target = await signedInAs("assessor", "Baraka Nyoni");
    const id = await seedReport({ number: "MD-AE/2026/9003" });

    for (const [who, staff] of [
      ["an Officer", officer],
      ["an administrator", admin],
    ] as const) {
      const res = await post(`/reports/${id}/assign-first-assessor`, staff.cookie, {
        assessor_id: target.id,
      });
      expect(res.statusCode, who).toBe(403);
    }

    expect((await reportRow(id)).assessor1_user_id).toBeNull();
  });

  it("refuses a report that is already assigned", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const holder = await signedInAs("assessor", "Asha Mrema");
    const other = await signedInAs("assessor", "Baraka Nyoni");
    const id = await seedReport({ number: "MD-AE/2026/9004", assessor1: holder.id });

    const res = await post(`/reports/${id}/assign-first-assessor`, manager.cookie, {
      assessor_id: other.id,
    });

    expect(res.statusCode).toBe(403);
    expect((await reportRow(id)).assessor1_user_id).toBe(holder.id);
  });

  it("refuses a report that has moved past received", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    const id = await seedReport({ number: "MD-AE/2026/9005", status: "awaiting_second_assessor" });

    const res = await post(`/reports/${id}/assign-first-assessor`, manager.cookie, {
      assessor_id: officer.id,
    });

    expect(res.statusCode).toBe(403);
  });

  it("refuses a deactivated assessor, a non-assessor, and a nonexistent user", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const dormant = await inactiveAssessor();
    const otherManager = await signedInAs("manager", "Second Manager");
    const id = await seedReport({ number: "MD-AE/2026/9006" });

    for (const [who, assessorId] of [
      ["a deactivated Officer", dormant],
      ["another manager", otherManager.id],
      ["nobody", NOBODY],
    ] as const) {
      const res = await post(`/reports/${id}/assign-first-assessor`, manager.cookie, {
        assessor_id: assessorId,
      });
      expect(res.statusCode, who).toBe(403);
    }

    expect((await reportRow(id)).assessor1_user_id).toBeNull();
  });

  it("rejects a deadline of zero, a negative value, and a fractional one", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    const id = await seedReport({ number: "MD-AE/2026/9007" });

    for (const bad of ["0", "-1", "1.5", "not-a-number"]) {
      const res = await post(`/reports/${id}/assign-first-assessor`, manager.cookie, {
        assessor_id: officer.id,
        deadline_value: bad,
      });
      expect(res.statusCode, bad).toBe(422);
    }

    expect((await reportRow(id)).assessor1_user_id).toBeNull();
  });

  it("rejects a deadline unit outside the fixed list", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    const id = await seedReport({ number: "MD-AE/2026/9008" });

    const res = await post(`/reports/${id}/assign-first-assessor`, manager.cookie, {
      assessor_id: officer.id,
      deadline_unit: "months",
    });

    expect(res.statusCode).toBe(422);
    expect((await reportRow(id)).assessor1_user_id).toBeNull();
  });

  it("offers the form only to a manager, and only while unclaimed", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    const unclaimed = await seedReport({ number: "MD-AE/2026/9009" });
    const claimed = await seedReport({ number: "MD-AE/2026/9010", assessor1: officer.id });

    const unclaimedPage = (await get(`/reports/${unclaimed}`, manager.cookie)).body;
    expect(unclaimedPage).toContain(`action="/reports/${unclaimed}/assign-first-assessor"`);

    const claimedPage = (await get(`/reports/${claimed}`, manager.cookie)).body;
    expect(claimedPage).not.toContain("assign-first-assessor");

    const officerPage = (await get(`/reports/${unclaimed}`, officer.cookie)).body;
    expect(officerPage).not.toContain("assign-first-assessor");
  });

  it("does not disturb the assignment once the Officer starts saving a draft", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");
    const id = await seedReport({ number: "MD-AE/2026/9011" });

    await post(`/reports/${id}/assign-first-assessor`, manager.cookie, { assessor_id: officer.id });
    const assigned = await assessmentOne(id);

    await post(`/reports/${id}/assessment-1`, officer.cookie, {
      intent: "save",
      conclusion: "Half written.",
    });

    const afterDraft = await assessmentOne(id);
    expect(afterDraft?.assigned_by_user_id).toBe(assigned?.assigned_by_user_id);
    expect(afterDraft?.deadline_value).toBe(assigned?.deadline_value);
    expect(afterDraft?.deadline_unit).toBe(assigned?.deadline_unit);
    expect(new Date(afterDraft?.due_at as unknown as string).getTime()).toBe(
      new Date(assigned?.due_at as unknown as string).getTime(),
    );
    expect(afterDraft?.submitted_at).toBeNull();
  });
});
