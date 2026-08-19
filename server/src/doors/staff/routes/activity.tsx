import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { currentSession } from "../session-guard.js";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_LIMIT,
  type ActivityEntry,
  ActivityPage,
} from "../views/activity.js";

/**
 * The keys the page can label, as an `IN` list the driver will parameterise.
 *
 * Built with `sql.join` rather than interpolated as one array. Handing drizzle a JS array here
 * expands it to a tuple — `($1, $2, ...)` — which is not something a `::text[]` cast can be
 * applied to, and the query then fails at the database rather than at review. Each name goes in as
 * its own placeholder, so nothing here is ever concatenated into the statement.
 */
const ACTIVITY_ACTION_LIST = sql.join(
  Object.keys(ACTIVITY_ACTIONS).map((name) => sql`${name}`),
  sql`, `,
);

/**
 * The account trail, for administrators.
 *
 * Registered in the administrator-only scope, so a manager or assessor is refused by the guard
 * before this file is reached. Every administrator sees the same rows: a trail that is filtered
 * per reader is not one an auditor can rely on.
 *
 * `before` and `after` are deliberately absent from the SELECT. The columns exist and some actions
 * do write to them, but nothing here needs them, and a page that never receives them cannot leak a
 * payload — the same argument that keeps `password_hash` out of the users list. Actor and target
 * are read by joining `users`, not by trusting anything an action recorded about itself.
 */
export async function loadActivity(app: FastifyInstance, limit: number): Promise<ActivityEntry[]> {
  const rows = await app.db.execute(sql`
      SELECT a.at,
             a.action,
             actor.full_name  AS actor_name,
             actor.email      AS actor_email,
             actor.role       AS actor_role,
             target.full_name AS target_name,
             target.email     AS target_email
        FROM audit_log AS a
        LEFT JOIN users AS actor  ON actor.id = a.actor_user_id
        -- The uuid is cast to text rather than the other way round: entity_id is a text column,
        -- and casting it to uuid would raise 22P02 the first time anything records a non-uuid id.
        LEFT JOIN users AS target ON target.id::text = a.entity_id
       WHERE a.entity_type = 'user'
         AND a.action IN (${ACTIVITY_ACTION_LIST})
       ORDER BY a.at DESC, a.id DESC
       LIMIT ${limit}
  `);

  return rows.map((row): ActivityEntry => {
    const entry = row as {
      at: Date;
      action: string;
      actor_name: string | null;
      actor_email: string | null;
      actor_role: string | null;
      target_name: string | null;
      target_email: string | null;
    };

    return {
      at: entry.at,
      action: entry.action,
      actorName: entry.actor_name,
      actorEmail: entry.actor_email,
      actorRole: entry.actor_role,
      targetName: entry.target_name,
      targetEmail: entry.target_email,
    };
  });
}

/**
 * The trail, for administrators.
 *
 * Registered in the administrator-only scope, so a manager or officer is refused by the guard
 * before this file is reached. Every administrator sees the same rows: a trail that is filtered
 * per reader is not one an auditor can rely on.
 */
export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/activity", async (request, reply) => {
    const entries = await loadActivity(app, ACTIVITY_LIMIT);

    return reply.html(
      <ActivityPage
        entries={entries}
        viewerRole={currentSession(request).role}
        viewerName={currentSession(request).fullName}
      />,
    );
  });
}
