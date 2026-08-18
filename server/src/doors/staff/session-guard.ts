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
 * level out, so a user who still owes a password change can reach exactly those two and nothing
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
