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
const NEW_PASSWORD = "a brand new long password";
const COOKIE = "__Host-ae_session";

let owner: DatabaseHandle;
let app: FastifyInstance;

/**
 * The server under test connects as the restricted role, not the owner.
 *
 * Running it as the owner would exercise a superset of production's privileges and prove nothing
 * about them — the suite would pass while a missing GRANT broke the container. A `42501
 * permission denied for table sessions` here means migration 0004 has not reached ereports_test;
 * apply it with the owner URL rather than pointing this at the owner.
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

/** One place closes both handles, once, after every suite in the file. */
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
 * Sign-in is rate limited at ten attempts per address per source, and that counter lives in the
 * app instance rather than the database — `truncateAll` does not reset it, and the app is built
 * once for the file. Reusing one address across suites would exhaust the bucket partway through
 * and fail later cases with 429s that look like broken authentication.
 */
let seeded = 0;

async function seedStaff(attrs: { mustChange: boolean; isActive?: boolean }) {
  seeded += 1;
  const email = `staff${seeded}@tmda.go.tz`;

  const rows = await owner.db.execute(sql`
    INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
    VALUES (
      ${email}, 'Grace Mollel', 'assessor', ${await hashPassword(PASSWORD)},
      ${attrs.mustChange}, ${attrs.isActive ?? true}
    )
    RETURNING id
  `);

  return { id: (rows[0] as { id: string }).id, email };
}

function signIn(fields: Record<string, string>) {
  return app.inject({
    method: "POST",
    url: "/login",
    headers: { host: STAFF_HOST, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(fields).toString(),
  });
}

function tokenOf(res: { cookies: Array<{ name: string; value: string }> }): string | undefined {
  return res.cookies.find((c) => c.name === COOKIE)?.value;
}

/** Sign in and hand back the Cookie header a browser would send afterwards. */
async function signedInCookie(email: string): Promise<string> {
  return `${COOKIE}=${tokenOf(await signIn({ email, password: PASSWORD }))}`;
}

function get(url: string, cookie?: string) {
  return app.inject({
    url,
    headers: cookie ? { host: STAFF_HOST, cookie } : { host: STAFF_HOST },
  });
}

function changePassword(cookie: string, fields: Record<string, string>) {
  return app.inject({
    method: "POST",
    url: "/change-password",
    headers: { host: STAFF_HOST, cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(fields).toString(),
  });
}

describe.skipIf(!INTEGRATION_ENABLED)("staff sign-in", () => {
  beforeEach(start);

  it("signs a settled user in and lands them on the dashboard", async () => {
    const { email } = await seedStaff({ mustChange: false });

    const res = await signIn({ email, password: PASSWORD });

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/dashboard");
  });

  it("stores only the hash of the token it put in the cookie", async () => {
    const { email } = await seedStaff({ mustChange: false });

    const token = tokenOf(await signIn({ email, password: PASSWORD }));
    const rows = await owner.db.execute(sql`SELECT token_hash FROM sessions`);
    const stored = (rows[0] as { token_hash: string }).token_hash;

    expect(token).toBeTruthy();
    expect(stored).not.toBe(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sets a cookie the __Host- prefix will actually accept", async () => {
    const { email } = await seedStaff({ mustChange: false });

    const res = await signIn({ email, password: PASSWORD });
    const header = [res.headers["set-cookie"]].flat().join("\n");

    expect(header).toContain(`${COOKIE}=`);
    expect(header).toContain("Path=/");
    expect(header).toContain("Secure");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    // A Domain attribute would both void the prefix and let the cookie reach the public door.
    expect(header).not.toContain("Domain=");
  });

  it("puts nothing but an opaque token in the cookie", async () => {
    const { id, email } = await seedStaff({ mustChange: false });

    const token = tokenOf(await signIn({ email, password: PASSWORD })) ?? "";
    const decoded = Buffer.from(token, "base64url").toString("utf8");

    // Not a JWT, and not a smuggled identity: the row is the only place these live.
    expect(token.split(".")).toHaveLength(1);
    expect(token).not.toContain(id);
    expect(decoded).not.toContain(email);
    expect(decoded).not.toContain("assessor");
  });

  it("records the sign-in and stamps last_sign_in_at", async () => {
    const { email } = await seedStaff({ mustChange: false });

    await signIn({ email, password: PASSWORD });

    const users = await owner.db.execute(sql`SELECT last_sign_in_at FROM users`);
    const audit = await owner.db.execute(sql`SELECT action FROM audit_log`);

    expect((users[0] as { last_sign_in_at: Date | null }).last_sign_in_at).not.toBeNull();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "user.signed_in" });
  });

  it("refuses a wrong password without opening a session", async () => {
    const { email } = await seedStaff({ mustChange: false });

    const res = await signIn({ email, password: "not it" });

    expect(res.statusCode).toBe(401);
    expect(await owner.db.execute(sql`SELECT id FROM sessions`)).toHaveLength(0);
  });

  it("refuses a deactivated account, saying no more than it says to a stranger", async () => {
    const { email } = await seedStaff({ mustChange: false, isActive: false });

    const deactivated = await signIn({ email, password: PASSWORD });
    const unknown = await signIn({ email: "nobody@tmda.go.tz", password: PASSWORD });

    expect(deactivated.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(deactivated.body).toContain("Email or password is incorrect");
    // Byte-for-byte identical: the deactivated account must be indistinguishable from no account.
    expect(deactivated.body).toBe(unknown.body);
  });

  it("finds the account however the address was capitalized", async () => {
    const { email } = await seedStaff({ mustChange: false });

    const res = await signIn({ email: `  ${email.toUpperCase()}  `, password: PASSWORD });

    expect(res.statusCode).toBe(303);
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("the forced password change", () => {
  beforeEach(start);

  it("sends a user who owes a password change there instead of the dashboard", async () => {
    const { email } = await seedStaff({ mustChange: true });

    const res = await signIn({ email, password: PASSWORD });

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/change-password");
  });

  it("closes the rest of the staff app until the password is set", async () => {
    const { email } = await seedStaff({ mustChange: true });
    const cookie = await signedInCookie(email);

    const res = await get("/dashboard", cookie);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/change-password");
  });

  it("still lets them reach the change-password page and sign out", async () => {
    const { email } = await seedStaff({ mustChange: true });
    const cookie = await signedInCookie(email);

    const page = await get("/change-password", cookie);
    const signedOut = await app.inject({
      method: "POST",
      url: "/logout",
      headers: { host: STAFF_HOST, cookie },
    });

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("You must set a new password before continuing");
    // Someone who cannot get in must still be able to get out.
    expect(signedOut.statusCode).toBe(303);
  });

  it("opens the app once the password is changed", async () => {
    const { email } = await seedStaff({ mustChange: true });
    const cookie = await signedInCookie(email);

    const res = await changePassword(cookie, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/dashboard");

    const rows = await owner.db.execute(sql`SELECT must_change_password FROM users`);
    expect(rows[0]).toMatchObject({ must_change_password: false });
  });

  it("issues a new token and invalidates the one that was live across the change", async () => {
    const { email } = await seedStaff({ mustChange: true });
    const cookie = await signedInCookie(email);

    const changed = await changePassword(cookie, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    const withNew = await get("/dashboard", `${COOKIE}=${tokenOf(changed)}`);
    expect(withNew.statusCode).toBe(200);

    const withOld = await get("/dashboard", cookie);
    expect(withOld.statusCode).toBe(302);
    expect(withOld.headers.location).toBe("/");
  });

  it("leaves exactly one session behind, the replacement", async () => {
    const { email } = await seedStaff({ mustChange: true });
    const cookie = await signedInCookie(email);

    await changePassword(cookie, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    expect(await owner.db.execute(sql`SELECT id FROM sessions`)).toHaveLength(1);
  });

  it("signs in with the new password afterwards, and not the old one", async () => {
    const { email } = await seedStaff({ mustChange: true });
    const cookie = await signedInCookie(email);

    await changePassword(cookie, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    const withNew = await signIn({ email, password: NEW_PASSWORD });
    const withOld = await signIn({ email, password: PASSWORD });

    expect(withNew.statusCode).toBe(303);
    // Straight to the dashboard: the forced-change flag is down.
    expect(withNew.headers.location).toBe("/dashboard");
    expect(withOld.statusCode).toBe(401);
  });

  it("records the change without letting a hash near the trail", async () => {
    const { email } = await seedStaff({ mustChange: true });
    const cookie = await signedInCookie(email);

    await changePassword(cookie, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    const audit = await owner.db.execute(sql`
      SELECT action, before, after FROM audit_log ORDER BY id
    `);
    const rows = audit as Array<{ action: string; before: unknown; after: unknown }>;

    expect(rows.map((r) => r.action)).toEqual(["user.signed_in", "user.password_changed"]);
    expect(rows[1]?.before).toBeNull();
    expect(rows[1]?.after).toBeNull();
    // Neither the password nor any hash of it may be recoverable from the trail.
    expect(JSON.stringify(rows)).not.toContain("$argon2");
    expect(JSON.stringify(rows)).not.toContain(NEW_PASSWORD);
  });

  it("refuses to change the password without the current one", async () => {
    const { email } = await seedStaff({ mustChange: true });
    const cookie = await signedInCookie(email);

    const res = await changePassword(cookie, {
      currentPassword: "not it",
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    expect(res.statusCode).toBe(401);
    const rows = await owner.db.execute(sql`SELECT must_change_password FROM users`);
    expect(rows[0]).toMatchObject({ must_change_password: true });
  });

  it("reports the wrong current password before any rule about the new one", async () => {
    const { email } = await seedStaff({ mustChange: true });
    const cookie = await signedInCookie(email);

    // Wrong current password and a too-short new one. Proving you hold the account comes first,
    // so someone with a stolen cookie learns nothing about the password policy.
    const res = await changePassword(cookie, {
      currentPassword: "not it",
      newPassword: "short",
      confirmPassword: "short",
    });

    expect(res.statusCode).toBe(401);
    expect(res.body).toContain("Your current password is incorrect");
  });

  it("refuses a new password that was mistyped the second time", async () => {
    const { email } = await seedStaff({ mustChange: true });
    const cookie = await signedInCookie(email);

    const res = await changePassword(cookie, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: `${NEW_PASSWORD} typo`,
    });

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("do not match");
  });

  it("refuses a new password shorter than the floor the form advertises", async () => {
    const { email } = await seedStaff({ mustChange: true });
    const cookie = await signedInCookie(email);

    const res = await changePassword(cookie, {
      currentPassword: PASSWORD,
      newPassword: "short",
      confirmPassword: "short",
    });

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("at least 12 characters");
    const rows = await owner.db.execute(sql`SELECT must_change_password FROM users`);
    expect(rows[0]).toMatchObject({ must_change_password: true });
  });

  it("refuses a new password identical to the current one", async () => {
    const { email } = await seedStaff({ mustChange: true });
    const cookie = await signedInCookie(email);

    const res = await changePassword(cookie, {
      currentPassword: PASSWORD,
      newPassword: PASSWORD,
      confirmPassword: PASSWORD,
    });

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("must be different");
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("session lifetime and sign-out", () => {
  beforeEach(start);

  it("lets a signed-in user through to the dashboard", async () => {
    const { email } = await seedStaff({ mustChange: false });
    const cookie = await signedInCookie(email);

    const res = await get("/dashboard", cookie);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Grace Mollel");
  });

  it("slides last_seen_at on each request", async () => {
    const { email } = await seedStaff({ mustChange: false });
    const cookie = await signedInCookie(email);

    await owner.db.execute(sql`UPDATE sessions SET last_seen_at = now() - INTERVAL '5 minutes'`);
    const before = await owner.db.execute(sql`SELECT last_seen_at FROM sessions`);
    await get("/dashboard", cookie);
    const after = await owner.db.execute(sql`SELECT last_seen_at FROM sessions`);

    const first = new Date((before[0] as { last_seen_at: Date }).last_seen_at).getTime();
    const second = new Date((after[0] as { last_seen_at: Date }).last_seen_at).getTime();
    expect(second).toBeGreaterThan(first);
  });

  it("turns away a session left idle past the window", async () => {
    const { email } = await seedStaff({ mustChange: false });
    const cookie = await signedInCookie(email);

    // The idle window is 30 minutes in this config.
    await owner.db.execute(sql`UPDATE sessions SET last_seen_at = now() - INTERVAL '31 minutes'`);

    const res = await get("/dashboard", cookie);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
  });

  it("turns away a session past its absolute ceiling however busy it has been", async () => {
    const { email } = await seedStaff({ mustChange: false });
    const cookie = await signedInCookie(email);

    // Active this second, but issued beyond the 12-hour ceiling. The idle window is irrelevant.
    await owner.db.execute(sql`
      UPDATE sessions SET last_seen_at = now(), expires_at = now() - INTERVAL '1 second'
    `);

    const res = await get("/dashboard", cookie);

    expect(res.statusCode).toBe(302);
  });

  it("ends the session when the account is deactivated", async () => {
    const { email } = await seedStaff({ mustChange: false });
    const cookie = await signedInCookie(email);

    await owner.db.execute(sql`UPDATE users SET is_active = false`);

    expect((await get("/dashboard", cookie)).statusCode).toBe(302);
  });

  it("deletes the row on sign-out, not just the cookie", async () => {
    const { email } = await seedStaff({ mustChange: false });
    const cookie = await signedInCookie(email);

    const res = await app.inject({
      method: "POST",
      url: "/logout",
      headers: { host: STAFF_HOST, cookie },
    });

    expect(res.statusCode).toBe(303);
    expect(await owner.db.execute(sql`SELECT id FROM sessions`)).toHaveLength(0);
  });

  it("ignores a token that was never issued", async () => {
    const res = await get("/dashboard", `${COOKIE}=made-up-token`);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
  });
});
