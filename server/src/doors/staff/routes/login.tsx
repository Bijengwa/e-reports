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
  // Normalized exactly as createAdmin normalizes it. An address stored lower-cased would not be
  // found when its owner types it with a capital.
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(1024),
});

/**
 * The staff sign-in page and the sign-in itself.
 *
 * These are the staff door's anonymous routes — the only ones reachable without a session.
 * Everything else belongs in a nested scope behind the guard, so a route added later is protected
 * unless someone deliberately registers it out here.
 */
export async function loginRoutes(app: FastifyInstance, opts: LoginRoutesOptions): Promise<void> {
  app.get("/", async (_request, reply) =>
    reply.html(<LoginPage publicFormUrl={opts.publicFormUrl} />),
  );

  app.post("/login", async (request, reply) => {
    const parsed = Credentials.safeParse(request.body);

    if (!parsed.success) {
      // The same sentence as a wrong password. A submission that fails the shape check must not
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
      // Spend a verification's worth of work anyway, so an unknown address is not visibly faster
      // than a known one. `is_active` is part of the query above rather than a separate branch,
      // so a deactivated account takes this path too and is equally indistinguishable.
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

    // 303 turns the POST into a GET, so a refresh reloads the page they landed on rather than
    // re-posting the password.
    return reply.redirect(user.must_change_password ? "/change-password" : "/dashboard", 303);
  });

  app.get("/healthz", async () => ({ status: "ok", door: "staff" }));
}
