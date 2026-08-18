# Administrator Bootstrap CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the first administrator account exactly once from a CLI, and provide a break-glass password reset for when every administrator is locked out.

**Architecture:** Two plain async functions (`createAdmin`, `resetPassword`) that take a Drizzle database handle and return a result value. A thin entry point translates results into process exit codes. The bootstrap runs inside one transaction holding a PostgreSQL advisory lock, so a conditional insert cannot race. Integration tests run the commands as a restricted application role while a separate owner connection migrates and truncates.

**Tech Stack:** Node 22+, TypeScript, Fastify (not touched here), Drizzle ORM, postgres.js, PostgreSQL 18, Zod 4, Vitest 4, `@node-rs/argon2`.

**Spec:** `docs/superpowers/specs/2026-08-18-admin-bootstrap-design.md`

## Global Constraints

- All work happens inside `server/`. Run every command from `server/`.
- Package manager is **pnpm**. Never use npm or yarn.
- ESM only. Every relative import ends in `.js`, even from `.ts` sources.
- Argon2id parameters live **only** in `src/auth/password.ts`: `memoryCost` 19456, `timeCost` 2, `parallelism` 1.
- `verifyPassword()` is **out of scope**. Do not write it.
- The temporary password never enters argv, a log line, an error message, or an audit row.
- The temporary password is printed with `process.stdout.write`, only after the transaction commits.
- Exit codes: `0` success, `1` refused, `2` invalid input, `3` unexpected.
- `--email` is trimmed and lower-cased before validation. `--name` is trimmed only.
- All CLI output is English. Do not use the `i18n` module.
- Lint with `pnpm lint:fix` before each commit; the repo uses Biome.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/auth/password.ts` | Argon2id parameters, hashing, temp password generation |
| `src/cli/result.ts` | The `CommandResult` union, shared by both commands |
| `src/cli/create-admin.ts` | `createAdmin()` and the advisory lock key |
| `src/cli/reset-password.ts` | `resetPassword()` |
| `src/cli/admin.ts` | argv parsing, `--help`, exit-code mapping |
| `drizzle/0003_admin_app_role.sql` | Creates `ereports_app` and grants what the CLI needs |
| `tests/password.test.ts` | Unit tests, no database |
| `tests/integration/helpers.ts` | Test-database safety guard, two connections, truncation |
| `tests/integration/require-db.ts` | Vitest global setup that fails closed |
| `tests/integration/admin-cli.test.ts` | All database-backed cases |
| `vitest.integration.config.ts` | Integration-only config |
| `package.json` | Dependency and scripts |

---

## Task 1: Password module

**Files:**
- Create: `server/src/auth/password.ts`
- Create: `server/tests/password.test.ts`
- Modify: `server/package.json` (add `@node-rs/argon2` to `dependencies`)

**Interfaces:**
- Consumes: nothing.
- Produces: `ARGON2_OPTIONS`, `TEMP_PASSWORD_ALPHABET: string`, `TEMP_PASSWORD_LENGTH: number`, `generateTempPassword(): string`, `hashPassword(plain: string): Promise<string>`.

- [ ] **Step 1: Install the dependency**

```bash
pnpm add @node-rs/argon2
```

- [ ] **Step 2: Write the failing test**

Create `server/tests/password.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_LENGTH,
  generateTempPassword,
  hashPassword,
} from "../src/auth/password.js";

describe("temporary password alphabet", () => {
  // These properties are the reason the byte mapping is unbiased: 256 is an exact
  // multiple of 32. Asserting them directly beats a chi-square test over samples.
  it("has exactly 32 distinct characters", () => {
    expect(TEMP_PASSWORD_ALPHABET).toHaveLength(32);
    expect(new Set(TEMP_PASSWORD_ALPHABET).size).toBe(32);
  });

  it("omits the letters that are misread when spoken", () => {
    for (const letter of ["I", "L", "O", "U"]) {
      expect(TEMP_PASSWORD_ALPHABET).not.toContain(letter);
    }
  });
});

describe("generateTempPassword", () => {
  it("returns the configured length", () => {
    expect(generateTempPassword()).toHaveLength(TEMP_PASSWORD_LENGTH);
  });

  it("draws only from the alphabet", () => {
    for (const character of generateTempPassword()) {
      expect(TEMP_PASSWORD_ALPHABET).toContain(character);
    }
  });

  it("does not repeat itself", () => {
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });
});

describe("hashPassword", () => {
  it("returns an Argon2id PHC string", async () => {
    expect(await hashPassword("correct horse battery staple")).toMatch(/^\$argon2id\$/);
  });

  it("salts, so the same input hashes differently each time", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run tests/password.test.ts`
Expected: FAIL — cannot resolve `../src/auth/password.js`.

- [ ] **Step 4: Write the implementation**

Create `server/src/auth/password.ts`:

```ts
import { randomBytes } from "node:crypto";
import { Algorithm, hash } from "@node-rs/argon2";

/**
 * OWASP's baseline for Argon2id, defined in exactly one place.
 *
 * The login slice will verify against hashes produced here, so it must import these rather than
 * restate them. Parameters that drift between hashing and verification silently reject everyone.
 */
export const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Crockford Base32. `I`, `L`, `O` and `U` are absent, so a password read down a phone line has
 * only one spelling. Exactly 32 characters, which is what makes the mapping below unbiased.
 */
export const TEMP_PASSWORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 20 characters at 5 bits each — 100 bits of entropy. */
export const TEMP_PASSWORD_LENGTH = 20;

export function generateTempPassword(): string {
  const bytes = randomBytes(TEMP_PASSWORD_LENGTH);
  let password = "";

  for (const byte of bytes) {
    // 256 is an exact multiple of 32, so this modulo introduces no bias and needs no
    // rejection sampling.
    password += TEMP_PASSWORD_ALPHABET[byte % TEMP_PASSWORD_ALPHABET.length];
  }

  return password;
}

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/password.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint:fix`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/auth/password.ts tests/password.test.ts
git commit -m "feat(auth): Argon2id hashing and temporary password generation"
```

---

## Task 2: Application role and grants

Migration `0001` grants `ereports_app` only `SELECT, INSERT` on `audit_log` and `USAGE, SELECT` on its sequence — and it skips entirely when the role does not exist, which is the case today. Nothing grants that role anything on `users` or `sessions`.

**Files:**
- Create: `server/drizzle/0003_admin_app_role.sql` (via drizzle-kit, which also updates `drizzle/meta/_journal.json`)

**Interfaces:**
- Consumes: nothing.
- Produces: a `ereports_app` role with the privileges the CLI needs. Task 3 connects as it.

- [ ] **Step 1: Generate an empty custom migration**

```bash
pnpm drizzle-kit generate --custom --name=admin_app_role
```

This creates `drizzle/0003_admin_app_role.sql` and registers it in `drizzle/meta/_journal.json`. If drizzle-kit picks a different number prefix, keep whatever it generated and use that name throughout.

- [ ] **Step 2: Write the migration body**

Replace the generated file's contents:

```sql
-- The role the application and the staff CLI are meant to run as.
--
-- Migration 0001 already revokes UPDATE/DELETE/TRUNCATE on audit_log from this role, but it
-- wraps everything in an IF EXISTS check and the role has never existed, so that block has
-- always taken its ELSE branch. Creating the role here means 0001's intent finally applies --
-- and because 0001 has already run, its grants and revoke are repeated below rather than
-- relied upon.
--
-- No password is set here. A migration is committed to git; a credential must not be. The
-- operator sets one out of band:
--
--   ALTER ROLE ereports_app PASSWORD '<generated>';
--
-- Granting to a new role takes nothing away from the owner, so the running application, which
-- currently connects as the owner, is unaffected.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ereports_app') THEN
    CREATE ROLE "ereports_app" LOGIN;
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA "public" TO "ereports_app";
--> statement-breakpoint

-- create inserts; reset-password updates password_hash and must_change_password.
GRANT SELECT, INSERT, UPDATE ON TABLE "users" TO "ereports_app";
--> statement-breakpoint

-- reset-password deletes the reset user's sessions. No INSERT: this slice never creates one.
GRANT SELECT, DELETE ON TABLE "sessions" TO "ereports_app";
--> statement-breakpoint

-- Repeated from 0001, which skipped because the role did not exist yet.
GRANT SELECT, INSERT ON TABLE "audit_log" TO "ereports_app";
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "audit_log_id_seq" TO "ereports_app";
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_log" FROM "ereports_app";
```

- [ ] **Step 3: Create the test database and apply migrations**

```bash
createdb -U postgres ereports_test
```

Then apply migrations against it and set the role's password:

```bash
DATABASE_URL=postgres://ereports:ereports@localhost:5432/ereports_test pnpm db:migrate
```

```bash
psql -U postgres -d ereports_test -c "ALTER ROLE ereports_app PASSWORD 'ereports_app';"
```

- [ ] **Step 4: Verify the grants landed**

```bash
psql -U postgres -d ereports_test -c "SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'ereports_app' ORDER BY table_name, privilege_type;"
```

Expected rows: `audit_log` INSERT and SELECT; `sessions` DELETE and SELECT; `users` INSERT, SELECT and UPDATE. `audit_log` must **not** show UPDATE, DELETE or TRUNCATE.

- [ ] **Step 5: Commit**

```bash
git add drizzle/
git commit -m "feat(db): create ereports_app role with the privileges the admin CLI needs"
```

---

## Task 3: Integration test harness

**Files:**
- Create: `server/tests/integration/helpers.ts`
- Create: `server/tests/integration/require-db.ts`
- Create: `server/vitest.integration.config.ts`
- Modify: `server/package.json` (add the `test:integration` script)
- Modify: `server/.env.example` (document the two test URLs)

**Interfaces:**
- Consumes: `createDatabase`, `Database`, `DatabaseHandle` from `src/db/client.js`.
- Produces: `requireTestDatabase(): { ownerUrl: string; appUrl: string }`, `openOwner(): DatabaseHandle`, `openApp(): DatabaseHandle`, `truncateAll(owner: Database): Promise<void>`, `INTEGRATION_ENABLED: boolean`.

- [ ] **Step 1: Write the helpers**

Create `server/tests/integration/helpers.ts`:

```ts
import { sql } from "drizzle-orm";
import { type Database, type DatabaseHandle, createDatabase } from "../../src/db/client.js";

/** Set by `pnpm test:integration`; absent during a plain `pnpm test`. */
export const INTEGRATION_ENABLED = Boolean(process.env.TEST_DATABASE_URL);

/**
 * Refuses to hand back a connection unless it is unmistakably a test database.
 *
 * The bootstrap advisory lock is per-database and the teardown truncates three tables, so a
 * misconfigured run against the development database would be destructive rather than merely
 * confusing.
 */
export function requireTestDatabase(): { ownerUrl: string; appUrl: string } {
  const ownerUrl = process.env.TEST_DATABASE_URL;
  const appUrl = process.env.TEST_APP_DATABASE_URL;

  if (!ownerUrl || !appUrl) {
    throw new Error(
      "TEST_DATABASE_URL and TEST_APP_DATABASE_URL must both be set to run integration tests.",
    );
  }

  if (ownerUrl === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must not equal DATABASE_URL.");
  }

  const name = new URL(ownerUrl).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run against "${name}": the test database name must end in _test.`);
  }

  return { ownerUrl, appUrl };
}

/** Owner connection: applies migrations and truncates. */
export function openOwner(): DatabaseHandle {
  return createDatabase(requireTestDatabase().ownerUrl);
}

/**
 * Restricted connection, used for every command under test.
 *
 * Running the commands as the owner would exercise a superset of production's privileges and
 * prove nothing about them — the tests would pass while the container failed on a missing grant.
 */
export function openApp(): DatabaseHandle {
  return createDatabase(requireTestDatabase().appUrl);
}

/**
 * TRUNCATE, never DELETE. Migration 0001 puts a BEFORE UPDATE OR DELETE row trigger on
 * audit_log that raises for every role including the owner; row triggers do not fire on
 * TRUNCATE. CASCADE is needed because sessions and audit_log both reference users.
 */
export async function truncateAll(owner: Database): Promise<void> {
  await owner.execute(sql`TRUNCATE users, sessions, audit_log RESTART IDENTITY CASCADE`);
}
```

- [ ] **Step 2: Write the fail-closed global setup**

Create `server/tests/integration/require-db.ts`:

```ts
import { requireTestDatabase } from "./helpers.js";

/**
 * Runs before the integration suite and throws when the database is not configured.
 *
 * `pnpm test` skips these tests when the variables are absent, which keeps it green on any
 * machine. That is only safe if some other command refuses to be green for the same reason —
 * otherwise a CI run with no database passes while silently skipping the race test, which is
 * exactly the self-congratulating outcome this tier exists to prevent.
 */
export default function setup(): void {
  requireTestDatabase();
}
```

- [ ] **Step 3: Write the integration Vitest config**

Create `server/vitest.integration.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/require-db.ts"],
    // Integration cases share three tables and truncate between runs, so they cannot overlap.
    fileParallelism: false,
  },
});
```

- [ ] **Step 4: Add the script**

In `server/package.json`, add to `scripts`:

```json
"test:integration": "vitest run --config vitest.integration.config.ts"
```

- [ ] **Step 5: Document the variables**

Append to `server/.env.example`:

```
# Integration tests only. Both must be set for `pnpm test:integration`, which fails
# closed without them. `pnpm test` skips the database-backed cases instead.
# The name must end in _test, and TEST_DATABASE_URL must differ from DATABASE_URL.
TEST_DATABASE_URL=postgres://ereports:ereports@localhost:5432/ereports_test
TEST_APP_DATABASE_URL=postgres://ereports_app:ereports_app@localhost:5432/ereports_test
```

- [ ] **Step 6: Verify it fails closed**

Run: `pnpm test:integration`
Expected: FAIL — "TEST_DATABASE_URL and TEST_APP_DATABASE_URL must both be set to run integration tests."

- [ ] **Step 7: Verify the default run stays green**

Run: `pnpm test`
Expected: PASS. The existing suites plus `tests/password.test.ts`; no integration test files exist yet.

- [ ] **Step 8: Commit**

```bash
git add tests/integration/ vitest.integration.config.ts package.json .env.example
git commit -m "test: two-connection integration harness that fails closed"
```

---

## Task 4: `createAdmin`

**Files:**
- Create: `server/src/cli/result.ts`
- Create: `server/src/cli/create-admin.ts`
- Create: `server/tests/integration/admin-cli.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `generateTempPassword` from `src/auth/password.js`; `openOwner`, `openApp`, `truncateAll`, `INTEGRATION_ENABLED` from `tests/integration/helpers.js`.
- Produces: `CommandResult`, `createAdmin(db: Database, input: { email: string; name: string }): Promise<CommandResult>`, `ADMIN_BOOTSTRAP_LOCK_KEY: bigint`.

- [ ] **Step 1: Write the result type**

Create `server/src/cli/result.ts`:

```ts
/**
 * Outcomes a command anticipated.
 *
 * Anything unexpected is deliberately absent: it propagates as a thrown exception, which the
 * entry point catches and maps to exit 3.
 */
export type CommandResult =
  | { status: "ok"; message: string; password: string }
  | { status: "refused"; message: string }
  | { status: "invalid"; message: string };
```

- [ ] **Step 2: Write the failing tests**

Create `server/tests/integration/admin-cli.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAdmin } from "../../src/cli/create-admin.js";
import type { Database, DatabaseHandle } from "../../src/db/client.js";
import { INTEGRATION_ENABLED, openApp, openOwner, truncateAll } from "./helpers.js";

let owner: DatabaseHandle;
let app: DatabaseHandle;

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

  afterAll(async () => {
    await owner?.close();
    await app?.close();
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
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
TEST_DATABASE_URL=postgres://ereports:ereports@localhost:5432/ereports_test TEST_APP_DATABASE_URL=postgres://ereports_app:ereports_app@localhost:5432/ereports_test pnpm test:integration
```

Expected: FAIL — cannot resolve `../../src/cli/create-admin.js`.

- [ ] **Step 4: Write the implementation**

Create `server/src/cli/create-admin.ts`:

```ts
import { sql } from "drizzle-orm";
import { z } from "zod";
import { generateTempPassword, hashPassword } from "../auth/password.js";
import type { Database } from "../db/client.js";
import type { CommandResult } from "./result.js";

/**
 * Arbitrary but permanent. Changing it reopens the race it exists to close, because two
 * processes holding different keys do not exclude one another.
 */
export const ADMIN_BOOTSTRAP_LOCK_KEY = 4_170_825_113n;

const InputSchema = z.object({
  // Normalized before validation and before the unique index sees it. Without this,
  // A@tmda.go.tz and a@tmda.go.tz become two rows and 23505 never fires.
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(1),
});

function isEmailTaken(error: unknown): boolean {
  const candidate = error as { code?: string; constraint_name?: string };
  return candidate?.code === "23505" && candidate?.constraint_name === "users_email_unique";
}

/**
 * Creates the first administrator, once.
 *
 * `INSERT ... WHERE NOT EXISTS` is not race-free on its own: under READ COMMITTED the subquery
 * takes no lock, because there is no row to lock. The advisory lock is what closes that window,
 * and it is released when the transaction ends.
 */
export async function createAdmin(
  db: Database,
  input: { email: string; name: string },
): Promise<CommandResult> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "invalid", message: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const { email, name } = parsed.data;
  const password = generateTempPassword();
  const passwordHash = await hashPassword(password);

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADMIN_BOOTSTRAP_LOCK_KEY})`);

      const inserted = await tx.execute(sql`
        INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
        SELECT ${email}, ${name}, 'administrator', ${passwordHash}, true, true
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'administrator')
        RETURNING id
      `);

      if (inserted.length === 0) {
        return {
          status: "refused",
          message: "An administrator already exists. Bootstrap is closed.",
        };
      }

      const { id } = inserted[0] as { id: string };

      await tx.execute(sql`
        INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
        VALUES (
          NULL, 'user.bootstrap_created', 'user', ${id},
          ${JSON.stringify({ email, fullName: name, role: "administrator" })}::jsonb
        )
      `);

      return { status: "ok", message: `Administrator ${email} created.`, password };
    });
  } catch (error) {
    // The bootstrap guard can pass while the address collides with a non-administrator. Saying
    // "bootstrap is closed" there would be a lie, and exit 3 would claim the database is broken.
    if (isEmailTaken(error)) {
      return { status: "refused", message: "A user with that email already exists." };
    }
    throw error;
  }
}
```

`must_change_password` is written explicitly even though the column defaults to `true`: a future migration could change that default without this command noticing.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
TEST_DATABASE_URL=postgres://ereports:ereports@localhost:5432/ereports_test TEST_APP_DATABASE_URL=postgres://ereports_app:ereports_app@localhost:5432/ereports_test pnpm test:integration
```

Expected: PASS, 7 tests. A failure mentioning `permission denied for table users` means Task 2's grants did not apply — fix the migration, do not switch the tests to the owner connection.

- [ ] **Step 6: Verify the default run is still green**

Run: `pnpm test`
Expected: PASS, with the `createAdmin` block reported as skipped.

- [ ] **Step 7: Typecheck, lint and commit**

```bash
pnpm typecheck && pnpm lint:fix
git add src/cli/ tests/integration/
git commit -m "feat(cli): bootstrap the first administrator under an advisory lock"
```

---

## Task 5: The race is actually closed

This is the test the advisory lock exists for. It is written separately because it is the only case that would still pass if the lock were deleted — sometimes.

**Files:**
- Modify: `server/tests/integration/admin-cli.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `createAdmin`, `ADMIN_BOOTSTRAP_LOCK_KEY`, `openApp`, `openOwner`, `truncateAll`, and the `administratorCount` helper defined in Task 4.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Change the existing import to `import { ADMIN_BOOTSTRAP_LOCK_KEY, createAdmin } from "../../src/cli/create-admin.js";` and append to `server/tests/integration/admin-cli.test.ts`:

```ts
describe.skipIf(!INTEGRATION_ENABLED)("createAdmin concurrency", () => {
  let first: DatabaseHandle;
  let second: DatabaseHandle;

  beforeEach(async () => {
    owner ??= openOwner();
    // Two clients, not two queries on one: postgres.js cannot hold overlapping transactions on
    // a single connection, so a one-client version would serialize and never race at all.
    first ??= openApp();
    second ??= openApp();
    await truncateAll(owner.db);
  });

  afterAll(async () => {
    await first?.close();
    await second?.close();
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
```

- [ ] **Step 2: Run it**

```bash
TEST_DATABASE_URL=postgres://ereports:ereports@localhost:5432/ereports_test TEST_APP_DATABASE_URL=postgres://ereports_app:ereports_app@localhost:5432/ereports_test pnpm test:integration
```

Expected: PASS, 9 tests.

- [ ] **Step 3: Prove the lock is doing the work**

Temporarily comment out the `pg_advisory_xact_lock` line in `src/cli/create-admin.ts` and run the concurrency case twenty times:

```bash
TEST_DATABASE_URL=postgres://ereports:ereports@localhost:5432/ereports_test TEST_APP_DATABASE_URL=postgres://ereports_app:ereports_app@localhost:5432/ereports_test pnpm vitest run --config vitest.integration.config.ts -t "concurrent bootstraps" --repeat=20
```

Expected: at least one run fails with two administrators. If all twenty pass, the two calls are not truly overlapping — check that `openApp()` returned two distinct handles — because the guarantee has not been demonstrated.

**Restore the lock line before continuing.** Re-run step 2 and confirm PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/admin-cli.test.ts
git commit -m "test: prove the bootstrap advisory lock closes the insert race"
```

---

## Task 6: `resetPassword`

**Files:**
- Create: `server/src/cli/reset-password.ts`
- Modify: `server/tests/integration/admin-cli.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `hashPassword`, `generateTempPassword`, `CommandResult`, and the `seedUser` helper defined in Task 4.
- Produces: `resetPassword(db: Database, input: { email: string }): Promise<CommandResult>`.

- [ ] **Step 1: Write the failing tests**

Add `import { resetPassword } from "../../src/cli/reset-password.js";` at the top, and append to `server/tests/integration/admin-cli.test.ts`:

```ts
describe.skipIf(!INTEGRATION_ENABLED)("resetPassword", () => {
  beforeEach(async () => {
    owner ??= openOwner();
    app ??= openApp();
    await truncateAll(owner.db);
  });

  async function seedSession(db: Database, userId: string, tokenHash: string): Promise<void> {
    await db.execute(sql`
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES (${userId}, ${tokenHash}, now() + interval '1 hour')
    `);
  }

  it("replaces the hash, forces a change, and kills only that user's sessions", async () => {
    const target = await seedUser(owner.db, { email: "target@tmda.go.tz", role: "manager" });
    const other = await seedUser(owner.db, { email: "other@tmda.go.tz", role: "assessor" });
    await seedSession(owner.db, target, "target-token");
    await seedSession(owner.db, other, "other-token");

    const result = await resetPassword(app.db, { email: "target@tmda.go.tz" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.password).toHaveLength(20);

    const users = await owner.db.execute(sql`
      SELECT password_hash, must_change_password FROM users WHERE id = ${target}
    `);
    expect((users[0] as { password_hash: string }).password_hash).toMatch(/^\$argon2id\$/);
    expect(users[0]).toMatchObject({ must_change_password: true });

    const sessions = await owner.db.execute(sql`SELECT user_id FROM sessions`);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ user_id: other });
  });

  it("matches on the normalized address", async () => {
    await seedUser(owner.db, { email: "target@tmda.go.tz", role: "manager" });

    expect((await resetPassword(app.db, { email: "  Target@TMDA.go.tz " })).status).toBe("ok");
  });

  it("refuses an address with no user", async () => {
    expect(await resetPassword(app.db, { email: "nobody@tmda.go.tz" })).toMatchObject({
      status: "refused",
      message: "No user with that email.",
    });
  });

  it("refuses a deactivated account rather than issuing an unusable password", async () => {
    await seedUser(owner.db, { email: "gone@tmda.go.tz", role: "manager", isActive: false });

    expect(await resetPassword(app.db, { email: "gone@tmda.go.tz" })).toMatchObject({
      status: "refused",
      message: "That account is deactivated. Reactivate it before resetting the password.",
    });
  });

  it("writes an audit row carrying no secret", async () => {
    const target = await seedUser(owner.db, { email: "target@tmda.go.tz", role: "manager" });
    const result = await resetPassword(app.db, { email: "target@tmda.go.tz" });
    if (result.status !== "ok") throw new Error("expected ok");

    const rows = await owner.db.execute(sql`
      SELECT actor_user_id, action, entity_type, entity_id, after FROM audit_log
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_user_id: null,
      action: "user.password_reset",
      entity_type: "user",
      entity_id: target,
    });

    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain(result.password);
    expect(serialized).not.toContain("$argon2id$");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
TEST_DATABASE_URL=postgres://ereports:ereports@localhost:5432/ereports_test TEST_APP_DATABASE_URL=postgres://ereports_app:ereports_app@localhost:5432/ereports_test pnpm test:integration
```

Expected: FAIL — cannot resolve `../../src/cli/reset-password.js`.

- [ ] **Step 3: Write the implementation**

Create `server/src/cli/reset-password.ts`:

```ts
import { sql } from "drizzle-orm";
import { z } from "zod";
import { generateTempPassword, hashPassword } from "../auth/password.js";
import type { Database } from "../db/client.js";
import type { CommandResult } from "./result.js";

const InputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

/**
 * Break glass: puts a new temporary password on any account and ends its sessions.
 *
 * Deleting the sessions is the half that matters. A reset that left them alive would tell the
 * operator the account was locked out while whoever was already signed in stayed signed in.
 * That only works because every staff session is a row here — see §8 of the spec.
 *
 * It is not restricted to administrators. The operator already holds DATABASE_URL, so the
 * restriction would remove legitimate use without removing any capability.
 */
export async function resetPassword(
  db: Database,
  input: { email: string },
): Promise<CommandResult> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "invalid", message: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const { email } = parsed.data;
  const password = generateTempPassword();
  const passwordHash = await hashPassword(password);

  return db.transaction(async (tx) => {
    const found = await tx.execute(sql`
      SELECT id, is_active FROM users WHERE email = ${email}
    `);

    if (found.length === 0) {
      return { status: "refused", message: "No user with that email." };
    }

    const user = found[0] as { id: string; is_active: boolean };

    // A reset that cannot be used is a trap. Better the operator learns now than after
    // reading a password down a phone line.
    if (!user.is_active) {
      return {
        status: "refused",
        message: "That account is deactivated. Reactivate it before resetting the password.",
      };
    }

    await tx.execute(sql`
      UPDATE users
      SET password_hash = ${passwordHash}, must_change_password = true
      WHERE id = ${user.id}
    `);

    await tx.execute(sql`DELETE FROM sessions WHERE user_id = ${user.id}`);

    await tx.execute(sql`
      INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
      VALUES (NULL, 'user.password_reset', 'user', ${user.id}, ${JSON.stringify({ email })}::jsonb)
    `);

    return { status: "ok", message: `Password reset for ${email}.`, password };
  });
}
```

- [ ] **Step 4: Run to verify success**

```bash
TEST_DATABASE_URL=postgres://ereports:ereports@localhost:5432/ereports_test TEST_APP_DATABASE_URL=postgres://ereports_app:ereports_app@localhost:5432/ereports_test pnpm test:integration
```

Expected: PASS, 14 tests.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
pnpm typecheck && pnpm lint:fix
git add src/cli/reset-password.ts tests/integration/admin-cli.test.ts
git commit -m "feat(cli): break-glass password reset that ends the user's sessions"
```

---

## Task 7: CLI entry point

**Files:**
- Create: `server/src/cli/admin.ts`
- Modify: `server/package.json` (add the `admin` and `admin:dev` scripts)

**Interfaces:**
- Consumes: `loadConfig` from `src/config.js`, `createDatabase` from `src/db/client.js`, `createAdmin`, `resetPassword`, `CommandResult`.
- Produces: an executable module with no exports.

- [ ] **Step 1: Write the entry point**

Create `server/src/cli/admin.ts`:

```ts
import { loadConfig } from "../config.js";
import { createDatabase } from "../db/client.js";
import { createAdmin } from "./create-admin.js";
import { resetPassword } from "./reset-password.js";
import type { CommandResult } from "./result.js";

const HELP = `AE Reports staff account tool.

  create          --email=<address> --name="<full name>"
                  Creates the first administrator. Refuses once one exists.

  reset-password  --email=<address>
                  Issues a new temporary password and ends that user's sessions.

Both print a temporary password once, to stdout. It stops working as soon as the
user sets their own. Read it, deliver it, do not store it.

Anyone who can run these commands can already reach the database directly, so
they are a break-glass tool, not a privilege boundary. The guard on 'create'
prevents accidents -- running it twice, or two operators at once -- not an
operator holding DATABASE_URL.

Exit codes: 0 success, 1 refused, 2 invalid input, 3 unexpected failure.
`;

/** Parses --key=value pairs. Neither value is secret, so argv is a safe place for them. */
function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};

  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) flags[match[1]] = match[2];
  }

  return flags;
}

function exitCodeFor(result: CommandResult): number {
  switch (result.status) {
    case "ok":
      return 0;
    case "refused":
      return 1;
    case "invalid":
      return 2;
  }
}

async function main(): Promise<number> {
  const [subcommand, ...rest] = process.argv.slice(2);

  if (!subcommand || subcommand === "--help" || subcommand === "help") {
    process.stdout.write(HELP);
    return subcommand ? 0 : 2;
  }

  const flags = parseFlags(rest);
  const config = loadConfig();
  const handle = createDatabase(config.DATABASE_URL);

  try {
    let result: CommandResult;

    switch (subcommand) {
      case "create":
        result = await createAdmin(handle.db, {
          email: flags.email ?? "",
          name: flags.name ?? "",
        });
        break;
      case "reset-password":
        result = await resetPassword(handle.db, { email: flags.email ?? "" });
        break;
      default:
        process.stderr.write(`Unknown command: ${subcommand}\n\n${HELP}`);
        return 2;
    }

    // Reached only after the transaction committed, so a rolled-back row cannot have its
    // password printed. Written straight to stdout rather than through the application
    // logger, which would carry it into log aggregation.
    process.stderr.write(`${result.message}\n`);
    if (result.status === "ok") {
      process.stdout.write(`Temporary password: ${result.password}\n`);
    }

    return exitCodeFor(result);
  } finally {
    await handle.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `Unexpected failure: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 3;
  });
```

The outcome message goes to stderr and the password to stdout, so `admin create ... > password.txt` captures only the secret while the operator still sees what happened.

- [ ] **Step 2: Add the scripts**

In `server/package.json`, add to `scripts`:

```json
"admin": "node dist/cli/admin.js",
"admin:dev": "tsx --env-file=.env src/cli/admin.ts"
```

- [ ] **Step 3: Build and check the CLI reached `dist`**

```bash
pnpm build && ls dist/cli/admin.js
```

Expected: the file exists. The runtime image copies `dist/`, so this is what production runs.

- [ ] **Step 4: Exercise it against the test database**

```bash
DATABASE_URL=postgres://ereports_app:ereports_app@localhost:5432/ereports_test PUBLIC_HOST=public.localhost:3100 STAFF_HOST=staff.localhost:3100 node dist/cli/admin.js create --email=admin@tmda.go.tz --name="Full Name"
```

Expected: a temporary password on stdout, exit 0. Confirm with `echo $?`.

Run the identical command again. Expected: "An administrator already exists. Bootstrap is closed.", exit **1**.

```bash
DATABASE_URL=postgres://ereports_app:ereports_app@localhost:5432/ereports_test PUBLIC_HOST=public.localhost:3100 STAFF_HOST=staff.localhost:3100 node dist/cli/admin.js create --email=nonsense --name="X"
```

Expected: exit **2**.

- [ ] **Step 5: Confirm the password is not in argv**

While a command runs, `ps aux | grep admin.js` must show only the email and the name. This is a read of the code as much as of `ps`: no step anywhere accepts a password as an argument.

- [ ] **Step 6: Clean up and re-run both suites**

```bash
psql -U postgres -d ereports_test -c "TRUNCATE users, sessions, audit_log RESTART IDENTITY CASCADE;"
pnpm typecheck && pnpm lint:fix && pnpm test
```

```bash
TEST_DATABASE_URL=postgres://ereports:ereports@localhost:5432/ereports_test TEST_APP_DATABASE_URL=postgres://ereports_app:ereports_app@localhost:5432/ereports_test pnpm test:integration
```

Expected: both green.

- [ ] **Step 7: Commit**

```bash
git add src/cli/admin.ts package.json
git commit -m "feat(cli): admin entry point with exit codes and a threat-model --help"
```

---

## Done

At this point:

- `pnpm test` is green on a machine with no database.
- `pnpm test:integration` refuses to run without a test database, and is green with one.
- The bootstrap has been shown to close its race, by removing the lock and watching it fail.
- The commands run under a role holding only the privileges granted in Task 2.

**Not in this slice, by design:** `verifyPassword`, the login form, sessions, the forced password-change redirect, switching `compose.yml` to `ereports_app`, and the `.env.example` drift recorded in §12 of the spec.
