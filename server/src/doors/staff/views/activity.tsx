import { StaffShell } from "./shell.js";

/**
 * The account actions this page reports, and how each one reads.
 *
 * One object rather than a list beside a lookup table, because the route selects on the keys and
 * the page renders the values. Split in two, an action could be admitted by the query and arrive
 * here with no English to show for it, or be given a label it is never selected with.
 *
 * `user.bootstrap_created` is included deliberately. It is the only record of where the first
 * administrator came from, and a trail that starts after that moment invites the question it
 * cannot answer.
 */
export const ACTIVITY_ACTIONS = {
  "user.bootstrap_created": "First administrator created",
  "user.created": "Account created",
  "user.signed_in": "Signed in",
  "user.password_changed": "Password changed",
  "user.password_reset": "Password reset",
  "user.deactivated": "Account deactivated",
  "user.reactivated": "Account reactivated",
} as const;

/** Newest first, and only this many. A trail nobody can page through is one nobody reads. */
export const ACTIVITY_LIMIT = 200;

export type ActivityEntry = {
  at: Date;
  action: string;
  /**
   * Null when nothing in `users` took the action.
   *
   * The CLI is the case that matters: whoever runs it holds DATABASE_URL rather than an account,
   * so `create-admin` and a CLI `reset-password` record no actor at all.
   */
  actorName: string | null;
  actorEmail: string | null;
  /** Null only if the account behind the entry has gone. Nothing deletes users today. */
  targetName: string | null;
  targetEmail: string | null;
};

/** Minutes are as fine as this trail needs, and seconds only make the column harder to scan. */
function when(value: Date): string {
  return new Date(value).toISOString().slice(0, 16).replace("T", " ");
}

export type ActivityPageProps = {
  entries: ActivityEntry[];
  /** The reader's own role, for the rail. */
  viewerRole: string;
};

/**
 * Every account action, for every administrator.
 *
 * There is no per-administrator filtering: an audit trail one reader can see and another cannot
 * is not an audit trail. What keeps it honest is what the query never asks for — `before` and
 * `after` are not selected, so no payload, no hash and no cookie can reach this page even if a
 * future action were careless about what it wrote there.
 */
export function ActivityPage({ entries, viewerRole }: ActivityPageProps): JSX.Element {
  return (
    <StaffShell
      title="Activity — AE Reports"
      pageTitle="Activity"
      role={viewerRole}
      active="activity"
    >
      <div class="staff-head">
        <div class="sp">
          <p class="hint">
            Account actions, newest first. The most recent {ACTIVITY_LIMIT} are shown.
          </p>
        </div>
      </div>

      <table class="utable">
        <thead>
          <tr>
            <th>When (UTC)</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr>
              <td>{when(entry.at)}</td>
              <td>
                {entry.actorName ? (
                  <>
                    <span safe>{entry.actorName}</span>
                    <span class="hint block" safe>
                      {entry.actorEmail ?? ""}
                    </span>
                  </>
                ) : (
                  <span class="hint">System (CLI)</span>
                )}
              </td>
              <td safe>
                {ACTIVITY_ACTIONS[entry.action as keyof typeof ACTIVITY_ACTIONS] ?? entry.action}
              </td>
              <td>
                {entry.targetName ? (
                  <>
                    <span safe>{entry.targetName}</span>
                    <span class="hint block" safe>
                      {entry.targetEmail ?? ""}
                    </span>
                  </>
                ) : (
                  <span class="hint">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {entries.length === 0 && <p class="hint staff-foot">Nothing recorded yet.</p>}
    </StaffShell>
  );
}
