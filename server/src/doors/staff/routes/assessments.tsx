import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { currentSession } from "../session-guard.js";
import {
  type AssignmentRow,
  type AssignmentState,
  MyAssessmentsPage,
} from "../views/assessments.js";

/** One assignment as the query returns it, before its state is read off it. */
type Row = {
  id: string;
  number: string;
  received_at: Date;
  device_name: string;
  severity: string;
  status: string;
  ordinal: number;
  started: boolean;
  submitted: boolean;
};

/**
 * How far along one assignment is, by the same test at every ordinal.
 *
 * `submitted_at` is the only column that means "finished", and an untouched assignment is the one
 * whose payload is still the empty object it was created with — `assign-next-assessor` inserts
 * `'{}'::jsonb` eagerly when it names the next assessor, and the first draft save replaces it with
 * real answers. At ordinal 1 there is no row at all until that first save, which is the same fact
 * said a different way: the query coalesces a missing payload to `'{}'` so the two cases answer
 * alike. Comparing the missing one directly would not — `NULL IS DISTINCT FROM '{}'` is true, so
 * an unopened first assessment would report itself as part-written.
 *
 * This is what makes "In progress" mean one thing. The page used to derive an A1's state from
 * `reports.status` and give a secondary assessment no state at all, so `first_assessment` was the
 * only progress the Officer's queue could see.
 */
function stateOf(row: Row): AssignmentState {
  if (row.submitted) return "submitted";
  return row.started ? "in-progress" : "not-started";
}

function toRow(raw: unknown): AssignmentRow {
  const row = raw as Row;

  return {
    reportId: row.id,
    number: row.number,
    receivedAt: row.received_at,
    deviceName: row.device_name,
    severity: row.severity,
    ordinal: row.ordinal,
    state: stateOf(row),
    // Whether the report page is still open to this Officer, decided by the same rule
    // `reportsRoutes` decides it by. Once the manager has approved and handed the work out, the
    // assessment workflow is over for an Officer and the page is refused them — so the number
    // stops being a link rather than becoming one that answers 403.
    reportOpen: row.status !== "assigned_for_work",
  };
}

/**
 * One Officer's own work.
 *
 * Registered in the assessor scope, so a manager and an administrator are refused rather than
 * shown an empty page — neither is ever assigned a report, and a page that could only say
 * "nothing here" is a worse answer than saying it is not theirs.
 *
 * One query rather than two, and one list rather than two. The first assessment is still found
 * through `reports.assessor1_user_id` and a secondary one through `assessments.assessor_id` at any
 * ordinal above 1 — those are genuinely two different records — but they are unioned into one set
 * of assignments here, because everything the page does with them afterwards is the same. Keeping
 * them apart all the way to the view is what produced a "Submitted" tab that only ever meant A1
 * and a "Secondary assessments" tab that mixed three states together.
 *
 * Ordering is by arrival, newest first, with `number` breaking the tie the way every other queue
 * in the app breaks it — `number` is unique, so the order is total rather than merely usually
 * stable. Two assignments on one report sort together, later ordinal first.
 */
export async function myAssessmentsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/assessments", async (request, reply) => {
    const session = currentSession(request);

    const rows = await app.db.execute(sql`
      SELECT r.id, r.number, r.received_at, r.device_name, r.severity, r.status::text AS status,
             1 AS ordinal,
             (coalesce(a.payload, '{}'::jsonb) IS DISTINCT FROM '{}'::jsonb) AS started,
             (a.submitted_at IS NOT NULL) AS submitted
        FROM reports r
        LEFT JOIN assessments a ON a.report_id = r.id AND a.ordinal = 1
       WHERE r.assessor1_user_id = ${session.userId}

       UNION ALL

      SELECT r.id, r.number, r.received_at, r.device_name, r.severity, r.status::text AS status,
             a.ordinal,
             (coalesce(a.payload, '{}'::jsonb) IS DISTINCT FROM '{}'::jsonb) AS started,
             (a.submitted_at IS NOT NULL) AS submitted
        FROM assessments a
        JOIN reports r ON r.id = a.report_id
       WHERE a.assessor_id = ${session.userId} AND a.ordinal > 1

       ORDER BY received_at DESC, number DESC, ordinal DESC
    `);

    const assignments = rows.map(toRow);

    return reply.html(
      <MyAssessmentsPage
        viewerRole={session.role}
        viewerName={session.fullName}
        notStarted={assignments.filter((row) => row.state === "not-started")}
        inProgress={assignments.filter((row) => row.state === "in-progress")}
        submitted={assignments.filter((row) => row.state === "submitted")}
      />,
    );
  });
}
