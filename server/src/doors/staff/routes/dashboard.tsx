import type { FastifyInstance } from "fastify";
import { currentSession } from "../session-guard.js";
import { DashboardPage } from "../views/dashboard.js";

/** Registered in the innermost scope, so both guards have already run by the time this answers. */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dashboard", async (request, reply) => {
    const session = currentSession(request);

    return reply.html(<DashboardPage fullName={session.fullName} role={session.role} />);
  });
}
