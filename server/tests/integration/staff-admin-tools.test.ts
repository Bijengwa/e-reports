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

/** A uuid that is syntactically fine and names nobody. */
const ABSENT_ID = "00000000-0000-4000-8000-000000000000";

type Role = "administrator" | "manager" | "assessor";

let owner: DatabaseHandle;
let app: FastifyInstance;

/** The restricted role, as in the other suites: a missing GRANT must fail here, not in staging. */
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
 * Every seeded account gets an address of its own.
 *
 * Sign-in is rate limited per address per source and that counter lives in the app instance, which
 * is built once for the file and outlives `truncateAll`. Reusing an address would exhaust the
 * bucket partway through and fail later cases with 429s that look like broken authorization.
 */
let seeded = 0;

async function seed(role: Role, name = "Grace Mollel"): Promise<{ id: string; email: string }> {
  seeded += 1;
  const email = `tools${seeded}@tmda.go.tz`;

  const rows = await owner.db.execute(sql`
    INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
    VALUES (${email}, ${name}, ${role}::user_role, ${await hashPassword(PASSWORD)}, false, true)
    RETURNING id
  `);

  return { id: (rows[0] as { id: string }).id, email };
}

async function cookieFor(email: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/login",
    headers: { host: STAFF_HOST, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ email, password: PASSWORD }).toString(),
  });

  return `${COOKIE}=${res.cookies.find((c) => c.name === COOKIE)?.value}`;
}

/** Seed an account of this role, sign it in, and hand back both the row and its cookie. */
async function signedInAs(
  role: Role,
  name?: string,
): Promise<{ id: string; email: string; cookie: string }> {
  const user = await seed(role, name);
  return { ...user, cookie: await cookieFor(user.email) };
}

function get(url: string, cookie: string) {
  return app.inject({ url, headers: { host: STAFF_HOST, cookie } });
}

function act(url: string, cookie: string) {
  return app.inject({ method: "POST", url, headers: { host: STAFF_HOST, cookie } });
}

/** The temp password as the administrator reads it off the response. */
function shownPassword(body: string): string | undefined {
  return body.match(/<code>([0-9A-Z]{20})<\/code>/)?.[1];
}

function sessionsOf(userId: string): Promise<unknown[]> {
  return owner.db.execute(sql`SELECT id FROM sessions WHERE user_id = ${userId}`);
}

describe.skipIf(!INTEGRATION_ENABLED)("resetting another user's password", () => {
  beforeEach(start);

  it("issues a temp password, raises the flag and ends every session on the account", async () => {
    const admin = await signedInAs("administrator");
    const target = await signedInAs("assessor");

    const res = await act(`/users/${target.id}/reset`, admin.cookie);

    expect(res.statusCode).toBe(200);
    expect(shownPassword(res.body)).toBeTruthy();

    const rows = await owner.db.execute(sql`
      SELECT must_change_password FROM users WHERE id = ${target.id}
    `);
    expect(rows[0]).toMatchObject({ must_change_password: true });
    expect(await sessionsOf(target.id)).toHaveLength(0);
  });

  it("kills the cookie the target was holding across the reset", async () => {
    const admin = await signedInAs("administrator");
    const target = await signedInAs("assessor");

    // Live before, dead after: the reset is not merely a new password, it is an eviction.
    expect((await get("/dashboard", target.cookie)).statusCode).toBe(200);

    await act(`/users/${target.id}/reset`, admin.cookie);

    const after = await get("/dashboard", target.cookie);
    expect(after.statusCode).toBe(302);
    expect(after.headers.location).toBe("/");
  });

  it("shows a password the target can actually sign in with", async () => {
    const admin = await signedInAs("administrator");
    const target = await signedInAs("assessor");

    const res = await act(`/users/${target.id}/reset`, admin.cookie);
    const password = shownPassword(res.body) ?? "";

    const signedIn = await app.inject({
      method: "POST",
      url: "/login",
      headers: { host: STAFF_HOST, "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ email: target.email, password }).toString(),
    });

    // Straight to the forced change: a reset password is a handover, not a working credential.
    expect(signedIn.statusCode).toBe(303);
    expect(signedIn.headers.location).toBe("/change-password");
  });

  it("keeps the password out of the URL, the list and the trail", async () => {
    const admin = await signedInAs("administrator");
    const target = await signedInAs("assessor");

    const res = await act(`/users/${target.id}/reset`, admin.cookie);
    const password = shownPassword(res.body) ?? "";

    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBeUndefined();
    expect(JSON.stringify(res.headers)).not.toContain(password);
    expect(res.body).not.toContain("$argon2");

    const list = await get("/users", admin.cookie);
    expect(list.body).not.toContain(password);
    expect(list.body).not.toContain("$argon2");

    const audit = await owner.db.execute(sql`SELECT after FROM audit_log`);
    const trail = JSON.stringify(audit);
    expect(trail).not.toContain(password);
    expect(trail).not.toContain("$argon2");
  });

  it("records the administrator as the actor, unlike the CLI", async () => {
    const admin = await signedInAs("administrator");
    const target = await signedInAs("assessor");

    await act(`/users/${target.id}/reset`, admin.cookie);

    const audit = await owner.db.execute(sql`
      SELECT actor_user_id, entity_id, after FROM audit_log WHERE action = 'user.password_reset'
    `);

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_user_id: admin.id,
      entity_id: target.id,
      after: { email: target.email },
    });
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("deactivating and reactivating", () => {
  beforeEach(start);

  it("turns the account off, ends its sessions and returns to the list", async () => {
    const admin = await signedInAs("administrator");
    const target = await signedInAs("manager");

    const res = await act(`/users/${target.id}/deactivate`, admin.cookie);

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/users");

    const rows = await owner.db.execute(sql`SELECT is_active FROM users WHERE id = ${target.id}`);
    expect(rows[0]).toMatchObject({ is_active: false });
    expect(await sessionsOf(target.id)).toHaveLength(0);
  });

  it("does not restore the old cookie when the account comes back", async () => {
    const admin = await signedInAs("administrator");
    const target = await signedInAs("manager");

    await act(`/users/${target.id}/deactivate`, admin.cookie);
    await act(`/users/${target.id}/reactivate`, admin.cookie);

    const rows = await owner.db.execute(sql`SELECT is_active FROM users WHERE id = ${target.id}`);
    expect(rows[0]).toMatchObject({ is_active: true });

    // The account works again; the cookie it held before does not. Deleting the rows is what
    // makes that true — the is_active test in loadSession alone would have let it back in.
    const after = await get("/dashboard", target.cookie);
    expect(after.statusCode).toBe(302);
    expect(await sessionsOf(target.id)).toHaveLength(0);
  });

  it("lets a reactivated account back in through the front door", async () => {
    const admin = await signedInAs("administrator");
    const target = await signedInAs("manager");

    await act(`/users/${target.id}/deactivate`, admin.cookie);
    await act(`/users/${target.id}/reactivate`, admin.cookie);

    expect((await get("/dashboard", await cookieFor(target.email))).statusCode).toBe(200);
  });

  it("records both directions with the administrator as actor", async () => {
    const admin = await signedInAs("administrator");
    const target = await signedInAs("manager");

    await act(`/users/${target.id}/deactivate`, admin.cookie);
    await act(`/users/${target.id}/reactivate`, admin.cookie);

    const audit = await owner.db.execute(sql`
      SELECT actor_user_id, action FROM audit_log
       WHERE action IN ('user.deactivated', 'user.reactivated') ORDER BY id
    `);

    expect(audit.map((row) => (row as { action: string }).action)).toEqual([
      "user.deactivated",
      "user.reactivated",
    ]);
    expect(audit[0]).toMatchObject({ actor_user_id: admin.id });
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("what an administrator may not do", () => {
  beforeEach(start);

  it("refuses to reset or deactivate the administrator's own account", async () => {
    const admin = await signedInAs("administrator");

    const reset = await act(`/users/${admin.id}/reset`, admin.cookie);
    const off = await act(`/users/${admin.id}/deactivate`, admin.cookie);

    expect(reset.statusCode).toBe(403);
    expect(off.statusCode).toBe(403);

    const rows = await owner.db.execute(sql`
      SELECT is_active, must_change_password FROM users WHERE id = ${admin.id}
    `);
    expect(rows[0]).toMatchObject({ is_active: true, must_change_password: false });
    // Still signed in: refusing the action must not have ended their own session either.
    expect(await sessionsOf(admin.id)).toHaveLength(1);
  });

  it("offers no buttons on the administrator's own row, and marks it", async () => {
    const admin = await signedInAs("administrator");
    const target = await seed("assessor");

    const list = await get("/users", admin.cookie);

    expect(list.body).toContain(">You<");
    expect(list.body).not.toContain(`/users/${admin.id}/reset`);
    expect(list.body).not.toContain(`/users/${admin.id}/deactivate`);
    // Somebody else's row still carries them, so the absence above is about identity, not layout.
    expect(list.body).toContain(`/users/${target.id}/reset`);
  });

  it("refuses to reset a deactivated account, as the CLI does", async () => {
    const admin = await signedInAs("administrator");
    const target = await seed("assessor");

    await act(`/users/${target.id}/deactivate`, admin.cookie);
    const res = await act(`/users/${target.id}/reset`, admin.cookie);

    expect(res.statusCode).toBe(409);
    expect(res.body).toContain("Reactivate it before resetting");

    const rows = await owner.db.execute(sql`
      SELECT must_change_password FROM users WHERE id = ${target.id}
    `);
    // The refusal wrote nothing: no new hash, no raised flag.
    expect(rows[0]).toMatchObject({ must_change_password: false });
  });

  it("offers reactivate rather than reset once an account is off", async () => {
    const admin = await signedInAs("administrator");
    const target = await seed("assessor");

    await act(`/users/${target.id}/deactivate`, admin.cookie);
    const list = await get("/users", admin.cookie);

    expect(list.body).toContain(`/users/${target.id}/reactivate`);
    expect(list.body).not.toContain(`/users/${target.id}/reset`);
  });

  it("answers 404 for an account that is not there, and for an id that is not one", async () => {
    const admin = await signedInAs("administrator");

    // A malformed id must not reach the query: users.id is a uuid column, and comparing it
    // against arbitrary text would raise 22P02 and surface as a 500.
    for (const url of [
      `/users/${ABSENT_ID}/reset`,
      `/users/${ABSENT_ID}/deactivate`,
      "/users/not-a-uuid/reset",
      "/users/not-a-uuid/deactivate",
      "/users/not-a-uuid/reactivate",
    ]) {
      expect((await act(url, admin.cookie)).statusCode).toBe(404);
    }
  });

  it("refuses a manager and an assessor every one of these actions", async () => {
    const admin = await signedInAs("administrator");
    const target = await seed("assessor");

    for (const role of ["manager", "assessor"] as const) {
      const { cookie } = await signedInAs(role);

      expect((await act(`/users/${target.id}/reset`, cookie)).statusCode).toBe(403);
      expect((await act(`/users/${target.id}/deactivate`, cookie)).statusCode).toBe(403);
      expect((await act(`/users/${target.id}/reactivate`, cookie)).statusCode).toBe(403);
    }

    // Nothing happened to the target, and the administrator's own view still works.
    const rows = await owner.db.execute(sql`
      SELECT is_active, must_change_password FROM users WHERE id = ${target.id}
    `);
    expect(rows[0]).toMatchObject({ is_active: true, must_change_password: false });
    expect((await get("/users", admin.cookie)).statusCode).toBe(200);
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("the activity trail", () => {
  beforeEach(start);

  it("reports account actions with actor and target", async () => {
    const admin = await signedInAs("administrator");
    const target = await seed("assessor", "Neema Kileo");

    await act(`/users/${target.id}/deactivate`, admin.cookie);

    const res = await get("/activity", admin.cookie);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Account deactivated");
    expect(res.body).toContain("Signed in");
    expect(res.body).toContain(admin.email);
    expect(res.body).toContain("Neema Kileo");
  });

  it("names the CLI as the actor when there is no account behind an action", async () => {
    const admin = await signedInAs("administrator");
    const target = await seed("assessor");

    // Exactly what `reset-password` writes: no actor, because whoever ran it holds DATABASE_URL.
    await owner.db.execute(sql`
      INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
      VALUES (
        NULL, 'user.password_reset', 'user', ${target.id},
        ${JSON.stringify({ email: target.email })}::jsonb
      )
    `);

    expect((await get("/activity", admin.cookie)).body).toContain("System (CLI)");
  });

  it("keeps the record of where the first administrator came from", async () => {
    const admin = await signedInAs("administrator");

    await owner.db.execute(sql`
      INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id)
      VALUES (NULL, 'user.bootstrap_created', 'user', ${admin.id})
    `);

    expect((await get("/activity", admin.cookie)).body).toContain("First administrator created");
  });

  it("shows no payload, no hash and no cookie", async () => {
    const admin = await signedInAs("administrator");
    const target = await seed("assessor");

    await act(`/users/${target.id}/reset`, admin.cookie);

    const res = await get("/activity", admin.cookie);

    // `before` and `after` are never selected, so nothing an action recorded can appear here.
    expect(res.body).not.toContain("$argon2");
    expect(res.body).not.toContain(COOKIE);
    expect(res.body).not.toContain("fullName");
  });

  it("leaves out anything that is not an account action", async () => {
    const admin = await signedInAs("administrator");

    await owner.db.execute(sql`
      INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id)
      VALUES (${admin.id}, 'report.opened', 'report', ${ABSENT_ID})
    `);

    expect((await get("/activity", admin.cookie)).body).not.toContain("report.opened");
  });

  it("puts the newest first", async () => {
    const admin = await signedInAs("administrator");

    await owner.db.execute(sql`
      INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, at)
      VALUES (${admin.id}, 'user.deactivated', 'user', ${admin.id}, now() - INTERVAL '1 day')
    `);
    await owner.db.execute(sql`
      INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, at)
      VALUES (${admin.id}, 'user.reactivated', 'user', ${admin.id}, now())
    `);

    const body = (await get("/activity", admin.cookie)).body;

    expect(body.indexOf("Account reactivated")).toBeLessThan(body.indexOf("Account deactivated"));
  });

  it("stops at two hundred rows", async () => {
    const admin = await signedInAs("administrator");

    await owner.db.execute(sql`
      INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id)
      SELECT ${admin.id}, 'user.signed_in', 'user', ${admin.id} FROM generate_series(1, 250)
    `);

    const body = (await get("/activity", admin.cookie)).body;

    // One header row plus at most two hundred entries. Counting the opening tag rather than a
    // bare `<tr>`, because every entry row now carries a tone class.
    expect((body.match(/<tr[ >]/g) ?? []).length).toBe(201);
  });

  it("refuses a manager and an assessor", async () => {
    const manager = await signedInAs("manager");
    const assessor = await signedInAs("assessor");

    expect((await get("/activity", manager.cookie)).statusCode).toBe(403);
    expect((await get("/activity", assessor.cookie)).statusCode).toBe(403);
  });

  it("offers the rail's administrator entries to an administrator and nobody else", async () => {
    const admin = await signedInAs("administrator");
    const assessor = await signedInAs("assessor");

    const forAdmin = await get("/dashboard", admin.cookie);
    const forAssessor = await get("/dashboard", assessor.cookie);

    expect(forAdmin.body).toContain('href="/users"');
    expect(forAdmin.body).toContain('href="/activity"');

    expect(forAssessor.body).not.toContain('href="/users"');
    expect(forAssessor.body).not.toContain('href="/activity"');
    // Everyone still gets the rail itself, and the way out of it.
    expect(forAssessor.body).toContain('href="/dashboard"');
    // A link the script turns into a dialog. The href matters on its own: with scripting off it
    // still reaches a page that asks, so the control is never dead.
    expect(forAssessor.body).toContain('href="/logout"');
    expect(forAssessor.body).toContain("data-signout");
  });

  it("carries the sign-out confirmation on the page, with a destructive-looking answer", async () => {
    const { cookie } = await signedInAs("manager");

    const body = (await get("/dashboard", cookie)).body;

    // Rendered closed — <dialog> hides itself — so nothing flashes before the script runs.
    expect(body).toContain("data-signout-dialog");
    expect(body).toContain("Sign out?");
    // Ending a session is not the app's "go on" action, so its button is not the green one.
    expect(body).toContain('class="btn danger"');
    // Cancel closes the dialog without submitting, which needs no script of its own.
    expect(body).toContain('formmethod="dialog"');
  });
});
