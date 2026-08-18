import type { FastifyInstance } from "fastify";
import { constrainToHost } from "../host-scope.js";
import { loginRoutes } from "./routes/login.js";

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
 * The staff portal door.
 *
 * Its own encapsulation context, reachable only on STAFF_HOST. The session cookie added in the
 * next slice uses the `__Host-` prefix, which forbids a Domain attribute and so cannot be sent to
 * the public hostname at all.
 */
export async function staffDoor(app: FastifyInstance, opts: StaffDoorOptions): Promise<void> {
  constrainToHost(app, opts.host);

  await app.register(loginRoutes, {
    publicFormUrl: opts.publicOrigin,
    sessionAbsoluteHours: opts.sessionAbsoluteHours,
  });
}
