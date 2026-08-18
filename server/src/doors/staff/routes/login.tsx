import type { FastifyInstance } from "fastify";
import { LoginPage } from "../views/login.js";

export type LoginRoutesOptions = {
  /** Absolute origin of the public door, for the cross-host link to the orange form. */
  publicFormUrl: string;
};

/**
 * Shown when someone presses "Sign in".
 *
 * There is no credential store yet — `users.password_hash` exists in the schema but nothing
 * hashes or verifies a password. Rather than 404, the form answers honestly that no credentials
 * were checked. It must never imply a failed password, which would tell an attacker that the
 * account exists.
 */
const AUTH_NOT_CONNECTED =
  "Sign-in is not available yet — staff accounts and sessions are still being built. " +
  "No credentials were checked.";

/**
 * The staff sign-in page.
 *
 * `POST /login` deliberately does not authenticate. Real sign-in — password verification,
 * database sessions, the `__Host-` cookie and the forced first-sign-in password change — is its
 * own slice. The submitted body is discarded unread, so no password reaches a log.
 */
export async function loginRoutes(app: FastifyInstance, opts: LoginRoutesOptions): Promise<void> {
  app.get("/", async (_request, reply) =>
    reply.html(<LoginPage publicFormUrl={opts.publicFormUrl} />),
  );

  app.post("/login", async (_request, reply) =>
    reply
      .status(503)
      .html(<LoginPage publicFormUrl={opts.publicFormUrl} error={AUTH_NOT_CONNECTED} />),
  );

  app.get("/healthz", async () => ({ status: "ok", door: "staff" }));
}
