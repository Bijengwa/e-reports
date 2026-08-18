import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "../../../auth/password.js";
import { createSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "../../../auth/session.js";
import { currentSession } from "../session-guard.js";
import { ChangePasswordPage } from "../views/change-password.js";

export type ChangePasswordRoutesOptions = {
  /** Hard ceiling on the replacement session, from config. Never a literal. */
  sessionAbsoluteHours: number;
};

const INCOMPLETE = "Fill in all three fields.";
const CURRENT_WRONG = "Your current password is incorrect.";
const TOO_SHORT = `Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
const NOT_CONFIRMED = "The two new passwords do not match.";
const NOT_CHANGED = "Your new password must be different from your current one.";

/**
 * Only the shape, not the rules.
 *
 * The length rule is checked after the current password has been verified rather than here, so
 * the order of the answers matches the order of the questions: prove you hold the account, then
 * find out what a valid new password looks like. Both bounds are still enforced — 1024 caps what
 * Argon2 will be asked to hash, which an unbounded field makes a cheap way to burn the process.
 */
const Submitted = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(1).max(1024),
  confirmPassword: z.string().min(1).max(1024),
});

/**
 * Setting a password, and the only way out of the forced first-sign-in gate.
 *
 * Registered in the middle scope: a session is required, but `requirePasswordChanged` is not
 * applied here — under that hook this page would redirect to itself.
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

    const parsed = Submitted.safeParse(request.body);
    if (!parsed.success) return fail(422, INCOMPLETE);

    const { currentPassword, newPassword, confirmPassword } = parsed.data;

    const rows = await app.db.execute(sql`
      SELECT password_hash FROM users WHERE id = ${session.userId}
    `);
    const user = rows[0] as { password_hash: string } | undefined;
    if (!user) return fail(401, CURRENT_WRONG);

    // Checked even though they are already signed in. Without it, a stolen cookie is enough to
    // take the account permanently rather than only until the session expires.
    if (!(await verifyPassword(user.password_hash, currentPassword))) {
      return fail(401, CURRENT_WRONG);
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) return fail(422, TOO_SHORT);
    if (newPassword !== confirmPassword) return fail(422, NOT_CONFIRMED);
    if (newPassword === currentPassword) return fail(422, NOT_CHANGED);

    const passwordHash = await hashPassword(newPassword);

    const token = await app.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE users
           SET password_hash = ${passwordHash}, must_change_password = false
         WHERE id = ${session.userId}
      `);

      // Every session for this account, this browser's included. The others must go because
      // changing a password is how a user evicts someone holding their old one; this one must go
      // because reusing a token across a credential change is session fixation. The replacement
      // is issued inside the same transaction, so the user is not signed out by their own success.
      await tx.execute(sql`DELETE FROM sessions WHERE user_id = ${session.userId}`);

      const issued = await createSession(tx, {
        userId: session.userId,
        absoluteHours: opts.sessionAbsoluteHours,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });

      // No before/after payload: neither hash may enter the trail, and the only other fact --
      // that must_change_password is now false -- is already implied by the action.
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
