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

const STAFF_HOST = "staff.test";
const PUBLIC_HOST = "public.test";
const PASSWORD = "a correct staff password";
const COOKIE = "__Host-ae_session";

const ABSENT_ID = "00000000-0000-4000-8000-000000000000";
const NUMBER = "MD-AE/2026/0179";

/** The least trusted text in the system: a value that arrived from the anonymous public form. */
const HOSTILE = "<script>alert(1)</script>";

type Role = "administrator" | "manager" | "assessor";

let owner: DatabaseHandle;
let app: FastifyInstance;

/**
 * The server under test connects as the restricted role.
 *
 * That is what makes this suite worth running: migration 0005 grants ereports_app SELECT on
 * `reports`, and a missing grant shows up here as a 500 over 42501 rather than in the container.
 */
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

/** A fresh address per account, so the per-address sign-in limit cannot bite mid-file. */
let seeded = 0;

async function signedInAs(role: Role, name = "Grace Mollel"): Promise<string> {
  seeded += 1;
  const email = `reports${seeded}@tmda.go.tz`;

  await owner.db.execute(sql`
    INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
    VALUES (${email}, ${name}, ${role}::user_role, ${await hashPassword(PASSWORD)}, false, true)
  `);

  const res = await app.inject({
    method: "POST",
    url: "/login",
    headers: { host: STAFF_HOST, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ email, password: PASSWORD }).toString(),
  });

  return `${COOKIE}=${res.cookies.find((c) => c.name === COOKIE)?.value}`;
}

/**
 * A report shaped like one the orange form writes, with hostile text in every free field.
 *
 * Seeded as the owner rather than through the form: this slice reads, and the write path is not
 * under test here.
 */
async function seedReport(attrs: { number?: string } = {}): Promise<string> {
  const rows = await owner.db.execute(sql`
    INSERT INTO reports (number, channel, severity, status, device_name, facility, reporter_name,
                         form_version, payload)
    VALUES (
      ${attrs.number ?? NUMBER}, 'online_form', 'death', 'received', ${HOSTILE},
      'Muhimbili National Hospital', ${HOSTILE}, 'TMDA/DMD/MDV/F/001 Rev 06',
      ${JSON.stringify({ device_name: HOSTILE, events: ["death"], nested: { note: HOSTILE } })}::jsonb
    )
    RETURNING id
  `);

  return (rows[0] as { id: string }).id;
}

function get(url: string, cookie: string) {
  return app.inject({ url, headers: { host: STAFF_HOST, cookie } });
}

function act(url: string, cookie: string) {
  return app.inject({ method: "POST", url, headers: { host: STAFF_HOST, cookie } });
}

async function idOf(role: Role): Promise<string> {
  const rows = await owner.db.execute(sql`
    SELECT id FROM users WHERE role = ${role}::user_role ORDER BY created_at DESC LIMIT 1
  `);
  return (rows[0] as { id: string }).id;
}

const EVERY_ROLE: Role[] = ["administrator", "manager", "assessor"];

describe.skipIf(!INTEGRATION_ENABLED)("the register", () => {
  beforeEach(start);

  it("lists a report for every signed-in role", async () => {
    const id = await seedReport();

    for (const role of EVERY_ROLE) {
      const res = await get("/reports", await signedInAs(role));

      // A 500 here is the shape a missing GRANT takes, so the status is the 42501 check.
      expect(res.statusCode, role).toBe(200);
      expect(res.body).toContain(NUMBER);
      expect(res.body).toContain("Muhimbili National Hospital");
      expect(res.body).toContain(`/reports/${id}`);
    }
  });

  it("opens a report for every signed-in role", async () => {
    const id = await seedReport();

    for (const role of EVERY_ROLE) {
      const res = await get(`/reports/${id}`, await signedInAs(role));

      expect(res.statusCode, role).toBe(200);
      expect(res.body).toContain(NUMBER);
      expect(res.body).toContain("TMDA/DMD/MDV/F/001 Rev 06");
    }
  });

  it("captions the enums rather than printing their stored values", async () => {
    const id = await seedReport();
    const cookie = await signedInAs("manager");

    const body = (await get(`/reports/${id}`, cookie)).body;

    expect(body).toContain("Death");
    expect(body).toContain("Online form");
    expect(body).toContain("Received");
    expect(body).not.toContain("online_form");
  });

  it("escapes every value the public form supplied", async () => {
    const id = await seedReport();
    const cookie = await signedInAs("assessor");

    const body = (await get(`/reports/${id}`, cookie)).body;

    // The payload reaches the page — a report is evidence and must not be silently dropped — but
    // only ever as text. `<` is escaped, which is what stops it opening an element.
    expect(body).toContain("&lt;script");
    expect(body).not.toContain("<script>alert(1)</script>");
    // Nested values and array members are flattened rather than skipped.
    expect(body).toContain("nested");
    expect(body).toContain("events");
  });

  it("keeps the payload out of the list", async () => {
    await seedReport();
    const cookie = await signedInAs("manager");

    const body = (await get("/reports", cookie)).body;

    // `nested` exists only inside the payload, which the list does not select — so no key from
    // inside the document can reach this page. The device name is a column and does appear, which
    // is why it is asserted escaped rather than absent.
    expect(body).not.toContain("nested");
    expect(body).toContain("&lt;script");
    expect(body).not.toContain("<script>alert(1)</script>");
  });

  it("puts the newest first", async () => {
    await seedReport({ number: "MD-AE/2026/0001" });
    await owner.db.execute(sql`UPDATE reports SET received_at = now() - INTERVAL '2 days'`);
    await seedReport({ number: "MD-AE/2026/0002" });

    const body = (await get("/reports", await signedInAs("manager"))).body;

    expect(body.indexOf("MD-AE/2026/0002")).toBeLessThan(body.indexOf("MD-AE/2026/0001"));
  });

  it("answers 404 for a stale link and a malformed one, over the real register", async () => {
    await seedReport();
    const cookie = await signedInAs("manager");

    for (const url of [`/reports/${ABSENT_ID}`, "/reports/not-a-uuid"]) {
      const res = await get(url, cookie);

      expect(res.statusCode, url).toBe(404);
      expect(res.body).toContain("does not exist");
      // Not an empty table claiming the register is empty.
      expect(res.body).toContain(NUMBER);
    }
  });

  it("turns an anonymous request away at the session guard", async () => {
    const res = await app.inject({ url: "/reports", headers: { host: STAFF_HOST } });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
  });

  it("offers Reports in the rail to every role", async () => {
    for (const role of EVERY_ROLE) {
      const body = (await get("/dashboard", await signedInAs(role))).body;

      expect(body, role).toContain('href="/reports"');
    }
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("the dashboard", () => {
  beforeEach(start);

  it("counts the register for everyone and the staff only for an administrator", async () => {
    await seedReport();

    const admin = (await get("/dashboard", await signedInAs("administrator"))).body;
    const officer = (await get("/dashboard", await signedInAs("assessor"))).body;

    expect(admin).toContain("in the register");
    expect(admin).toContain("active accounts");

    expect(officer).toContain("in the register");
    expect(officer).not.toContain("active accounts");
  });

  it("tells a manager and an officer the truth about their own work", async () => {
    const officer = (await get("/dashboard", await signedInAs("assessor"))).body;
    const manager = (await get("/dashboard", await signedInAs("manager"))).body;

    for (const body of [officer, manager]) {
      expect(body).toContain("Your own work arrives in a later slice");
      expect(body).not.toContain("Recent activity");
    }
  });

  it("shows an administrator the last few things that happened", async () => {
    const cookie = await signedInAs("administrator");

    const body = (await get("/dashboard", cookie)).body;

    expect(body).toContain("Recent activity");
    expect(body).toContain("Signed in");
    expect(body).toContain('href="/activity"');
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("what a role is called", () => {
  beforeEach(start);

  it("calls an assessor an Officer wherever the role is printed", async () => {
    const admin = await signedInAs("administrator");
    await signedInAs("assessor", "Neema Kileo");

    const list = (await get("/users", admin)).body;
    const form = (await get("/users/new", admin)).body;

    expect(list).toContain("Officer");
    expect(list).not.toContain(">assessor<");
    // The create form offers the caption while the value it posts stays the database's.
    expect(form).toContain(">Officer<");
    expect(form).toContain('value="assessor"');
  });

  it("calls it Officer on the officer's own dashboard", async () => {
    const body = (await get("/dashboard", await signedInAs("assessor"))).body;

    expect(body).toContain("Officer");
    expect(body).not.toContain(">assessor<");
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("how the trail reads", () => {
  beforeEach(start);

  it("names the actor's role", async () => {
    const cookie = await signedInAs("administrator");

    const body = (await get("/activity", cookie)).body;

    expect(body).toContain("<th>Role</th>");
    expect(body).toContain("Administrator");
  });

  it("tints an ordinary action safe and an account-taking one caution", async () => {
    const admin = await signedInAs("administrator");
    await signedInAs("assessor");

    await act(`/users/${await idOf("assessor")}/deactivate`, admin);

    const body = (await get("/activity", admin)).body;

    // A sign-in is ordinary; a deactivation takes an account away from its owner.
    expect(body).toContain('class="tone-safe"');
    expect(body).toContain('class="tone-caution"');
    // Two tones and no third, alarming one: audit_log holds actions that succeeded.
    expect(body).not.toContain("tone-threat");
    expect(body).not.toContain("tone-danger");
  });

  it("tints a password reset caution", async () => {
    const admin = await signedInAs("administrator");
    await signedInAs("manager");

    await act(`/users/${await idOf("manager")}/reset`, admin);

    const body = (await get("/activity", admin)).body;
    const upToReset = body.slice(0, body.indexOf("Password reset"));

    // The row this caption sits in is the last one opened before it.
    expect(upToReset.lastIndexOf("tone-caution")).toBeGreaterThan(
      upToReset.lastIndexOf("tone-safe"),
    );
  });
});
