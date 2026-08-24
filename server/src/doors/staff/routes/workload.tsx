import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentSession } from "../session-guard.js";
import {
  BUCKETED_STATUSES,
  BUCKETS,
  bucketOfStatus,
  WorkloadPage,
  type WorkloadRow,
} from "../views/workload.js";

/** Newest first, and only this many, on the same argument as `REPORTS_LIMIT` and `ACTIVITY_LIMIT`. */
const WORKLOAD_LIMIT = 200;

/**
 * The filter, validated against the states the page actually draws.
 *
 * Read from `BUCKETS` rather than from `reportStatus.enumValues`: what may be filtered by is now a
 * question about the six states this page shows, not about the seven values the column can hold.
 * Taking the answer from the bar's own definition means a state added there is filterable the day
 * it exists, and a status the bar deliberately shows no tab for — `closed` — cannot be reached by
 * hand-editing the address either.
 *
 * The parameter is `stage`, not `status`, because the values are no longer statuses. A bookmarked
 * `?status=received` therefore matches nothing and degrades to the whole pipeline, which is the
 * same answer this page has always given a stale link.
 */
const StageFilter = z.enum(BUCKETS.map((bucket) => bucket.id) as [string, ...string[]]);

/** The statuses one state folds together, by that state's own id. */
function statusesOfStage(id: string): readonly string[] | undefined {
  return BUCKETS.find((bucket) => bucket.id === id)?.statuses;
}

function toRow(row: unknown): WorkloadRow {
  const report = row as {
    id: string;
    number: string;
    received_at: Date;
    device_name: string;
    severity: string;
    status: string;
    current_ordinal: number;
    current_assessor_name: string | null;
  };

  return {
    id: report.id,
    number: report.number,
    receivedAt: report.received_at,
    deviceName: report.device_name,
    severity: report.severity,
    status: report.status,
    currentOrdinal: report.current_ordinal,
    currentAssessorName: report.current_assessor_name,
  };
}

/**
 * The whole pipeline, for the one role accountable for it moving.
 *
 * Registered in the manager scope, so an Officer and an administrator are refused rather than
 * shown a page about work that is not theirs to move — the same argument `myAssessmentsRoutes`
 * makes in the other direction.
 *
 * Two queries rather than one. The figures count every report the bar has a tab for and the list
 * shows at most a page of them, so a window function cannot serve both here the way it does on the
 * Officer's queue: that one counts and lists the same filtered set, and this one deliberately does
 * not — every figure must stay true whatever state is being read.
 *
 * The figures are still counted `GROUP BY status` and folded into states here, rather than grouped
 * by state in SQL. The status-to-state mapping lives in `BUCKETS` and is the tab bar's own; having
 * SQL restate it is how the count under a tab starts disagreeing with the list behind it.
 *
 * Nothing here writes, and the route file having no INSERT or UPDATE in it is the honest form of
 * that: migration 0005 grants this role SELECT on `reports`, and this page needs nothing more.
 */
export async function workloadRoutes(app: FastifyInstance): Promise<void> {
  app.get("/workload", async (request, reply) => {
    const session = currentSession(request);

    // An unknown state is not an error and not an empty page: it is simply not a filter, so the
    // reader gets the whole pipeline rather than a 404 over a mistyped address.
    const asked = StageFilter.safeParse((request.query as { stage?: unknown }).stage);
    const selected = asked.success ? asked.data : null;

    const totals = await app.db.execute(sql`
      SELECT status::text AS status, count(*)::int AS count FROM reports GROUP BY status
    `);

    const counts: Record<string, number> = {};
    for (const row of totals) {
      const total = row as { status: string; count: number };
      // A status no bucket claims is counted into no bucket. `closed` is the only one today, and
      // it must not silently inflate a figure under a tab that would not list it.
      const bucket = bucketOfStatus(total.status);
      if (bucket === undefined) continue;
      counts[bucket.id] = (counts[bucket.id] ?? 0) + total.count;
    }

    // The unfiltered page is every state the bar draws, not literally every row in the table: a
    // report the page has no tab for is one the reader cannot navigate back to, so listing it
    // under "All reports" would be showing them a stage that does not exist for them.
    const statuses = selected === null ? BUCKETED_STATUSES : (statusesOfStage(selected) ?? []);

    // Each status is bound separately rather than interpolated. The set is built from `BUCKETS`
    // and never from the request, so this is not what stops an injection — the whitelist above is;
    // this is what keeps that true if the two ever drift.
    const inStatuses = sql.join(
      statuses.map((status) => sql`${status}`),
      sql`, `,
    );

    // A lateral join rather than two correlated subqueries: the ordinal and the name come from one
    // row — the latest assessment on this report — and reading them separately is how a page ends
    // up printing one assessor's name against another's ordinal.
    //
    // The fallback is A1 from `reports.assessor1_user_id`, for a report at `received` whose
    // `assessments` row does not exist yet (it is written lazily, on the first draft save). Legacy
    // secondary assignments need no fallback of their own: migration 0013 backfilled them, and
    // nothing writes `assessor2_user_id` any more.
    const rows = await app.db.execute(sql`
      SELECT r.id, r.number, r.received_at, r.device_name, r.severity, r.status::text AS status,
             coalesce(cur.ordinal, 1) AS current_ordinal,
             coalesce(cur.full_name, a1.full_name) AS current_assessor_name
        FROM reports r
        LEFT JOIN users a1 ON a1.id = r.assessor1_user_id
        LEFT JOIN LATERAL (
          SELECT a.ordinal, u.full_name
            FROM assessments a
            JOIN users u ON u.id = a.assessor_id
           WHERE a.report_id = r.id
           ORDER BY a.ordinal DESC
           LIMIT 1
        ) cur ON true
       WHERE r.status::text IN (${inStatuses})
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
