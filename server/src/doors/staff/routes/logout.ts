import type { FastifyInstance } from "fastify";
import { destroySession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "../../../auth/session.js";

/**
 * Sign out.
 *
 * Registered one scope out from the rest of the staff app, so it stays reachable to a user held
 * at the forced password change. Someone who cannot get in must still be able to get out.
 *
 * The row is deleted, not merely the cookie cleared. Clearing only the cookie would leave a live
 * session behind for anyone who had already copied the token out of the browser.
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
