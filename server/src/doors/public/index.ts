import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { constrainToHost } from "../host-scope.js";
import { orangeFormRoutes } from "./routes/orange-form.js";

export type PublicDoorOptions = {
  host: string;
};

/**
 * The public orange form door.
 *
 * Registered as a plain async function, so Fastify gives it its own encapsulation context. Nothing
 * registered here is visible to the staff door, and nothing the staff door decorates is reachable
 * from here.
 *
 * This door is unauthenticated and therefore the abusable one, so it carries the strict rate
 * limit.
 */
export async function publicDoor(app: FastifyInstance, opts: PublicDoorOptions): Promise<void> {
  constrainToHost(app, opts.host);

  await app.register(rateLimit, {
    max: 30,
    timeWindow: "1 minute",
  });

  await app.register(orangeFormRoutes);
}
