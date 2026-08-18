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

type Role = "administrator" | "manager" | "assessor";

let owner: DatabaseHandle;
let app: FastifyInstance;

/** The restricted role, as in the sign-in suite: a missing GRANT must fail here, not in staging. */
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

/**
 * Every seeded account gets an address of its own, for the reason the sign-in suite gives: the
 * per-address rate limit lives in the app instance, which is built once and outlives the truncate.
 */
let seeded = 0;

async function seedStaff(role: Role, attrs: { mustChange?: boolean } = {}): Promise<string> {
  seeded += 1;
  const email = `staff${seeded}@tmda.go.tz`;

  await owner.db.execute(sql`
    INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
    VALUES (
      ${email}, 'Grace Mollel', ${role}::user_role, ${await hashPassword(PASSWORD)},
      ${attrs.mustChange ?? false}, true
    )
  `);

  return email;
}

function signIn(fields: Record<string, string>) {
  return app.inject({
    method: "POST",
    url: "/login",
    headers: { host: STAFF_HOST, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(fields).toString(),
  });
}

/** Seed an account of this role and hand back the Cookie header a signed-in browser would send. */
async function signedInAs(role: Role, attrs: { mustChange?: boolean } = {}): Promise<string> {
  const email = await seedStaff(role, attrs);
  const res = await signIn({ email, password: PASSWORD });

  return `${COOKIE}=${res.cookies.find((c) => c.name === COOKIE)?.value}`;
}

function get(url: string, cookie: string) {
  return app.inject({ url, headers: { host: STAFF_HOST, cookie } });
}

function createUser(cookie: string, fields: Record<string, string>) {
  return app.inject({
    method: "POST",
    url: "/users/new",
    headers: { host: STAFF_HOST, cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(fields).toString(),
  });
}

/** The temp password as the administrator reads it off the success page. */
function shownPassword(body: string): string | undefined {
  return body.match(/<code>([0-9A-Z]{20})<\/code>/)?.[1];
}

function countUsers(): Promise<unknown[]> {
  return owner.db.execute(sql`SELECT id FROM users`);
}

const VALID = { name: "Neema Kileo", email: "neema@tmda.go.tz", role: "manager" };

describe.skipIf(!INTEGRATION_ENABLED)("who may reach the user pages", () => {
  beforeEach(start);

  it("lets an administrator list the staff accounts", async () => {
    const cookie = await signedInAs("administrator");

    const res = await get("/users", cookie);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Staff accounts");
  });

  it("refuses a manager with 403 rather than redirecting them away", async () => {
    const cookie = await signedInAs("manager");

    const list = await get("/users", cookie);
    const form = await get("/users/new", cookie);

    // 403, not 302: they are signed in and settled, so there is nowhere to send them.
    expect(list.statusCode).toBe(403);
    expect(form.statusCode).toBe(403);
    expect(list.body).toContain("Not permitted");
  });

  it("refuses an assessor the same way", async () => {
    const cookie = await signedInAs("assessor");

    expect((await get("/users", cookie)).statusCode).toBe(403);
    expect((await get("/users/new", cookie)).statusCode).toBe(403);
  });

  it("refuses a manager's POST without writing a row", async () => {
    const cookie = await signedInAs("manager");

    const res = await createUser(cookie, VALID);

    expect(res.statusCode).toBe(403);
    // The guard is an onRequest hook, so it answers before the body is even parsed.
    expect(await countUsers()).toHaveLength(1);
  });

  it("turns an anonymous request away at the session guard, not the role guard", async () => {
    const res = await app.inject({ url: "/users", headers: { host: STAFF_HOST } });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
  });

  it("holds an administrator who still owes a password change at that gate", async () => {
    const cookie = await signedInAs("administrator", { mustChange: true });

    const res = await get("/users", cookie);

    // requirePasswordChanged sits above requireRole, so it answers first.
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/change-password");
  });

  it("shows the link to the user pages only to an administrator", async () => {
    const admin = await get("/dashboard", await signedInAs("administrator"));
    const assessor = await get("/dashboard", await signedInAs("assessor"));

    expect(admin.body).toContain('href="/users"');
    expect(assessor.body).not.toContain('href="/users"');
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("creating a staff account", () => {
  beforeEach(start);

  it("creates the account owing a password change and able to sign in", async () => {
    const cookie = await signedInAs("administrator");

    const res = await createUser(cookie, VALID);

    expect(res.statusCode).toBe(200);

    const rows = await owner.db.execute(sql`
      SELECT email, full_name, role, must_change_password, is_active
        FROM users WHERE email = ${VALID.email}
    `);

    expect(rows[0]).toMatchObject({
      email: "neema@tmda.go.tz",
      full_name: "Neema Kileo",
      role: "manager",
      must_change_password: true,
      is_active: true,
    });
  });

  it("shows a temp password that is really the account's password", async () => {
    const cookie = await signedInAs("administrator");

    const created = await createUser(cookie, VALID);
    const password = shownPassword(created.body);
    expect(password).toBeTruthy();

    const res = await signIn({ email: VALID.email, password: password ?? "" });

    // Proves the stored hash matches what was displayed, and that the new account lands on the
    // forced change rather than the dashboard.
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/change-password");
  });

  it("answers 200 in place, so the password never reaches a URL", async () => {
    const cookie = await signedInAs("administrator");

    const res = await createUser(cookie, VALID);
    const password = shownPassword(res.body) ?? "";

    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBeUndefined();
    // Nothing that could carry it into an access log, a history entry, or a Referer header.
    expect(JSON.stringify(res.headers)).not.toContain(password);
  });

  it("puts no hash on the page and no password in the list", async () => {
    const cookie = await signedInAs("administrator");

    const created = await createUser(cookie, VALID);
    const password = shownPassword(created.body) ?? "";
    const list = await get("/users", cookie);

    expect(created.body).not.toContain("$argon2");
    expect(list.body).not.toContain("$argon2");
    // Shown exactly once, on the page that made it, and never recoverable afterwards.
    expect(list.body).not.toContain(password);
    expect(list.body).toContain("neema@tmda.go.tz");
  });

  it("normalizes the address the way sign-in will look it up", async () => {
    const cookie = await signedInAs("administrator");

    await createUser(cookie, { ...VALID, email: "  NEEMA@TMDA.GO.TZ  ", name: "  Neema Kileo  " });

    const rows = await owner.db.execute(
      sql`SELECT email, full_name FROM users ORDER BY created_at`,
    );
    expect(rows[1]).toMatchObject({ email: "neema@tmda.go.tz", full_name: "Neema Kileo" });
  });

  it("records who was created, by whom, and nothing that could be replayed", async () => {
    const cookie = await signedInAs("administrator");

    const created = await createUser(cookie, VALID);
    const password = shownPassword(created.body) ?? "";

    const audit = await owner.db.execute(sql`
      SELECT actor_user_id, action, entity_type, after FROM audit_log WHERE action = 'user.created'
    `);
    const admin = await owner.db.execute(sql`SELECT id FROM users WHERE role = 'administrator'`);

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "user.created",
      entity_type: "user",
      actor_user_id: (admin[0] as { id: string }).id,
      after: { email: "neema@tmda.go.tz", fullName: "Neema Kileo", role: "manager" },
    });

    const trail = JSON.stringify(audit);
    expect(trail).not.toContain("$argon2");
    expect(trail).not.toContain(password);
  });

  it("creates an assessor too", async () => {
    const cookie = await signedInAs("administrator");

    await createUser(cookie, { ...VALID, role: "assessor" });

    const rows = await owner.db.execute(sql`SELECT role FROM users WHERE email = ${VALID.email}`);
    expect(rows[0]).toMatchObject({ role: "assessor" });
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("what the form refuses", () => {
  beforeEach(start);

  it("writes no row when the body asks for an administrator", async () => {
    const cookie = await signedInAs("administrator");

    const res = await createUser(cookie, { ...VALID, role: "administrator" });

    // The role is parsed against a list that does not contain it, so it never reaches the insert.
    expect(res.statusCode).toBe(422);
    expect(await countUsers()).toHaveLength(1);
  });

  it("writes no row for a role that is not a role at all", async () => {
    const cookie = await signedInAs("administrator");

    const res = await createUser(cookie, { ...VALID, role: "superuser" });

    expect(res.statusCode).toBe(422);
    expect(await countUsers()).toHaveLength(1);
  });

  it("refuses a missing role, a missing name and a malformed address", async () => {
    const cookie = await signedInAs("administrator");

    const noRole = await createUser(cookie, { name: VALID.name, email: VALID.email });
    const noName = await createUser(cookie, { ...VALID, name: "   " });
    const badEmail = await createUser(cookie, { ...VALID, email: "not-an-address" });

    expect([noRole.statusCode, noName.statusCode, badEmail.statusCode]).toEqual([422, 422, 422]);
    expect(await countUsers()).toHaveLength(1);
  });

  it("gives back what was typed so a refused form need not be retyped", async () => {
    const cookie = await signedInAs("administrator");

    const res = await createUser(cookie, { ...VALID, role: "administrator" });

    expect(res.body).toContain('value="Neema Kileo"');
    expect(res.body).toContain('value="neema@tmda.go.tz"');
    // The rejected role is not echoed back as a selected option, because the form cannot offer it.
    expect(res.body).not.toContain('value="administrator"');
  });

  it("refuses a duplicate address with 409 rather than a 500", async () => {
    const cookie = await signedInAs("administrator");

    const first = await createUser(cookie, VALID);
    const second = await createUser(cookie, { ...VALID, name: "Someone Else" });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(second.body).toContain("already exists");
    // One administrator plus one Neema. The second attempt left nothing behind.
    expect(await countUsers()).toHaveLength(2);
  });

  it("refuses an address that differs from an existing one only by case", async () => {
    const cookie = await signedInAs("administrator");

    await createUser(cookie, VALID);
    const res = await createUser(cookie, { ...VALID, email: "NEEMA@TMDA.GO.TZ" });

    // Normalization happens before the unique index sees it, so this is the same collision.
    expect(res.statusCode).toBe(409);
    expect(await countUsers()).toHaveLength(2);
  });
});
