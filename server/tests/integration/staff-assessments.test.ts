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
 * The "N assessment(s) assigned to you" summary on /assessments.
 *
 * Must count only `notStarted` — work sitting untouched — and be entirely absent at zero, rather
 * than folding in-progress and submitted work into what reads as a to-do count.
 */

const STAFF_HOST = "staff.test";
const PUBLIC_HOST = "public.test";
const PASSWORD = "a correct staff password";
const COOKIE = "__Host-ae_session";

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

async function signedInAssessor(): Promise<{ id: string; cookie: string }> {
  seeded += 1;
  const email = `mya${seeded}@tmda.go.tz`;

  const rows = await owner.db.execute(sql`
    INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
    VALUES (${email}, 'Officer', 'assessor'::user_role, ${await hashPassword(PASSWORD)}, false, true)
    RETURNING id
  `);
  const id = (rows[0] as { id: string }).id;

  const res = await app.inject({
    method: "POST",
    url: "/login",
    headers: { host: STAFF_HOST, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ email, password: PASSWORD }).toString(),
  });

  return { id, cookie: `${COOKIE}=${res.cookies.find((c) => c.name === COOKIE)?.value}` };
}

let reportSeq = 0;

/** A report assigned to this Officer as A1, with or without an opened/submitted assessment. */
async function seedA1(
  officerId: string,
  state: "not-started" | "in-progress" | "submitted",
): Promise<void> {
  reportSeq += 1;
  const rows = await owner.db.execute(sql`
    INSERT INTO reports (number, channel, severity, status, device_name, form_version, payload,
                         assessor1_user_id, assessor1_assigned_at)
    VALUES (${`MYA/${reportSeq}`}, 'online_form', 'other', 'first_assessment'::report_status,
            'Seeded device', 'F001', '{}'::jsonb, ${officerId}, now())
    RETURNING id
  `);
  const reportId = (rows[0] as { id: string }).id;

  if (state === "not-started") return;

  await owner.db.execute(sql`
    INSERT INTO assessments (report_id, assessor_id, ordinal, form_version, payload, submitted_at)
    VALUES (
      ${reportId}, ${officerId}, 1, 'F004',
      ${state === "submitted" ? sql`'{"c2_5":"answered"}'::jsonb` : sql`'{"c2_5":"draft"}'::jsonb`},
      ${state === "submitted" ? sql`now()` : sql`NULL`}
    )
  `);
}

function get(url: string, cookie: string) {
  return app.inject({ url, headers: { host: STAFF_HOST, cookie } });
}

const SUMMARY_PATTERN = /assessments? assigned to you/;

describe.skipIf(!INTEGRATION_ENABLED)("the My assessments summary sentence", () => {
  beforeEach(start);

  it("shows nothing when there is no work at all", async () => {
    const officer = await signedInAssessor();
    const body = (await get("/assessments", officer.cookie)).body;
    expect(body).not.toMatch(SUMMARY_PATTERN);
  });

  it("says '1 assessment assigned to you' for one not-started assignment", async () => {
    const officer = await signedInAssessor();
    await seedA1(officer.id, "not-started");
    const body = (await get("/assessments", officer.cookie)).body;
    expect(body).toContain("1 assessment assigned to you");
  });

  it("says '3 assessments assigned to you' for three not-started assignments", async () => {
    const officer = await signedInAssessor();
    await seedA1(officer.id, "not-started");
    await seedA1(officer.id, "not-started");
    await seedA1(officer.id, "not-started");
    const body = (await get("/assessments", officer.cookie)).body;
    expect(body).toContain("3 assessments assigned to you");
  });

  it("shows nothing when the only work is in progress", async () => {
    const officer = await signedInAssessor();
    await seedA1(officer.id, "in-progress");
    const body = (await get("/assessments", officer.cookie)).body;
    expect(body).not.toMatch(SUMMARY_PATTERN);
  });

  it("shows nothing when the only work is submitted", async () => {
    const officer = await signedInAssessor();
    await seedA1(officer.id, "submitted");
    const body = (await get("/assessments", officer.cookie)).body;
    expect(body).not.toMatch(SUMMARY_PATTERN);
  });

  it("counts only the not-started one when other states are also present", async () => {
    const officer = await signedInAssessor();
    await seedA1(officer.id, "not-started");
    await seedA1(officer.id, "in-progress");
    await seedA1(officer.id, "in-progress");
    const body = (await get("/assessments", officer.cookie)).body;
    expect(body).toContain("1 assessment assigned to you");
  });
});
