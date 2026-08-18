import type { FastifyInstance } from "fastify";
import { constrainToHost } from "../host-scope.js";
import { changePasswordRoutes } from "./routes/change-password.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { loginRoutes } from "./routes/login.js";
import { logoutRoutes } from "./routes/logout.js";
import { requirePasswordChanged, requireSession } from "./session-guard.js";

export type StaffDoorOptions = {
  host: string;
  /** Absolute origin of the public door, for the cross-host link to the orange form. */
  publicOrigin: string;
  /** Sliding idle window, from config. Used by the session guard in the next slice. */
  sessionIdleMinutes: number;
  /** Hard ceiling on a session, from config. */
  sessionAbsoluteHours: number;
};

/**
 * The staff portal door: three nested scopes, each one narrower than the last.
 *
 * Reachable only on STAFF_HOST. The session cookie uses the `__Host-` prefix, which forbids a
 * Domain attribute and so cannot be sent to the public hostname at all.
 *
 * The nesting is the access control. A hook applies to its own scope and every scope registered
 * inside it, so where a route is registered decides what it requires. There is no allowlist of
 * public paths to keep in step with the routes, and no way to add a route to the staff app that
 * forgets the gate — the same argument `constrainToHost` makes for host isolation.
 */
export async function staffDoor(app: FastifyInstance, opts: StaffDoorOptions): Promise<void> {
  constrainToHost(app, opts.host);

  // Anonymous: the sign-in page, the sign-in itself, and the health probe.
  await app.register(loginRoutes, {
    publicFormUrl: opts.publicOrigin,
    sessionAbsoluteHours: opts.sessionAbsoluteHours,
  });

  await app.register(async (signedIn) => {
    // Signed in, but possibly still owing the forced first-sign-in password change.
    requireSession(signedIn, { idleMinutes: opts.sessionIdleMinutes });

    // Deliberately outside `requirePasswordChanged`: this is the way through that gate, so under
    // the hook it would redirect to itself.
    await signedIn.register(changePasswordRoutes, {
      sessionAbsoluteHours: opts.sessionAbsoluteHours,
    });

    await signedIn.register(logoutRoutes);

    await signedIn.register(async (active) => {
      // The staff app proper. Everything registered from here down is closed to a user whose
      // must_change_password is still true.
      requirePasswordChanged(active);

      await active.register(dashboardRoutes);
    });
  });
}
