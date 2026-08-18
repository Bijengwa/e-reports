import type { FastifyInstance } from "fastify";

/**
 * Constrain every route in this encapsulation context to a single Host header.
 *
 * Fastify's `onRoute` hook fires only for routes registered in the same plugin scope and its
 * children. Calling this at the top of a door plugin therefore stamps the constraint onto every
 * route that door will ever register — including ones added later by someone who has never read
 * this file.
 *
 * That is the point. Host isolation is not something a future route can forget to opt into.
 */
export function constrainToHost(app: FastifyInstance, host: string): void {
  app.addHook("onRoute", (route) => {
    route.constraints = { ...route.constraints, host };
  });
}
