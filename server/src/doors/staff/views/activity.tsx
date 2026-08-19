import { roleLabel } from "../../../domain/roles.js";
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
  "user.bootstrap_created": { label: "First administrator created", tone: "safe" },
  "user.created": { label: "Account created", tone: "safe" },
  "user.signed_in": { label: "Signed in", tone: "safe" },
  "user.password_changed": { label: "Password changed", tone: "safe" },
  "user.reactivated": { label: "Account reactivated", tone: "safe" },
  "user.password_reset": { label: "Password reset", tone: "caution" },
  "user.deactivated": { label: "Account deactivated", tone: "caution" },
} as const;

/**
 * How an entry reads at a glance, from the action and nothing else.
 *
 * Two tones, and neither of them is red. `caution` marks the two actions that take an account
 * away from its owner — a reset and a deactivation — because those are the ones an auditor scans
 * for. It does not mean anything went wrong: both are ordinary administration, and both are
 * things somebody should be able to account for afterwards.
 *
 * There is deliberately no third, alarming tone. `audit_log` records actions that succeeded, so
 * there is nothing in it to colour that way: a refused sign-in and a 403 are never written here,
 * and inventing a row to carry that colour would be inventing evidence.
 */
function toneOf(action: string): string {
  return ACTIVITY_ACTIONS[action as keyof typeof ACTIVITY_ACTIONS]?.tone ?? "safe";
}

function labelOf(action: string): string {
  return ACTIVITY_ACTIONS[action as keyof typeof ACTIVITY_ACTIONS]?.label ?? action;
}

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
  /** The actor's role at the time the page is read, not at the time of the action. */
  actorRole: string | null;
  /** Null only if the account behind the entry has gone. Nothing deletes users today. */
  targetName: string | null;
  targetEmail: string | null;
};

/** Minutes are as fine as this trail needs, and seconds only make the column harder to scan. */
function when(value: Date): string {
  return new Date(value).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * The rows themselves, shared with the dashboard's recent-activity panel.
 *
 * Extracted so the five entries on the dashboard cannot drift from the two hundred here: same
 * captions, same tones, same escaping, decided once.
 */
export function ActivityTable({ entries }: { entries: ActivityEntry[] }): JSX.Element {
  return (
    <table class="utable">
      <thead>
        <tr>
          <th>When (UTC)</th>
          <th>Actor</th>
          <th>Role</th>
          <th>Action</th>
          <th>Target</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr class={`tone-${toneOf(entry.action)}`}>
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
            <td>
              {entry.actorRole ? (
                <span safe>{roleLabel(entry.actorRole)}</span>
              ) : (
                <span class="hint">—</span>
              )}
            </td>
            <td safe>{labelOf(entry.action)}</td>
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
  );
}

export type ActivityPageProps = {
  entries: ActivityEntry[];
  /** The reader's own role, for the rail. */
  viewerRole: string;
  /** The signed-in person, for the title bar. */
  viewerName: string;
};

/**
 * Every account action, for every administrator.
 *
 * There is no per-administrator filtering: an audit trail one reader can see and another cannot
 * is not an audit trail. What keeps it honest is what the query never asks for — `before` and
 * `after` are not selected, so no payload, no hash and no cookie can reach this page even if a
 * future action were careless about what it wrote there.
 */
export function ActivityPage({ entries, viewerRole, viewerName }: ActivityPageProps): JSX.Element {
  return (
    <StaffShell
      title="Activity — AE Reports"
      pageTitle="Activity"
      role={viewerRole}
      fullName={viewerName}
      active="activity"
    >
      <div class="staff-head">
        <div class="sp">
          <p class="hint">
            Account actions, newest first. The most recent {ACTIVITY_LIMIT} are shown.
          </p>
        </div>
      </div>

      <ActivityTable entries={entries} />

      {entries.length === 0 && <p class="hint staff-foot">Nothing recorded yet.</p>}
    </StaffShell>
  );
}
