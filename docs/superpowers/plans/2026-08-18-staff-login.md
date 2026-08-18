# Staff Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a staff member sign in on the staff host with a password, hold the sign-in as a database session behind an opaque `__Host-` cookie, and refuse them the rest of the portal until the forced first password change is done.

**Architecture:** `src/auth/` grows a session module beside the existing password module: a 256-bit random token goes in the cookie, only its SHA-256 lands in `sessions.token_hash`. The staff door becomes three nested Fastify encapsulation contexts — anonymous, signed-in, and signed-in-with-password-changed — each inner one adding an `onRequest` hook. Nesting rather than a URL allowlist is what makes the gate impossible for a future route to forget, the same reasoning `constrainToHost` already uses for host isolation.

**Tech Stack:** Node 22+, TypeScript (NodeNext ESM, `verbatimModuleSyntax`), Fastify 5, `@fastify/cookie`, `@fastify/rate-limit`, `@kitajs/html` server-rendered TSX, Drizzle ORM, postgres.js, PostgreSQL 18, Zod 4, Vitest 4, `@node-rs/argon2`.

**Spec:** No written spec — requirements came directly from the user, and are reproduced in Global Constraints below.

## Global Constraints

- All work happens inside `server/`. Run every command from `server/`.
- Package manager is **pnpm**. Never use npm or yarn.
- ESM only. Every relative import ends in `.js`, even from `.ts` and `.tsx` sources.
- Biome formats: 2-space indent, **line width 100**, double quotes, semicolons, trailing commas.
- **Lint only the files this slice changes.** Before each commit run `pnpm exec biome check --write` with the exact paths that commit stages — never `pnpm lint:fix`, which rewrites the whole repository and would sweep unrelated files into this slice's diff. `pnpm lint` (read-only, whole repo) is fine as a final check.
- **Do not change `createAdmin`, the `reset-password` CLI, or the advisory lock.** `src/cli/` is closed in this slice.
- **Do not switch `compose.yml` to `ereports_app`.** The running application still connects as the owner. This slice only *grants* the role what it will eventually need.
- **Do not touch the public Orange Form** — nothing under `src/doors/public/` or `src/domain/form-schema.ts` changes.
- **All staff-facing copy is English.** Never import `src/i18n/` from anything under `src/doors/staff/`. `<Layout>` is always called with `locale="en"`.
- Argon2id parameters live **only** in `src/auth/password.ts`. Import `ARGON2_OPTIONS`; never restate the numbers.
- **Never put a JWT, a user id, a role, or any other claim in the cookie.** The cookie carries one opaque random token and nothing else. Every fact about the session is read from the `sessions` and `users` rows.
- Session lifetimes come from `SESSION_IDLE_MINUTES` and `SESSION_ABSOLUTE_HOURS`, which are already in `server/.env` and `server/.env.example` at `30` and `12`. **Never hardcode a duration.**
- Both deadlines are evaluated by PostgreSQL against `now()`, never by comparing a JavaScript `Date`. One clock.
- The password a user types never enters a log line, an error message, an audit row, or a rendered page.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/config.ts` | **Modify** — parse the two session lifetime variables |
| `src/auth/password.ts` | **Modify** — add `verifyPassword`, the absent-user hash, `MIN_PASSWORD_LENGTH` |
| `src/auth/session.ts` | **Create** — token generation, hashing, session create/load/destroy, cookie attributes |
| `src/doors/staff/session-guard.ts` | **Create** — the two `onRequest` hooks and `currentSession()` |
| `src/doors/staff/routes/login.tsx` | **Modify** — replace the 503 placeholder with real authentication |
| `src/doors/staff/routes/logout.ts` | **Create** — `POST /logout` |
| `src/doors/staff/routes/dashboard.tsx` | **Create** — where a signed-in user lands |
| `src/doors/staff/routes/change-password.tsx` | **Create** — `GET`/`POST /change-password` |
| `src/doors/staff/views/dashboard.tsx` | **Create** — the landing page |
| `src/doors/staff/views/change-password.tsx` | **Modify** — use the shared `Layout`, escape the error |
| `src/doors/staff/index.ts` | **Modify** — nest the three encapsulation contexts |
| `src/server.ts` | **Modify** — register `@fastify/rate-limit` non-globally, pass session config to the staff door |
| `drizzle/0004_session_write_grants.sql` | **Create** — `GRANT INSERT, UPDATE ON sessions` |
| `drizzle/meta/_journal.json` | **Modify** — register migration 0004 |
| `tests/password.test.ts` | **Modify** — `verifyPassword` cases |
| `tests/session.test.ts` | **Create** — token and cookie unit tests, no database |
| `tests/doors.test.ts` | **Modify** — replace the 503 case; add redirect cases that need no database |
| `tests/integration/staff-login.test.ts` | **Create** — the whole flow against the restricted role |

---

## Task 1: Session lifetime configuration

The two variables already sit in `.env` and `.env.example` but `EnvSchema` never parses them, so they are read by nothing today. Zod strips unknown keys silently, which is why this has gone unnoticed.

**Files:**
- Modify: `server/src/config.ts`
- Modify: `server/tests/doors.test.ts` (the `Config` fixture at the top)

**Interfaces:**
- Consumes: nothing.
- Produces: `Config["SESSION_IDLE_MINUTES"]: number`, `Config["SESSION_ABSOLUTE_HOURS"]: number`.

- [ ] **Step 1: Write the failing test**

Add to the `describe("configuration guards host isolation")` block in `server/tests/doors.test.ts`:

```ts
  it("reads the session lifetimes from the environment", () => {
    const config = loadConfig({ ...base, SESSION_IDLE_MINUTES: "45", SESSION_ABSOLUTE_HOURS: "8" });

    expect(config.SESSION_IDLE_MINUTES).toBe(45);
    expect(config.SESSION_ABSOLUTE_HOURS).toBe(8);
  });

  it("falls back to the documented defaults", () => {
    expect(loadConfig(base).SESSION_IDLE_MINUTES).toBe(30);
    expect(loadConfig(base).SESSION_ABSOLUTE_HOURS).toBe(12);
  });

  it("refuses a session lifetime of zero", () => {
    // A zero idle window expires every session before its first request, which would look
    // exactly like a broken password check.
    expect(() => loadConfig({ ...base, SESSION_IDLE_MINUTES: "0" })).toThrow();
  });
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm test -- doors.test.ts
```

Expected: FAIL — `SESSION_IDLE_MINUTES` is `undefined` on the parsed config, and the zero case does not throw.

- [ ] **Step 3: Add the two fields to `EnvSchema`**

In `server/src/config.ts`, directly after the `DATABASE_URL` line:

```ts
  /**
   * Sliding idle window for a staff session, in minutes. Each request pushes it back.
   *
   * The ceiling is a day: anything longer is an absolute lifetime wearing an idle window's name,
   * and `SESSION_ABSOLUTE_HOURS` is the honest place to say that.
   */
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  /** Hard ceiling on a staff session, measured from sign-in. Never extended by activity. */
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(168).default(12),
```

- [ ] **Step 4: Add the fields to the test fixture**

`server/tests/doors.test.ts` builds a frozen `Config` with `satisfies Config`, so it stops compiling until both fields exist. Add them after `MAX_UPLOAD_MB: 10,`:

```ts
  SESSION_IDLE_MINUTES: 30,
  SESSION_ABSOLUTE_HOURS: 12,
```

- [ ] **Step 5: Run the tests and the typecheck**

```bash
pnpm test -- doors.test.ts && pnpm typecheck
```

Expected: PASS, and no type errors.

- [ ] **Step 6: Commit**

```bash
pnpm exec biome check --write src/config.ts tests/doors.test.ts
git add src/config.ts tests/doors.test.ts
git commit -m "feat(config): parse the session lifetimes that .env already declares"
```

---

## Task 2: `verifyPassword` and the password floor

**Files:**
- Modify: `server/src/auth/password.ts`
- Modify: `server/tests/password.test.ts`

**Interfaces:**
- Consumes: `ARGON2_OPTIONS`, `hashPassword` (both already in the module).
- Produces: `MIN_PASSWORD_LENGTH: number`, `verifyPassword(storedHash: string, plain: string): Promise<boolean>`, `verifyAgainstAbsentUser(plain: string): Promise<void>`.

`@node-rs/argon2` exports `verify(hashed, password, options?, abortSignal?): Promise<boolean>` taking the same `Options` object as `hash`, which is what lets `ARGON2_OPTIONS` be passed to both.

- [ ] **Step 1: Write the failing test**

Replace the import at the top of `server/tests/password.test.ts` with:

```ts
import {
  generateTempPassword,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_LENGTH,
  verifyAgainstAbsentUser,
  verifyPassword,
} from "../src/auth/password.js";
```

Then append:

```ts
describe("verifyPassword", () => {
  it("accepts the password that produced the hash", async () => {
    const stored = await hashPassword("correct horse battery staple");

    expect(await verifyPassword(stored, "correct horse battery staple")).toBe(true);
  });

  it("rejects a different password", async () => {
    const stored = await hashPassword("correct horse battery staple");

    expect(await verifyPassword(stored, "Correct horse battery staple")).toBe(false);
  });

  it("returns false rather than throwing on a hash it did not produce", async () => {
    // The integration fixtures seed rows whose password_hash is the literal "not-a-real-hash".
    // Sign-in must fail for those rows, not crash the door.
    await expect(verifyPassword("not-a-real-hash", "anything")).resolves.toBe(false);
    await expect(verifyPassword("", "anything")).resolves.toBe(false);
  });
});

describe("verifyAgainstAbsentUser", () => {
  it("resolves without throwing, whatever it is given", async () => {
    await expect(verifyAgainstAbsentUser("anything at all")).resolves.toBeUndefined();
  });

  it("costs about as much as a real verification", async () => {
    // The point of the call is that an unknown address is not visibly faster than a known one.
    // The bound is loose on purpose: this asserts the work happens, not how fast the machine is.
    const stored = await hashPassword("a real password");

    const realStart = performance.now();
    await verifyPassword(stored, "a real password");
    const real = performance.now() - realStart;

    const absentStart = performance.now();
    await verifyAgainstAbsentUser("a real password");
    const absent = performance.now() - absentStart;

    expect(absent).toBeGreaterThan(real / 4);
  });
});

describe("MIN_PASSWORD_LENGTH", () => {
  it("is the one number the form and the server both read", () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(12);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm test -- password.test.ts
```

Expected: FAIL — the three new names are not exported.

- [ ] **Step 3: Implement**

In `server/src/auth/password.ts`, change the first two imports to:

```ts
import { randomBytes } from "node:crypto";
import { type Algorithm, hash, hashSync, verify } from "@node-rs/argon2";
```

Then append to the file:

```ts
/**
 * Shortest password a user may choose for themselves.
 *
 * Exported because the change-password form renders its `minlength` from it. A browser rule that
 * disagrees with the server's rule is either a lie to the user or a hole in the check, and this
 * module already treats "parameters that drift silently reject everyone" as the thing to prevent.
 *
 * It does not apply to `generateTempPassword`, which is longer and machine-chosen.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * A hash of a fixed string, so an unknown email costs the same as a known one.
 *
 * Sign-in that skips the Argon2 work when no such user exists answers visibly sooner, and that
 * difference alone enumerates staff addresses. Computed once at import — roughly one hash's worth
 * of startup time, paid at boot rather than per request.
 */
const ABSENT_USER_HASH = hashSync("no account has this password", ARGON2_OPTIONS);

/**
 * Check a password against a stored Argon2id hash.
 *
 * Returns false rather than throwing when the stored value is not a hash this module produced.
 * A row whose `password_hash` is a placeholder must fail sign-in like any wrong password; letting
 * the parse error escape would turn a bad row into a 500 and tell the caller the row exists.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Spend a verification's worth of work and prove nothing.
 *
 * Sign-in calls this on the branch where the address matched no active account, so that branch
 * takes about as long as the branch where it did.
 */
export async function verifyAgainstAbsentUser(plain: string): Promise<void> {
  await verifyPassword(ABSENT_USER_HASH, plain);
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm test -- password.test.ts && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm exec biome check --write src/auth/password.ts tests/password.test.ts
git add src/auth/password.ts tests/password.test.ts
git commit -m "feat(auth): verify a password, at the same cost when the account does not exist"
```

---

## Task 3: Grant the application role its session writes

`drizzle/0003_admin_app_role.sql:34` grants `ereports_app` only `SELECT, DELETE` on `sessions`, with the comment *"No INSERT: this slice never creates one."* True of the admin CLI; false from here on. Sign-in inserts a row and every guarded request updates `last_seen_at`.

This is a grant, not a connection change. `compose.yml` still points the application at the owner role and this task does not touch it.

**Files:**
- Create: `server/drizzle/0004_session_write_grants.sql`
- Modify: `server/drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: the `ereports_app` role created by `0003`.
- Produces: `INSERT` and `UPDATE` on `sessions` for `ereports_app`. Task 9's integration tests fail without it.

- [ ] **Step 1: Write the migration**

Create `server/drizzle/0004_session_write_grants.sql`:

```sql
-- Sign-in inserts a session row, and every request inside the staff door's authenticated area
-- slides `last_seen_at`. Migration 0003 withheld both privileges on purpose -- its comment reads
-- "No INSERT: this slice never creates one" -- which was true of the admin CLI and stops being
-- true here.
--
-- Still withheld: nothing is granted on reports, assessments, attachments or report_counters.
-- No route in this slice touches them, and a grant that exists before its caller does is one
-- nobody will think to remove.
--
-- The application continues to connect as the owner. Granting to ereports_app takes nothing away
-- from the owner, so this changes no running behaviour -- only what the restricted role, which
-- the integration tests already use, is allowed to do.

GRANT INSERT, UPDATE ON TABLE "sessions" TO "ereports_app";
```

- [ ] **Step 2: Register it in the journal**

drizzle-kit only runs migrations listed in `drizzle/meta/_journal.json`. Append a fourth entry inside `entries`, after the `0003_admin_app_role` object:

```json
    {
      "idx": 4,
      "version": "7",
      "when": 1787149759000,
      "tag": "0004_session_write_grants",
      "breakpoints": true
    }
```

- [ ] **Step 3: Apply it to both databases**

`drizzle.config.ts` reads `DATABASE_URL` and nothing else, so the target database is chosen by that variable. **Both** must receive this migration: `e_reports` for `pnpm dev`, and `ereports_test` for `pnpm test:integration`. Task 9 fails with `42501 permission denied for table sessions` if the test database is skipped.

Development database (`e_reports`):

```bash
pnpm db:migrate
```

Test database (`ereports_test`), via the owner URL — `TEST_DATABASE_URL` is the restricted role and cannot GRANT:

```bash
DATABASE_URL="$(grep -E '^TEST_OWNER_DATABASE_URL=' .env | cut -d= -f2-)" pnpm db:migrate
```

- [ ] **Step 4: Check the grant landed in both**

```bash
psql "$(grep -E '^TEST_OWNER_DATABASE_URL=' .env | cut -d= -f2-)" -c "SELECT privilege_type FROM information_schema.table_privileges WHERE grantee = 'ereports_app' AND table_name = 'sessions' ORDER BY privilege_type"
```

Expected: four rows — `DELETE`, `INSERT`, `SELECT`, `UPDATE`. Repeat against `DATABASE_URL` for the development database.

- [ ] **Step 5: Commit**

Biome's `files.includes` covers `src/**`, `tests/**`, root `*.ts` and root `*.json`, so neither file here is linted — there is nothing to format.

```bash
git add drizzle/0004_session_write_grants.sql drizzle/meta/_journal.json
git commit -m "feat(db): let the app role create and touch sessions"
```

---

## Task 4: The session module

**Files:**
- Create: `server/src/auth/session.ts`
- Create: `server/tests/session.test.ts`

**Interfaces:**
- Consumes: `Database` from `src/db/client.js`.
- Produces: `SESSION_COOKIE: string`, `SESSION_COOKIE_OPTIONS`, `type Executor`, `type StaffSession`, `generateSessionToken(): string`, `hashSessionToken(token: string): string`, `createSession(exec, input): Promise<string>`, `loadSession(exec, token, idleMinutes): Promise<StaffSession | undefined>`, `destroySession(exec, token): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/session.test.ts`. These cases need no database — the ones that do live in Task 9.

```ts
import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashSessionToken,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "../src/auth/session.js";

describe("SESSION_COOKIE", () => {
  it("carries the __Host- prefix", () => {
    expect(SESSION_COOKIE.startsWith("__Host-")).toBe(true);
  });
});

describe("SESSION_COOKIE_OPTIONS", () => {
  // The browser refuses a __Host- cookie that breaks any of these, so getting one wrong means
  // sign-in silently never persists.
  it("satisfies every condition the __Host- prefix imposes", () => {
    expect(SESSION_COOKIE_OPTIONS.path).toBe("/");
    expect(SESSION_COOKIE_OPTIONS.secure).toBe(true);
    expect(SESSION_COOKIE_OPTIONS).not.toHaveProperty("domain");
  });

  it("keeps the cookie out of JavaScript and off cross-site posts", () => {
    expect(SESSION_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(SESSION_COOKIE_OPTIONS.sameSite).toBe("lax");
  });

  it("sets no lifetime of its own", () => {
    // The sessions row is the only clock. A Max-Age here would be a second one, free to disagree.
    expect(SESSION_COOKIE_OPTIONS).not.toHaveProperty("maxAge");
    expect(SESSION_COOKIE_OPTIONS).not.toHaveProperty("expires");
  });
});

describe("generateSessionToken", () => {
  it("is url-safe, so it survives a Set-Cookie unescaped", () => {
    expect(generateSessionToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("carries at least 256 bits", () => {
    // 32 bytes in base64url is 43 characters.
    expect(generateSessionToken().length).toBeGreaterThanOrEqual(43);
  });

  it("does not repeat itself", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateSessionToken()));

    expect(tokens.size).toBe(500);
  });

  it("is opaque — it encodes nothing", () => {
    // A JWT would show three dot-separated base64 segments here. Nothing about the user may be
    // recoverable from the cookie; the sessions row is the only place the identity lives.
    expect(generateSessionToken()).not.toContain(".");
  });
});

describe("hashSessionToken", () => {
  it("returns a hex sha256 digest", () => {
    expect(hashSessionToken("token")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable, so the same cookie finds the same row", () => {
    expect(hashSessionToken("token")).toBe(hashSessionToken("token"));
  });

  it("does not contain the token it hashed", () => {
    const token = generateSessionToken();

    expect(hashSessionToken(token)).not.toContain(token);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm test -- session.test.ts
```

Expected: FAIL — `src/auth/session.ts` does not exist.

- [ ] **Step 3: Implement the module**

Create `server/src/auth/session.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../db/client.js";

/**
 * Anything that can run a statement: the pool, or a transaction handle inside one.
 *
 * Changing a password deletes every session and issues a replacement in one transaction, so these
 * functions have to accept both.
 */
export type Executor = Pick<Database, "execute">;

/**
 * The cookie name, prefix included.
 *
 * `__Host-` is enforced by the browser rather than by us: it refuses the cookie unless it is
 * Secure, has `Path=/`, and carries no `Domain`. The missing Domain is the half that matters —
 * it makes the cookie unable to reach the public door's hostname even by misconfiguration, which
 * is the same separation `constrainToHost` gives the routes.
 */
export const SESSION_COOKIE = "__Host-ae_session";

/**
 * Attributes the prefix requires, in one place.
 *
 * `secure` is unconditional, development included. Making it depend on NODE_ENV would mean the
 * cookie a developer tests is not the cookie production sets. Chrome and Firefox treat
 * `http://*.localhost` as a trustworthy origin and accept it over plain http; Safari does not, so
 * a Safari user needs a TLS development setup rather than a weakened cookie.
 *
 * `sameSite: "lax"` is this slice's CSRF control: browsers withhold a Lax cookie from a
 * cross-site POST, so a form on another origin cannot drive `/change-password` or `/logout`.
 * Lax rather than Strict because Strict would also withhold it from an ordinary link into the
 * portal, which reads to the user as being signed out.
 *
 * There is deliberately no `maxAge` or `expires`. The `sessions` row is the only clock; a second
 * one in the cookie would be free to disagree with it.
 */
export const SESSION_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "lax",
} as const;

/** 256 bits. The token is a random secret, never a claim — nothing is encoded in it. */
const TOKEN_BYTES = 32;

/** Everything a request handler is allowed to know, all of it read from the database. */
export type StaffSession = {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  role: "manager" | "assessor" | "administrator";
  mustChangePassword: boolean;
};

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * SHA-256, deliberately not Argon2id.
 *
 * A password is short and guessable, so verifying one must be slow. This token is 32 bytes from
 * the CSPRNG, so there is nothing to guess and a slow hash would only add its cost to every
 * request. What hashing buys is that a stolen database dump holds no usable cookie.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type CreateSessionInput = {
  userId: string;
  absoluteHours: number;
  ip?: string | undefined;
  userAgent?: string | undefined;
};

/**
 * Open a session and hand back the token that addresses it.
 *
 * The token is returned once and never stored — only its hash goes in the row, so nothing but the
 * browser's cookie can reproduce it. `expires_at` is computed by PostgreSQL from `now()`, so a
 * process whose clock has drifted cannot mint a longer-lived session than the operator configured.
 */
export async function createSession(exec: Executor, input: CreateSessionInput): Promise<string> {
  const token = generateSessionToken();

  await exec.execute(sql`
    INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
    VALUES (
      ${input.userId},
      ${hashSessionToken(token)},
      now() + (${input.absoluteHours}::int * INTERVAL '1 hour'),
      ${input.ip ?? null},
      ${input.userAgent ?? null}
    )
  `);

  return token;
}

/**
 * Resolve a cookie token to a live session, sliding the idle window as it goes.
 *
 * Both deadlines are tested in the same statement that moves `last_seen_at`, against a single
 * `now()`. Reading the row and then deciding in Node would leave a window in which a session that
 * expired between the two steps is admitted.
 *
 * `u.is_active` is in the WHERE clause rather than checked afterwards, so deactivating an account
 * ends its sessions on their next request without anything having to remember to delete them.
 */
export async function loadSession(
  exec: Executor,
  token: string,
  idleMinutes: number,
): Promise<StaffSession | undefined> {
  const rows = await exec.execute(sql`
    UPDATE sessions AS s
       SET last_seen_at = now()
      FROM users AS u
     WHERE s.user_id = u.id
       AND s.token_hash = ${hashSessionToken(token)}
       AND s.expires_at > now()
       AND s.last_seen_at + (${idleMinutes}::int * INTERVAL '1 minute') > now()
       AND u.is_active
    RETURNING s.id, u.id AS user_id, u.email, u.full_name, u.role, u.must_change_password
  `);

  const row = rows[0] as
    | {
        id: string;
        user_id: string;
        email: string;
        full_name: string;
        role: StaffSession["role"];
        must_change_password: boolean;
      }
    | undefined;

  if (!row) return undefined;

  return {
    sessionId: row.id,
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    mustChangePassword: row.must_change_password,
  };
}

/** Ends one session — the one whose token is in this browser's cookie. */
export async function destroySession(exec: Executor, token: string): Promise<void> {
  await exec.execute(sql`DELETE FROM sessions WHERE token_hash = ${hashSessionToken(token)}`);
}
```

> If TypeScript rejects the transaction handle where `Executor` is expected in Task 7, widen the alias to `{ execute: (query: SQL) => Promise<unknown[]> }` — importing `SQL` as a type from `drizzle-orm` — and leave `Database` in `src/db/client.ts` alone.

- [ ] **Step 4: Run the tests**

```bash
pnpm test -- session.test.ts && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm exec biome check --write src/auth/session.ts tests/session.test.ts
git add src/auth/session.ts tests/session.test.ts
git commit -m "feat(auth): opaque database sessions behind a __Host- cookie"
```

---

## Task 5: Sign in

Replaces the `503` placeholder at `src/doors/staff/routes/login.tsx:32`. The route keeps its path, so the form's `action="/login"` in `views/login.tsx` does not change.

`POST /login` lives in the staff door's plugin scope, and `constrainToHost` stamps a Host constraint onto every route registered there — so it answers on `STAFF_HOST` and nowhere else, which the existing "answers nothing at all on an unknown host" case already covers.

**Files:**
- Modify: `server/src/doors/staff/routes/login.tsx`
- Modify: `server/src/doors/staff/index.ts`
- Modify: `server/src/server.ts`
- Modify: `server/tests/doors.test.ts`

**Interfaces:**
- Consumes: `verifyPassword`, `verifyAgainstAbsentUser` (Task 2); `createSession`, `SESSION_COOKIE`, `SESSION_COOKIE_OPTIONS` (Task 4); `Config["SESSION_ABSOLUTE_HOURS"]` (Task 1).
- Produces: `LoginRoutesOptions` gains `sessionAbsoluteHours: number`; `StaffDoorOptions` gains `sessionIdleMinutes: number` and `sessionAbsoluteHours: number`.

- [ ] **Step 1: Replace the placeholder test**

In `server/tests/doors.test.ts`, replace the whole `describe("staff sign-in")` block. The suite runs with no database, so only the branches that answer before the first query are testable here; the rest is Task 9. Every case below omits either `email` or `password`, so the Zod check answers first and nothing opens a connection.

```ts
describe("staff sign-in", () => {
  /** Post the form the way a browser would, with no JavaScript involved. */
  async function signIn(fields: Record<string, string>) {
    return app.inject({
      method: "POST",
      url: "/login",
      headers: {
        host: config.STAFF_HOST,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: new URLSearchParams(fields).toString(),
    });
  }

  it("rejects a submission with no password before it reaches the database", async () => {
    const res = await signIn({ email: "a@tmda.go.tz" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("Email or password is incorrect");
  });

  it("never echoes the submitted password back onto the page", async () => {
    const res = await signIn({ email: "", password: "hunter2" });

    expect(res.body).not.toContain("hunter2");
  });

  it("says the same thing however the credentials are malformed", async () => {
    // Distinguishing "no such account" from "wrong password" hands an attacker a list of real
    // staff addresses. Both malformed shapes must produce one sentence.
    const missingPassword = await signIn({ email: "a@tmda.go.tz" });
    const missingEmail = await signIn({ password: "hunter2" });

    expect(missingPassword.body).toContain("Email or password is incorrect");
    expect(missingEmail.body).toContain("Email or password is incorrect");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm test -- doors.test.ts
```

Expected: FAIL — the route still answers 503 with "Sign-in is not available yet".

- [ ] **Step 3: Rewrite the login route**

Replace the whole of `server/src/doors/staff/routes/login.tsx` with:

```tsx
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyAgainstAbsentUser, verifyPassword } from "../../../auth/password.js";
import { createSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "../../../auth/session.js";
import { LoginPage } from "../views/login.js";

export type LoginRoutesOptions = {
  /** Absolute origin of the public door, for the cross-host link to the orange form. */
  publicFormUrl: string;
  /** Hard ceiling on a session, from config. Never a literal. */
  sessionAbsoluteHours: number;
};

/**
 * One sentence for every way sign-in can fail.
 *
 * "No such account", "wrong password" and "that account is deactivated" are three different
 * facts, and telling them apart hands an attacker a list of real staff addresses. Someone who
 * genuinely mistyped is no worse off — they retype either way.
 */
const SIGN_IN_FAILED = "Email or password is incorrect.";

/**
 * The password is bounded before it is hashed.
 *
 * Argon2id over a megabyte of submitted text costs the server real memory and time, so an
 * unbounded field is a cheap way to exhaust the process. 1024 is far past any real password.
 */
const Credentials = z.object({
  // Normalized exactly as createAdmin normalizes it, or an address stored lower-cased would not
  // be found when its owner types it with a capital.
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(1024),
});

/**
 * The staff sign-in page and the sign-in itself.
 *
 * These routes are the staff door's anonymous tier — the only routes reachable without a session.
 * Everything else lives in a nested scope behind the guard, so a route added later is protected
 * unless someone deliberately registers it out here.
 */
export async function loginRoutes(app: FastifyInstance, opts: LoginRoutesOptions): Promise<void> {
  app.get("/", async (_request, reply) =>
    reply.html(<LoginPage publicFormUrl={opts.publicFormUrl} />),
  );

  app.post("/login", async (request, reply) => {
    const parsed = Credentials.safeParse(request.body);

    if (!parsed.success) {
      // The same sentence as a wrong password: a submission that fails the shape check must not
      // be distinguishable from one that fails the credential check.
      return reply
        .status(400)
        .html(<LoginPage publicFormUrl={opts.publicFormUrl} error={SIGN_IN_FAILED} />);
    }

    const { email, password } = parsed.data;

    const rows = await app.db.execute(sql`
      SELECT id, password_hash, must_change_password
        FROM users
       WHERE email = ${email} AND is_active
    `);
    const user = rows[0] as
      | { id: string; password_hash: string; must_change_password: boolean }
      | undefined;

    if (!user) {
      // Spend a verification's worth of work anyway, so an unknown address is not visibly faster.
      await verifyAgainstAbsentUser(password);
      return reply
        .status(401)
        .html(<LoginPage publicFormUrl={opts.publicFormUrl} error={SIGN_IN_FAILED} />);
    }

    if (!(await verifyPassword(user.password_hash, password))) {
      return reply
        .status(401)
        .html(<LoginPage publicFormUrl={opts.publicFormUrl} error={SIGN_IN_FAILED} />);
    }

    const token = await app.db.transaction(async (tx) => {
      const issued = await createSession(tx, {
        userId: user.id,
        absoluteHours: opts.sessionAbsoluteHours,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });

      await tx.execute(sql`UPDATE users SET last_sign_in_at = now() WHERE id = ${user.id}`);

      // No `after` payload: there is nothing to record about a sign-in beyond the actor and the
      // time, and anything more risks carrying the credential into the trail.
      await tx.execute(sql`
        INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id)
        VALUES (${user.id}, 'user.signed_in', 'user', ${user.id})
      `);

      return issued;
    });

    reply.setCookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);

    // 303 turns the POST into a GET, so a refresh reloads the page they landed on instead of
    // re-posting the password.
    return reply.redirect(user.must_change_password ? "/change-password" : "/dashboard", 303);
  });

  app.get("/healthz", async () => ({ status: "ok", door: "staff" }));
}
```

- [ ] **Step 4: Thread the config through the door**

In `server/src/doors/staff/index.ts`, extend the options type:

```ts
export type StaffDoorOptions = {
  host: string;
  /** Absolute origin of the public door, for the cross-host link to the orange form. */
  publicOrigin: string;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
};
```

and inside `staffDoor`, replace the single `register` call with:

```ts
  await app.register(loginRoutes, {
    publicFormUrl: opts.publicOrigin,
    sessionAbsoluteHours: opts.sessionAbsoluteHours,
  });
```

`sessionIdleMinutes` is unused until Task 6. `noUnusedParameters` does not complain about an unread property, so this compiles.

- [ ] **Step 5: Pass the values from the composition root**

In `server/src/server.ts`, extend the staff door registration:

```ts
  await app.register(staffDoor, {
    host: config.STAFF_HOST,
    publicOrigin: publicOrigin(config),
    sessionIdleMinutes: config.SESSION_IDLE_MINUTES,
    sessionAbsoluteHours: config.SESSION_ABSOLUTE_HOURS,
  });
```

- [ ] **Step 6: Run the tests**

```bash
pnpm test && pnpm typecheck
```

Expected: PASS. The doors suite still never opens a connection, because every case it runs answers before the first query.

- [ ] **Step 7: Commit**

```bash
pnpm exec biome check --write src/doors/staff/routes/login.tsx src/doors/staff/index.ts src/server.ts tests/doors.test.ts
git add src/doors/staff/routes/login.tsx src/doors/staff/index.ts src/server.ts tests/doors.test.ts
git commit -m "feat(staff): verify credentials and open a database session"
```

---

## Task 6: The authenticated area

Three nested Fastify encapsulation contexts. A hook added with `addHook` applies to the scope it was added in and to every scope registered inside it, so a route added to the inner context later is guarded without its author doing anything — the same argument `constrainToHost` makes for host isolation.

**Files:**
- Create: `server/src/doors/staff/session-guard.ts`
- Create: `server/src/doors/staff/views/dashboard.tsx`
- Create: `server/src/doors/staff/routes/dashboard.tsx`
- Create: `server/src/doors/staff/routes/logout.ts`
- Modify: `server/src/doors/staff/index.ts`
- Modify: `server/tests/doors.test.ts`

**Interfaces:**
- Consumes: `loadSession`, `destroySession`, `SESSION_COOKIE`, `SESSION_COOKIE_OPTIONS`, `StaffSession` (Task 4).
- Produces: `requireSession(app, { idleMinutes })`, `requirePasswordChanged(app)`, `currentSession(request): StaffSession`, `dashboardRoutes(app)`, `logoutRoutes(app)`, and the `FastifyRequest` augmentation carrying `staffSession` and `staffSessionToken`.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/doors.test.ts`. These run without a database: with no cookie present the guard redirects before it would query.

```ts
describe("the staff door's authenticated area", () => {
  it("sends an unsigned-in visitor to the sign-in page", async () => {
    const res = await app.inject({ url: "/dashboard", headers: { host: config.STAFF_HOST } });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
  });

  it("guards the forced password change too — it is not an anonymous page", async () => {
    const res = await app.inject({
      url: "/change-password",
      headers: { host: config.STAFF_HOST },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
  });

  it("keeps the authenticated area off the public host entirely", async () => {
    // Not a redirect to sign-in: on the public hostname these routes must not exist at all.
    const res = await app.inject({ url: "/dashboard", headers: { host: config.PUBLIC_HOST } });

    expect(res.statusCode).toBe(404);
  });

  it("leaves the sign-in page itself reachable", async () => {
    const res = await app.inject({ url: "/", headers: { host: config.STAFF_HOST } });

    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm test -- doors.test.ts
```

Expected: FAIL — `/dashboard` and `/change-password` 404 on the staff host.

- [ ] **Step 3: Write the guard**

Create `server/src/doors/staff/session-guard.ts`:

```ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  loadSession,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  type StaffSession,
} from "../../auth/session.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireSession`. Null on every route outside the authenticated area. */
    staffSession: StaffSession | null;
    /** The cookie value behind `staffSession`, kept so sign-out can delete that exact row. */
    staffSessionToken: string | null;
  }
}

/**
 * Require a live session for every route in this scope and every scope nested inside it.
 *
 * Registered as a hook rather than checked per route on purpose. A route added to this context
 * next year is guarded because of where it was registered, not because its author remembered —
 * the same reason `constrainToHost` stamps the Host constraint from above.
 */
export function requireSession(app: FastifyInstance, opts: { idleMinutes: number }): void {
  app.decorateRequest("staffSession", null);
  app.decorateRequest("staffSessionToken", null);

  app.addHook("onRequest", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    const session = token ? await loadSession(app.db, token, opts.idleMinutes) : undefined;

    if (!session) {
      // The cookie names a session that has expired, been deleted, or belongs to a deactivated
      // account. Clear it so the browser stops sending a token that can never work again.
      if (token) reply.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
      return reply.redirect("/", 302);
    }

    request.staffSession = session;
    request.staffSessionToken = token ?? null;
  });
}

/**
 * Additionally require that the forced first-sign-in password change is done.
 *
 * This is the whole of "the user cannot use the rest of the staff app": the rest of the staff app
 * is defined as the scope this hook sits on. `/change-password` and `/logout` are registered one
 * level out, so a user who must change their password can reach exactly those two and nothing
 * else.
 */
export function requirePasswordChanged(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    if (request.staffSession?.mustChangePassword) {
      return reply.redirect("/change-password", 302);
    }
  });
}

/**
 * The session the guard has already proven is present.
 *
 * Throws rather than redirecting: the hook redirects when there is none, so reaching here without
 * one means the route was registered in the wrong scope. That should be a loud 500 in a test run,
 * not a signed-out page quietly rendered to someone who is signed in.
 */
export function currentSession(request: FastifyRequest): StaffSession {
  if (!request.staffSession) {
    throw new Error("currentSession() called outside the staff door's authenticated area.");
  }

  return request.staffSession;
}
```

- [ ] **Step 4: Write the landing page**

Create `server/src/doors/staff/views/dashboard.tsx`:

```tsx
import { Layout } from "../../../views/shared/layout.js";

export type DashboardPageProps = {
  fullName: string;
  role: string;
};

/**
 * Where a fully signed-in user lands.
 *
 * Deliberately almost empty. It exists because sign-in needs a destination and because the
 * forced-password-change gate needs something to hold shut; the staff app proper is later slices.
 */
export function DashboardPage({ fullName, role }: DashboardPageProps): JSX.Element {
  return (
    <Layout title="AE Reports — Staff" locale="en" bodyClass="staff">
      <main class="staff-shell">
        <h1>AE Reports</h1>
        <p>
          Signed in as <strong safe>{fullName}</strong> (<span safe>{role}</span>)
        </p>

        {/* A POST, not a link: signing out changes state, and a Lax cookie is withheld from a
            cross-site POST, which is what stops another origin doing it for the user. */}
        <form method="POST" action="/logout">
          <button type="submit" class="btn">
            Sign out
          </button>
        </form>
      </main>
    </Layout>
  );
}
```

`fullName` is user-supplied — set by whoever created the account — so it carries `safe`.

- [ ] **Step 5: Write the two routes**

Create `server/src/doors/staff/routes/dashboard.tsx`:

```tsx
import type { FastifyInstance } from "fastify";
import { currentSession } from "../session-guard.js";
import { DashboardPage } from "../views/dashboard.js";

/** Registered in the innermost scope, so both guards have already run. */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dashboard", async (request, reply) => {
    const session = currentSession(request);

    return reply.html(<DashboardPage fullName={session.fullName} role={session.role} />);
  });
}
```

Create `server/src/doors/staff/routes/logout.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { destroySession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "../../../auth/session.js";

/**
 * Sign out.
 *
 * Registered one scope out from the rest of the staff app, so it stays reachable to a user held
 * at the forced password change. Someone who cannot get in must still be able to get out.
 *
 * The row is deleted, not just the cookie cleared. Clearing only the cookie would leave a live
 * session behind for anyone who had already copied the token.
 */
export async function logoutRoutes(app: FastifyInstance): Promise<void> {
  app.post("/logout", async (request, reply) => {
    if (request.staffSessionToken) {
      await destroySession(app.db, request.staffSessionToken);
    }

    reply.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);

    return reply.redirect("/", 303);
  });
}
```

- [ ] **Step 6: Nest the contexts**

Replace `server/src/doors/staff/index.ts` with:

```ts
import type { FastifyInstance } from "fastify";
import { constrainToHost } from "../host-scope.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { loginRoutes } from "./routes/login.js";
import { logoutRoutes } from "./routes/logout.js";
import { requirePasswordChanged, requireSession } from "./session-guard.js";

export type StaffDoorOptions = {
  host: string;
  /** Absolute origin of the public door, for the cross-host link to the orange form. */
  publicOrigin: string;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
};

/**
 * The staff portal door: three nested scopes, each one narrower than the last.
 *
 * Reachable only on STAFF_HOST. The session cookie uses the `__Host-` prefix, which forbids a
 * Domain attribute and so cannot be sent to the public hostname at all.
 *
 * The nesting is the access control. A hook applies to its own scope and every scope inside it,
 * so where a route is registered decides what it requires — there is no allowlist of public paths
 * to keep in step with the routes, and no way to add a route to the staff app that forgets the
 * gate.
 */
export async function staffDoor(app: FastifyInstance, opts: StaffDoorOptions): Promise<void> {
  constrainToHost(app, opts.host);

  // Anonymous: the sign-in page, the sign-in itself, and the health probe.
  await app.register(loginRoutes, {
    publicFormUrl: opts.publicOrigin,
    sessionAbsoluteHours: opts.sessionAbsoluteHours,
  });

  await app.register(async (signedIn) => {
    // Signed in, but possibly still owing a password change.
    requireSession(signedIn, { idleMinutes: opts.sessionIdleMinutes });

    await signedIn.register(logoutRoutes);

    await signedIn.register(async (active) => {
      // The staff app proper. Everything registered from here down is closed to a user whose
      // must_change_password is still true.
      requirePasswordChanged(active);

      await active.register(dashboardRoutes);
    });
  });
}
```

`/change-password` joins the middle scope in Task 7.

- [ ] **Step 7: Run the tests**

```bash
pnpm test && pnpm typecheck
```

Expected: the `/dashboard` cases PASS. The `/change-password` case still FAILS with 404 — that route arrives in Task 7. Leave it red and move on; it is the next task's first proof.

- [ ] **Step 8: Commit**

```bash
pnpm exec biome check --write src/doors/staff/session-guard.ts src/doors/staff/views/dashboard.tsx src/doors/staff/routes/dashboard.tsx src/doors/staff/routes/logout.ts src/doors/staff/index.ts tests/doors.test.ts
git add src/doors/staff/session-guard.ts src/doors/staff/views/dashboard.tsx src/doors/staff/routes/dashboard.tsx src/doors/staff/routes/logout.ts src/doors/staff/index.ts tests/doors.test.ts
git commit -m "feat(staff): nest the authenticated area behind a session guard"
```

---

## Task 7: The forced password change

The view already exists at `src/doors/staff/views/change-password.tsx` and posts to `/change-password`, but nothing imports it and no route answers that path. It also hand-rolls its own `<html>` instead of using the shared `Layout`, and its `{props.error}` has no `safe` attribute — under `@kitajs/html` that interpolates unescaped.

**Files:**
- Modify: `server/src/doors/staff/views/change-password.tsx`
- Create: `server/src/doors/staff/routes/change-password.tsx`
- Modify: `server/src/doors/staff/index.ts`

**Interfaces:**
- Consumes: `MIN_PASSWORD_LENGTH`, `hashPassword`, `verifyPassword` (Task 2); `createSession`, `SESSION_COOKIE`, `SESSION_COOKIE_OPTIONS` (Task 4); `currentSession` (Task 6).
- Produces: `ChangePasswordPage(props: ChangePasswordPageProps)`, `changePasswordRoutes(app, { sessionAbsoluteHours })`.

- [ ] **Step 1: Confirm the failing test**

The `/change-password` case from Task 6 is already written and already failing.

```bash
pnpm test -- doors.test.ts
```

Expected: FAIL — "guards the forced password change too" gets 404, not 302.

- [ ] **Step 2: Bring the view in line**

Replace the whole of `server/src/doors/staff/views/change-password.tsx` with:

```tsx
import { MIN_PASSWORD_LENGTH } from "../../../auth/password.js";
import { Layout } from "../../../views/shared/layout.js";

export type ChangePasswordPageProps = {
  error?: string;
  /** True on the forced first sign-in, when the rest of the portal is still shut. */
  isForced?: boolean;
};

/**
 * Where a user sets their own password.
 *
 * `minlength` is rendered from the same constant the route enforces, so the browser cannot
 * promise a rule the server does not apply, or refuse one it would have accepted.
 */
export function ChangePasswordPage({ error, isForced }: ChangePasswordPageProps): JSX.Element {
  return (
    <Layout title="Change Password — AE Reports" locale="en" bodyClass="staff-login">
      <div class="login-card">
        <div class="login-header">
          <h1>Change Password</h1>
          {isForced ? (
            <p>You must set a new password before continuing.</p>
          ) : (
            <p>Update your password</p>
          )}
        </div>

        {error && (
          <div class="alert alert-error" safe>
            {error}
          </div>
        )}

        <form method="POST" action="/change-password" class="login-form">
          <div class="field">
            <label for="currentPassword">Current Password</label>
            <input
              type="password"
              id="currentPassword"
              name="currentPassword"
              required
              autocomplete="current-password"
            />
          </div>

          <div class="field">
            <label for="newPassword">New Password</label>
            <input
              type="password"
              id="newPassword"
              name="newPassword"
              required
              minlength={MIN_PASSWORD_LENGTH}
              autocomplete="new-password"
            />
          </div>

          <div class="field">
            <label for="confirmPassword">Confirm New Password</label>
            <input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              required
              minlength={MIN_PASSWORD_LENGTH}
              autocomplete="new-password"
            />
          </div>

          <button type="submit" class="btn btn-primary">
            Update Password
          </button>
        </form>
      </div>
    </Layout>
  );
}
```

Two things changed beyond the wrapper: the error is now `safe`, and `minlength` moved from the literal `"10"` to `MIN_PASSWORD_LENGTH`. If `@kitajs/html` rejects the numeric attribute, use `minlength={String(MIN_PASSWORD_LENGTH)}` — do not go back to a literal.

The page also loses its hardcoded `/assets/staff.css`, which does not exist; `Layout` links `/assets/app.css`, which does.

- [ ] **Step 3: Write the route**

Create `server/src/doors/staff/routes/change-password.tsx`:

```tsx
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "../../../auth/password.js";
import { createSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "../../../auth/session.js";
import { currentSession } from "../session-guard.js";
import { ChangePasswordPage } from "../views/change-password.js";

export type ChangePasswordRoutesOptions = {
  sessionAbsoluteHours: number;
};

const CURRENT_WRONG = "Your current password is incorrect.";
const TOO_SHORT = `Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
const NOT_CONFIRMED = "The two new passwords do not match.";
const NOT_CHANGED = "Your new password must be different from your current one.";

const NewPassword = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(1024),
  confirmPassword: z.string().min(1).max(1024),
});

/**
 * Setting a password, and the only way out of the forced first-sign-in gate.
 *
 * Registered in the middle scope: a session is required, but `requirePasswordChanged` is not
 * applied here — otherwise the gate would redirect this page to itself.
 */
export async function changePasswordRoutes(
  app: FastifyInstance,
  opts: ChangePasswordRoutesOptions,
): Promise<void> {
  app.get("/change-password", async (request, reply) =>
    reply.html(<ChangePasswordPage isForced={currentSession(request).mustChangePassword} />),
  );

  app.post("/change-password", async (request, reply) => {
    const session = currentSession(request);

    /** Re-render with a message, keeping the forced framing if that is why they are here. */
    const fail = (status: number, error: string) =>
      reply
        .status(status)
        .html(<ChangePasswordPage isForced={session.mustChangePassword} error={error} />);

    const parsed = NewPassword.safeParse(request.body);
    if (!parsed.success) return fail(422, TOO_SHORT);

    const { currentPassword, newPassword, confirmPassword } = parsed.data;

    if (newPassword !== confirmPassword) return fail(422, NOT_CONFIRMED);
    if (newPassword === currentPassword) return fail(422, NOT_CHANGED);

    const rows = await app.db.execute(sql`
      SELECT password_hash FROM users WHERE id = ${session.userId}
    `);
    const user = rows[0] as { password_hash: string } | undefined;
    if (!user) return fail(401, CURRENT_WRONG);

    // Checked even though they are already signed in. Without it, a stolen cookie is enough to
    // take the account permanently, rather than only until the session expires.
    if (!(await verifyPassword(user.password_hash, currentPassword))) {
      return fail(401, CURRENT_WRONG);
    }

    const passwordHash = await hashPassword(newPassword);

    const token = await app.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE users
           SET password_hash = ${passwordHash}, must_change_password = false
         WHERE id = ${session.userId}
      `);

      // Every session for this account, this browser's included. Other sessions must go because
      // changing a password is how a user evicts someone holding their old one; this one must go
      // because reusing the token across a credential change is session fixation. A replacement
      // is issued in the same transaction, so the user is not signed out by their own success.
      await tx.execute(sql`DELETE FROM sessions WHERE user_id = ${session.userId}`);

      const issued = await createSession(tx, {
        userId: session.userId,
        absoluteHours: opts.sessionAbsoluteHours,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });

      // No before/after payload: neither hash may enter the trail, and the only other fact —
      // that must_change_password is now false — is implied by the action.
      await tx.execute(sql`
        INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id)
        VALUES (${session.userId}, 'user.password_changed', 'user', ${session.userId})
      `);

      return issued;
    });

    reply.setCookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);

    return reply.redirect("/dashboard", 303);
  });
}
```

- [ ] **Step 4: Register it in the middle scope**

In `server/src/doors/staff/index.ts`, add the import:

```ts
import { changePasswordRoutes } from "./routes/change-password.js";
```

and register it inside the `signedIn` scope, immediately before `logoutRoutes`:

```ts
    await signedIn.register(changePasswordRoutes, {
      sessionAbsoluteHours: opts.sessionAbsoluteHours,
    });
```

- [ ] **Step 5: Run the tests**

```bash
pnpm test && pnpm typecheck
```

Expected: PASS, the whole suite. `/change-password` now redirects to `/` for an unsigned-in visitor instead of 404ing.

- [ ] **Step 6: Commit**

```bash
pnpm exec biome check --write src/doors/staff/views/change-password.tsx src/doors/staff/routes/change-password.tsx src/doors/staff/index.ts
git add src/doors/staff/views/change-password.tsx src/doors/staff/routes/change-password.tsx src/doors/staff/index.ts
git commit -m "feat(staff): forced first-sign-in password change, and the way through it"
```

---

## Task 8: Slow down password guessing

`@fastify/rate-limit` is already a dependency and is registered nowhere. Sign-in is the endpoint it exists for.

**Files:**
- Modify: `server/src/server.ts`
- Modify: `server/src/doors/staff/routes/login.tsx`
- Modify: `server/tests/doors.test.ts`

**Interfaces:**
- Consumes: the `POST /login` handler from Task 5.
- Produces: nothing importable — a route config only.

- [ ] **Step 1: Write the failing test**

Add a new top-level block to `server/tests/doors.test.ts`. It posts only `email`, so the shape check answers before any query and this stays database-free. Each case uses a distinct address because the limiter's key includes the address, which keeps the buckets independent.

```ts
describe("sign-in rate limiting", () => {
  function attempt(email: string) {
    return app.inject({
      method: "POST",
      url: "/login",
      headers: {
        host: config.STAFF_HOST,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: new URLSearchParams({ email }).toString(),
    });
  }

  it("stops answering after enough attempts on one account from one place", async () => {
    const answers = [];
    for (let n = 0; n < 11; n += 1) answers.push(await attempt("target@tmda.go.tz"));

    // The limit is 10 in 5 minutes: the tenth is still checked, the eleventh is refused.
    expect(answers[9]?.statusCode).toBe(400);
    expect(answers[10]?.statusCode).toBe(429);
  });

  it("counts a different account separately", async () => {
    // Keyed on address as well as IP, so one person fumbling their password cannot lock out
    // everyone else behind the same office NAT.
    expect((await attempt("someone-else@tmda.go.tz")).statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm test -- doors.test.ts
```

Expected: FAIL — the eleventh attempt answers 400, not 429.

- [ ] **Step 3: Register the plugin, but not globally**

In `server/src/server.ts`, add the import beside the other plugin imports:

```ts
import rateLimit from "@fastify/rate-limit";
```

and register it directly after `formbody`:

```ts
  // `global: false` so only routes that ask for a limit get one — the orange form must stay open
  // to a hospital whose whole site shares one NAT address. `preHandler` rather than the default
  // `onRequest` so a route's keyGenerator can read the parsed body.
  await app.register(rateLimit, { global: false, hook: "preHandler" });
```

- [ ] **Step 4: Opt the login route in**

In `server/src/doors/staff/routes/login.tsx`, widen the type import:

```ts
import type { FastifyInstance, FastifyRequest } from "fastify";
```

Add the config above `loginRoutes`:

```ts
/**
 * Ten attempts per address per source in five minutes.
 *
 * Keyed on the submitted email as well as the IP. TMDA staff share an office NAT, so an IP-only
 * bucket would let one person's fumbled password lock out the floor — and would still not slow an
 * attacker spraying a single guess across many accounts. Pairing the two counts attempts against
 * a particular account from a particular place, which is the thing worth limiting.
 *
 * The address is normalized the same way `Credentials` normalizes it, so `A@x` and `a@x` cannot
 * be used as two buckets for one account.
 */
const LOGIN_RATE_LIMIT = {
  max: 10,
  timeWindow: "5 minutes",
  keyGenerator: (request: FastifyRequest) => {
    const body = request.body as { email?: unknown } | undefined;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    return `${request.ip}:${email}`;
  },
};
```

and attach it by changing the route registration line to:

```ts
  app.post("/login", { config: { rateLimit: LOGIN_RATE_LIMIT } }, async (request, reply) => {
```

- [ ] **Step 5: Run the tests**

```bash
pnpm test && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm exec biome check --write src/server.ts src/doors/staff/routes/login.tsx tests/doors.test.ts
git add src/server.ts src/doors/staff/routes/login.tsx tests/doors.test.ts
git commit -m "feat(staff): rate limit sign-in per account per source"
```

---

## Task 9: Prove it against the restricted role

Everything so far ran without a database. This task exercises the real flow through `buildServer`, connected as `ereports_app` rather than the owner — which is what makes Task 3's grant load-bearing rather than theoretical.

`pnpm test` skips this file; `pnpm test:integration` runs it and fails closed without `TEST_DATABASE_URL` and `TEST_APP_DATABASE_URL`.

**Files:**
- Create: `server/tests/integration/staff-login.test.ts`

**Interfaces:**
- Consumes: `INTEGRATION_ENABLED`, `openOwner`, `truncateAll`, `requireTestDatabase` from `tests/integration/helpers.js`; `buildServer`; `hashPassword`.
- Produces: nothing.

- [ ] **Step 1: Write the test**

Create `server/tests/integration/staff-login.test.ts`:

```ts
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

let owner: DatabaseHandle;
let app: FastifyInstance;

/**
 * The server under test connects as the restricted role, not the owner.
 *
 * Running it as the owner would exercise a superset of production's privileges and prove nothing
 * about them — the suite would pass while a missing GRANT broke the container.
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

/** Seeded through the owner, so the app role is only ever used by the code under test. */
async function seedStaff(attrs: { email: string; mustChange: boolean; isActive?: boolean }) {
  const rows = await owner.db.execute(sql`
    INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
    VALUES (
      ${attrs.email}, 'Grace Mollel', 'assessor', ${await hashPassword(PASSWORD)},
      ${attrs.mustChange}, ${attrs.isActive ?? true}
    )
    RETURNING id
  `);

  return (rows[0] as { id: string }).id;
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

describe.skipIf(!INTEGRATION_ENABLED)("staff sign-in", () => {
  beforeEach(start);

  it("signs a settled user in and lands them on the dashboard", async () => {
    await seedStaff({ email: "grace@tmda.go.tz", mustChange: false });

    const res = await signIn({ email: "grace@tmda.go.tz", password: PASSWORD });

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/dashboard");
  });

  it("stores only the hash of the token it put in the cookie", async () => {
    await seedStaff({ email: "grace@tmda.go.tz", mustChange: false });

    const token = tokenOf(await signIn({ email: "grace@tmda.go.tz", password: PASSWORD }));
    const rows = await owner.db.execute(sql`SELECT token_hash FROM sessions`);
    const stored = (rows[0] as { token_hash: string }).token_hash;

    expect(token).toBeTruthy();
    expect(stored).not.toBe(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sets a cookie the __Host- prefix will actually accept", async () => {
    await seedStaff({ email: "grace@tmda.go.tz", mustChange: false });

    const res = await signIn({ email: "grace@tmda.go.tz", password: PASSWORD });
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
    const userId = await seedStaff({ email: "grace@tmda.go.tz", mustChange: false });

    const token = tokenOf(await signIn({ email: "grace@tmda.go.tz", password: PASSWORD })) ?? "";
    const decoded = Buffer.from(token, "base64url").toString("utf8");

    // Not a JWT, and not a smuggled identity: the row is the only place these live.
    expect(token.split(".")).toHaveLength(1);
    expect(token).not.toContain(userId);
    expect(decoded).not.toContain("grace@tmda.go.tz");
    expect(decoded).not.toContain("assessor");
  });

  it("records the sign-in and stamps last_sign_in_at", async () => {
    await seedStaff({ email: "grace@tmda.go.tz", mustChange: false });

    await signIn({ email: "grace@tmda.go.tz", password: PASSWORD });

    const users = await owner.db.execute(sql`SELECT last_sign_in_at FROM users`);
    const audit = await owner.db.execute(sql`SELECT action FROM audit_log`);

    expect((users[0] as { last_sign_in_at: Date | null }).last_sign_in_at).not.toBeNull();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "user.signed_in" });
  });

  it("refuses a wrong password without opening a session", async () => {
    await seedStaff({ email: "grace@tmda.go.tz", mustChange: false });

    const res = await signIn({ email: "grace@tmda.go.tz", password: "not it" });

    expect(res.statusCode).toBe(401);
    expect(await owner.db.execute(sql`SELECT id FROM sessions`)).toHaveLength(0);
  });

  it("refuses a deactivated account, saying no more than it says to a stranger", async () => {
    await seedStaff({ email: "gone@tmda.go.tz", mustChange: false, isActive: false });

    const deactivated = await signIn({ email: "gone@tmda.go.tz", password: PASSWORD });
    const unknown = await signIn({ email: "nobody@tmda.go.tz", password: PASSWORD });

    expect(deactivated.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(deactivated.body).toContain("Email or password is incorrect");
    expect(deactivated.body).toBe(unknown.body);
  });

  it("finds the account however the address was capitalized", async () => {
    await seedStaff({ email: "grace@tmda.go.tz", mustChange: false });

    const res = await signIn({ email: "  Grace@TMDA.go.tz  ", password: PASSWORD });

    expect(res.statusCode).toBe(303);
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("the forced password change", () => {
  const NEW_PASSWORD = "a brand new long password";

  beforeEach(start);

  function change(cookie: string, fields: Record<string, string>) {
    return app.inject({
      method: "POST",
      url: "/change-password",
      headers: { host: STAFF_HOST, cookie, "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams(fields).toString(),
    });
  }

  it("sends a user who owes a password change there instead of the dashboard", async () => {
    await seedStaff({ email: "new@tmda.go.tz", mustChange: true });

    const res = await signIn({ email: "new@tmda.go.tz", password: PASSWORD });

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/change-password");
  });

  it("closes the rest of the staff app until the password is set", async () => {
    await seedStaff({ email: "new@tmda.go.tz", mustChange: true });
    const cookie = await signedInCookie("new@tmda.go.tz");

    const res = await get("/dashboard", cookie);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/change-password");
  });

  it("still lets them reach the change-password page", async () => {
    await seedStaff({ email: "new@tmda.go.tz", mustChange: true });
    const cookie = await signedInCookie("new@tmda.go.tz");

    const page = await get("/change-password", cookie);

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("You must set a new password before continuing");
  });

  it("opens the app once the password is changed", async () => {
    await seedStaff({ email: "new@tmda.go.tz", mustChange: true });
    const cookie = await signedInCookie("new@tmda.go.tz");

    const res = await change(cookie, {
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
    await seedStaff({ email: "new@tmda.go.tz", mustChange: true });
    const cookie = await signedInCookie("new@tmda.go.tz");

    const changed = await change(cookie, {
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

  it("refuses to change the password without the current one", async () => {
    await seedStaff({ email: "new@tmda.go.tz", mustChange: true });
    const cookie = await signedInCookie("new@tmda.go.tz");

    const res = await change(cookie, {
      currentPassword: "not it",
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    expect(res.statusCode).toBe(401);
    const rows = await owner.db.execute(sql`SELECT must_change_password FROM users`);
    expect(rows[0]).toMatchObject({ must_change_password: true });
  });

  it("refuses a new password that was mistyped the second time", async () => {
    await seedStaff({ email: "new@tmda.go.tz", mustChange: true });
    const cookie = await signedInCookie("new@tmda.go.tz");

    const res = await change(cookie, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: `${NEW_PASSWORD} typo`,
    });

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("do not match");
  });

  it("refuses a new password shorter than the floor the form advertises", async () => {
    await seedStaff({ email: "new@tmda.go.tz", mustChange: true });
    const cookie = await signedInCookie("new@tmda.go.tz");

    const res = await change(cookie, {
      currentPassword: PASSWORD,
      newPassword: "short",
      confirmPassword: "short",
    });

    expect(res.statusCode).toBe(422);
    const rows = await owner.db.execute(sql`SELECT must_change_password FROM users`);
    expect(rows[0]).toMatchObject({ must_change_password: true });
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("session lifetime and sign-out", () => {
  beforeEach(start);

  it("lets a signed-in user through to the dashboard", async () => {
    await seedStaff({ email: "grace@tmda.go.tz", mustChange: false });
    const cookie = await signedInCookie("grace@tmda.go.tz");

    const res = await get("/dashboard", cookie);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Grace Mollel");
  });

  it("slides last_seen_at on each request", async () => {
    await seedStaff({ email: "grace@tmda.go.tz", mustChange: false });
    const cookie = await signedInCookie("grace@tmda.go.tz");

    await owner.db.execute(sql`UPDATE sessions SET last_seen_at = now() - INTERVAL '5 minutes'`);
    const before = await owner.db.execute(sql`SELECT last_seen_at FROM sessions`);
    await get("/dashboard", cookie);
    const after = await owner.db.execute(sql`SELECT last_seen_at FROM sessions`);

    const first = new Date((before[0] as { last_seen_at: Date }).last_seen_at).getTime();
    const second = new Date((after[0] as { last_seen_at: Date }).last_seen_at).getTime();
    expect(second).toBeGreaterThan(first);
  });

  it("turns away a session left idle past the window", async () => {
    await seedStaff({ email: "grace@tmda.go.tz", mustChange: false });
    const cookie = await signedInCookie("grace@tmda.go.tz");

    // The idle window is 30 minutes in this config.
    await owner.db.execute(sql`UPDATE sessions SET last_seen_at = now() - INTERVAL '31 minutes'`);

    const res = await get("/dashboard", cookie);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
  });

  it("turns away a session past its absolute ceiling however busy it has been", async () => {
    await seedStaff({ email: "grace@tmda.go.tz", mustChange: false });
    const cookie = await signedInCookie("grace@tmda.go.tz");

    // Active this second, but issued beyond the 12-hour ceiling. The idle window is irrelevant.
    await owner.db.execute(sql`
      UPDATE sessions SET last_seen_at = now(), expires_at = now() - INTERVAL '1 second'
    `);

    const res = await get("/dashboard", cookie);

    expect(res.statusCode).toBe(302);
  });

  it("ends the session when the account is deactivated", async () => {
    await seedStaff({ email: "grace@tmda.go.tz", mustChange: false });
    const cookie = await signedInCookie("grace@tmda.go.tz");

    await owner.db.execute(sql`UPDATE users SET is_active = false`);

    expect((await get("/dashboard", cookie)).statusCode).toBe(302);
  });

  it("deletes the row on sign-out, not just the cookie", async () => {
    await seedStaff({ email: "grace@tmda.go.tz", mustChange: false });
    const cookie = await signedInCookie("grace@tmda.go.tz");

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
```

- [ ] **Step 2: Run it**

```bash
pnpm test:integration
```

Expected: PASS. If a case fails with PostgreSQL `42501 permission denied for table sessions`, migration 0004 from Task 3 has not reached `ereports_test`. Apply it with the owner URL — `TEST_DATABASE_URL` is the restricted role and cannot GRANT — then re-run:

```bash
DATABASE_URL="$(grep -E '^TEST_OWNER_DATABASE_URL=' .env | cut -d= -f2-)" pnpm db:migrate
```

- [ ] **Step 3: Run everything**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration
```

Expected: four green runs.

- [ ] **Step 4: Commit**

```bash
pnpm exec biome check --write tests/integration/staff-login.test.ts
git add tests/integration/staff-login.test.ts
git commit -m "test: sign-in, the forced change and session expiry, as the restricted role"
```

---

## Manual verification

The suites cover behaviour; these cannot be asserted from `app.inject`, which does not enforce cookie prefixes the way a browser does.

- [ ] **Sign in as the administrator that already exists.** Do not create a second one: `pnpm admin:dev create` (the subcommand is `create`, not `create-admin`) refuses once an administrator is present, and bootstrap is deliberately a one-time door. If nobody knows that account's password, reset it rather than adding an account:

```bash
pnpm admin:dev reset-password --email=<the existing administrator>
```

- [ ] Confirm migration 0004 has been applied to `e_reports` — `pnpm db:migrate` — before starting the server.
- [ ] Start `pnpm dev` and open `http://staff.localhost:3100` in **Chrome or Firefox**. Sign in.
- [ ] In DevTools → Application → Cookies, confirm one cookie named `__Host-ae_session`, with `Secure` and `HttpOnly` ticked and the Domain column showing `staff.localhost` with no leading dot. If no cookie appears at all, the browser rejected the prefix — fix `SESSION_COOKIE_OPTIONS`, do not weaken it.
- [ ] Confirm you land on `/change-password`, that navigating to `/dashboard` bounces you back, and that after setting a password you reach `/dashboard`.
- [ ] Confirm `http://public.localhost:3100` still serves the orange form, and that the session cookie is **not** sent to it.

> Safari treats `http://*.localhost` as insecure and will reject the `Secure` cookie. That is Safari, not a defect in this slice — use Chrome or Firefox locally, or put a TLS proxy in front.

## Done

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration` all pass.
- [ ] `git status` is clean and every task is committed.
- [ ] `git diff --stat 96f7106..HEAD -- src/cli/ compose.yml src/doors/public/` prints nothing — the three areas the brief closed are untouched.
