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

  /*
   * Nothing behind the session gate is cacheable.
   *
   * The browser's Back button is not a security boundary and is not treated as one: it is not
   * disabled, intercepted or fought with. What is fixed is the actual defect behind "I signed out
   * and Back showed me the report again" — a page held in the browser's history cache and redrawn
   * without asking us. `no-store` is what forbids that; the guard above is what answers every
   * request that does reach us, signed out or not.
   *
   * On the same scope as the guard, and for the same reason: a page is uncacheable because of
   * where it was registered, not because its author remembered. Assets are registered outside this
   * scope entirely and keep whatever caching they had.
   *
   * `onSend` rather than `onRequest`, so the header is stamped on redirects and refusals too —
   * those carry the reader's own name and role, and a cached 403 is as wrong as a cached report.
   */
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store, must-revalidate");
    reply.header("Pragma", "no-cache");
    return payload;
  });

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
 * Additionally require that the user holds one of these roles.
 *
 * The third and narrowest gate, applied the same way as the two above it: to a scope, so a route
 * is administrator-only because of where it was registered. Adding a page to that scope next year
 * carries the restriction with it, and there is no per-route check anyone can forget to write —
 * or write twice, differently.
 *
 * A role that does not include this area is sent to its own dashboard, and shown nothing on the
 * way. The rail never links a role to an area it cannot use, so the only way here is a typed
 * address or an old bookmark — and the answer to either is simply to be somewhere you can work,
 * not a page describing the place you cannot. Nothing of the area is rendered or queried first:
 * this hook runs before any route in the scope does.
 *
 * `/dashboard` is registered outside every role scope, so no role can be redirected in a loop.
 * The session is not cleared and the cookie is left alone: the user is who they say they are.
 *
 * Refusals about one case rather than a whole area — not your assignment, or the case has moved
 * on — are a different answer and stay a page: see `ForbiddenPage`.
 */
export function requireRole(app: FastifyInstance, roles: readonly StaffSession["role"][]): void {
  app.addHook("onRequest", async (request, reply) => {
    // `requireSession` runs first and redirects when there is no session, so the null case here is
    // a route registered in the wrong scope. Refusing is the safe reading of that mistake, and the
    // dashboard's own guard sends a session-less request on to sign-in.
    if (!request.staffSession || !roles.includes(request.staffSession.role)) {
      return reply.redirect("/dashboard", 302);
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
