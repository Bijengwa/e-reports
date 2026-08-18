import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_BOOTSTRAP_LOCK_KEY, createAdmin } from "../../src/cli/create-admin.js";
import type { Database, DatabaseHandle } from "../../src/db/client.js";
import { INTEGRATION_ENABLED, openApp, openOwner, truncateAll } from "./helpers.js";

let owner: DatabaseHandle;
let app: DatabaseHandle;
let first: DatabaseHandle;
let second: DatabaseHandle;

/**
 * One place closes every handle, once, after every suite in the file.
 *
 * Closing inside a describe's own afterAll ends a connection that the next describe still reuses
 * through `??=` — which does not reopen an already-assigned handle. The truncation then fails with
 * CONNECTION_ENDED, which looks like a fault in the code under test and is not one.
 */
afterAll(async () => {
  await owner?.close();
  await app?.close();
  await first?.close();
  await second?.close();
});

/** A non-administrator, inserted through the owner so the app role is only used by commands. */
async function seedUser(
  db: Database,
  attrs: { email: string; role: "manager" | "assessor"; isActive?: boolean },
): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO users (email, full_name, role, password_hash, is_active)
    VALUES (${attrs.email}, 'Seeded User', ${attrs.role}, 'not-a-real-hash', ${attrs.isActive ?? true})
    RETURNING id
  `);
  return (rows[0] as { id: string }).id;
}

async function administratorCount(db: Database): Promise<number> {
  const rows = await db.execute(
    sql`SELECT count(*)::int AS n FROM users WHERE role = 'administrator'`,
  );
  return (rows[0] as { n: number }).n;
}

describe.skipIf(!INTEGRATION_ENABLED)("createAdmin", () => {
  beforeEach(async () => {
    owner ??= openOwner();
    app ??= openApp();
    await truncateAll(owner.db);
  });

  it("creates one administrator that must change its password", async () => {
    const result = await createAdmin(app.db, { email: "admin@tmda.go.tz", name: "First Admin" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.password).toHaveLength(20);

    const rows = await owner.db.execute(sql`
      SELECT email, full_name, role, must_change_password, is_active, password_hash
      FROM users
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: "admin@tmda.go.tz",
      full_name: "First Admin",
      role: "administrator",
      must_change_password: true,
      is_active: true,
    });
    expect((rows[0] as { password_hash: string }).password_hash).toMatch(/^\$argon2id\$/);
  });

  it("normalizes the email before storing it", async () => {
    await createAdmin(app.db, { email: "  Admin@TMDA.go.tz  ", name: "  First Admin  " });

    const rows = await owner.db.execute(sql`SELECT email, full_name FROM users`);
    expect(rows[0]).toMatchObject({ email: "admin@tmda.go.tz", full_name: "First Admin" });
  });

  it("refuses the second bootstrap and adds no row", async () => {
    await createAdmin(app.db, { email: "first@tmda.go.tz", name: "First Admin" });
    const second = await createAdmin(app.db, { email: "second@tmda.go.tz", name: "Second Admin" });

    expect(second).toMatchObject({
      status: "refused",
      message: "An administrator already exists. Bootstrap is closed.",
    });
    expect(await administratorCount(owner.db)).toBe(1);
  });

  it("refuses when an administrator exists alongside other users", async () => {
    await seedUser(owner.db, { email: "manager@tmda.go.tz", role: "manager" });
    await createAdmin(app.db, { email: "admin@tmda.go.tz", name: "First Admin" });

    const again = await createAdmin(app.db, { email: "other@tmda.go.tz", name: "Other" });

    expect(again.status).toBe("refused");
    expect(await administratorCount(owner.db)).toBe(1);
  });

  it("reports a taken email distinctly from a closed bootstrap", async () => {
    await seedUser(owner.db, { email: "taken@tmda.go.tz", role: "assessor" });

    const result = await createAdmin(app.db, { email: "taken@tmda.go.tz", name: "First Admin" });

    expect(result).toMatchObject({
      status: "refused",
      message: "A user with that email already exists.",
    });
    expect(await administratorCount(owner.db)).toBe(0);

    const audits = await owner.db.execute(sql`SELECT count(*)::int AS n FROM audit_log`);
    expect((audits[0] as { n: number }).n).toBe(0);
  });

  it("rejects a malformed email without touching the database", async () => {
    const result = await createAdmin(app.db, { email: "not-an-email", name: "First Admin" });

    expect(result.status).toBe("invalid");
    expect(await administratorCount(owner.db)).toBe(0);
  });

  it("writes an audit row carrying no secret", async () => {
    const result = await createAdmin(app.db, { email: "admin@tmda.go.tz", name: "First Admin" });
    if (result.status !== "ok") throw new Error("expected ok");

    const rows = await owner.db.execute(sql`
      SELECT actor_user_id, action, entity_type, after FROM audit_log
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_user_id: null,
      action: "user.bootstrap_created",
      entity_type: "user",
    });

    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain(result.password);
    expect(serialized).not.toContain("$argon2id$");
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("createAdmin concurrency", () => {
  beforeEach(async () => {
    owner ??= openOwner();
    // Two clients, not two queries on one: postgres.js cannot hold overlapping transactions on a
    // single connection, so a one-client version would serialize and never race at all.
    first ??= openApp();
    second ??= openApp();
    await truncateAll(owner.db);
  });

  it("lets exactly one of two concurrent bootstraps win", async () => {
    const results = await Promise.all([
      createAdmin(first.db, { email: "one@tmda.go.tz", name: "One" }),
      createAdmin(second.db, { email: "two@tmda.go.tz", name: "Two" }),
    ]);

    expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
    expect(results.filter((r) => r.status === "refused")).toHaveLength(1);
    expect(await administratorCount(owner.db)).toBe(1);
  });

  it("uses the shared lock key rather than a repeated literal", () => {
    expect(ADMIN_BOOTSTRAP_LOCK_KEY).toBe(4_170_825_113n);
  });
});
