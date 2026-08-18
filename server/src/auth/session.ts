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
 * expired between the two steps is admitted, and would put a second clock — the Node process's —
 * in charge of when a session ends.
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
