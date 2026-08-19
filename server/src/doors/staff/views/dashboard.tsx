import { type ActivityEntry, ActivityTable } from "./activity.js";
import { type ReceivedRow, ReceivedRows } from "./reports.js";
import { StaffShell } from "./shell.js";

export type DashboardPageProps = {
  fullName: string;
  role: string;
  /** Every report in the register. Shown to everyone, because everyone can open the list. */
  reportCount: number;
  /** Administrators only; undefined for anyone else, who is not shown the staff figure. */
  activeStaff?: number | undefined;
  /**
   * Officers only: everything that has arrived and not been assessed, and the newest few of them.
   *
   * `count` is the whole queue and `rows` the slice shown. The two differ once more has arrived
   * than fits, which is exactly why the figure is worth printing beside the list. Undefined for
   * every other role, whose dashboard does not run the query behind it.
   */
  received?: { count: number; rows: ReceivedRow[] } | undefined;
  /** Administrators only. Empty for anyone else, whose dashboard carries no trail. */
  recent: ActivityEntry[];
};

/**
 * Where a fully signed-in user lands.
 *
 * An administrator gets the two figures they are accountable for and the last few things that
 * happened. An Officer gets what is waiting — the size of the received queue and the newest of it,
 * which is the nearest thing to "your work" that is true before anything assigns it.
 *
 * A manager gets the register's size and an honest sentence about the rest. Nothing on this page
 * claims a report belongs to the person reading it: there is no assignment table, and a panel
 * promising otherwise would be a worse page than one that says so plainly.
 */
export function DashboardPage({
  fullName,
  role,
  reportCount,
  activeStaff,
  received,
  recent,
}: DashboardPageProps): JSX.Element {
  return (
    <StaffShell
      title="AE Reports — Staff"
      pageTitle="Dashboard"
      role={role}
      fullName={fullName}
      active="dashboard"
    >
      <div class="stats">
        <div class="stat">
          <span class="eyebrow">Reports</span>
          <b>{reportCount}</b>
          <span class="hint">in the register</span>
        </div>

        {received !== undefined && (
          <div class="stat">
            <span class="eyebrow">Received</span>
            <b>{received.count}</b>
            <span class="hint">not yet assessed</span>
          </div>
        )}

        {activeStaff !== undefined && (
          <div class="stat">
            <span class="eyebrow">Staff</span>
            <b>{activeStaff}</b>
            <span class="hint">active accounts</span>
          </div>
        )}
      </div>

      <p class="dash-note">
        <a href="/reports" class="btn">
          Open the reports list
        </a>
      </p>

      {received !== undefined && (
        <p class="hint dash-note">
          Reports are not assigned yet, so this is everything that has arrived and not been
          assessed.
        </p>
      )}

      {/* The manager's, and only the manager's: an administrator has their own figures and an
          Officer now has the queue, so this is what is left to say to the one role with neither. */}
      {activeStaff === undefined && received === undefined && (
        <p class="hint dash-note">
          Your own work arrives in a later slice. Until reports are assigned, everyone sees the same
          list.
        </p>
      )}

      {received !== undefined && (
        <div class="dash-queue">
          <h2>Received reports</h2>

          {/* No rows means the sentence and nothing else. A table header over an empty body reads
              as a list that failed to load rather than a queue that is genuinely clear. */}
          {received.count === 0 ? (
            <p class="hint">Nothing is waiting to be assessed.</p>
          ) : (
            <ReceivedRows reports={received.rows} />
          )}
        </div>
      )}

      {recent.length > 0 && (
        <div class="dash-recent">
          <div class="staff-head">
            <div class="sp">
              <h2>Recent activity</h2>
            </div>
            <a href="/activity" class="btn ghost btn-sm">
              See all
            </a>
          </div>

          <ActivityTable entries={recent} />
        </div>
      )}
    </StaffShell>
  );
}
