import type { FastifyInstance } from "fastify";
import { destroySession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "../../../auth/session.js";
import { SignOutPage } from "../views/sign-out.js";

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
  // Asks first. A GET changes nothing, so this is safe to link to from the rail, and the answer
  // below is still a POST.
  app.get("/logout", async (_request, reply) => reply.html(<SignOutPage />));

  app.post("/logout", async (request, reply) => {
    if (request.staffSessionToken) {
      await destroySession(app.db, request.staffSessionToken);
    }

    reply.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);

    return reply.redirect("/", 303);
  });
}
