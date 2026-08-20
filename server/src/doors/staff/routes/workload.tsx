import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { currentSession } from "../session-guard.js";
import { BUCKETS, WorkloadPage, type WorkloadRow } from "../views/workload.js";

/** Newest first, and only this many, on the same argument as the register's own limit. */
const WORKLOAD_LIMIT = 200;

/** The statuses this page will filter by, which are the buckets it draws. */
const FILTERABLE = new Set(BUCKETS.map((bucket) => bucket.status));

function toRow(row: unknown): WorkloadRow {
  const report = row as {
    id: string;
    number: string;
    received_at: Date;
    device_name: string;
    severity: string;
    status: string;
    assessor1_name: string | null;
    assessor2_name: string | null;
  };

  return {
    id: report.id,
    number: report.number,
    receivedAt: report.received_at,
    deviceName: report.device_name,
    severity: report.severity,
    status: report.status,
    assessor1Name: report.assessor1_name,
    assessor2Name: report.assessor2_name,
  };
}

/**
 * The whole pipeline, for the one role accountable for it moving.
 *
 * Registered in the manager scope, so an Officer and an administrator are refused rather than
 * shown a page about work that is not theirs to move — the same argument `myAssessmentsRoutes`
 * makes in the other direction.
 *
 * Two queries rather than one. The figures count every report in the register and the list shows
 * at most a page of them, so a window function cannot serve both here the way it does on the
 * Officer's queue: that one counts and lists the same filtered set, and this one deliberately
 * does not — the six figures must stay true whatever bucket is being read.
 *
 * Nothing here writes, and the route file having no INSERT or UPDATE in it is the honest form of
 * that: migration 0005 grants this role SELECT on `reports`, and this page needs nothing more.
 */
export async function workloadRoutes(app: FastifyInstance): Promise<void> {
  app.get("/workload", async (request, reply) => {
    const session = currentSession(request);

    // An unknown status is not an error and not an empty page: it is simply not a filter, so the
    // reader gets the whole pipeline rather than a 404 over a mistyped address.
    const asked = (request.query as { status?: unknown }).status;
    const selected = typeof asked === "string" && FILTERABLE.has(asked) ? asked : null;

    const totals = await app.db.execute(sql`
      SELECT status::text AS status, count(*)::int AS count FROM reports GROUP BY status
    `);

    const counts: Record<string, number> = {};
    for (const row of totals) {
      const total = row as { status: string; count: number };
      counts[total.status] = total.count;
    }

    // Left joins: `assessor1_user_id` is null for a report filed while no Officer was active, and
    // `assessor2_user_id` for every report before a manager names one. An inner join on either
    // would hide exactly the rows this page exists to surface.
    const where = selected === null ? sql`` : sql`WHERE r.status = ${selected}::report_status`;

    const rows = await app.db.execute(sql`
      SELECT r.id, r.number, r.received_at, r.device_name, r.severity, r.status::text AS status,
             a1.full_name AS assessor1_name,
             a2.full_name AS assessor2_name
        FROM reports r
        LEFT JOIN users a1 ON a1.id = r.assessor1_user_id
        LEFT JOIN users a2 ON a2.id = r.assessor2_user_id
        ${where}
       ORDER BY r.received_at DESC, r.number DESC
       LIMIT ${WORKLOAD_LIMIT}
    `);

    return reply.html(
      <WorkloadPage
        viewerRole={session.role}
        viewerName={session.fullName}
        counts={counts}
        selected={selected}
        rows={rows.map(toRow)}
      />,
    );
  });
}
