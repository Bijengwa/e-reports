import { type ActivityEntry, ActivityTable } from "./activity.js";
import { StaffShell } from "./shell.js";

export type DashboardPageProps = {
  fullName: string;
  role: string;
  /** Every report in the register. Shown to everyone, because everyone can open the list. */
  reportCount: number;
  /** Administrators only; undefined for anyone else, who is not shown the staff figure. */
  activeStaff?: number | undefined;
  /** Administrators only. Empty for anyone else, whose dashboard carries no trail. */
  recent: ActivityEntry[];
};

/**
 * Where a fully signed-in user lands.
 *
 * An administrator gets the two figures they are accountable for and the last few things that
 * happened. Everyone else gets the register's size and an honest sentence about the rest: work
 * cannot be listed per person until something assigns it, and a panel promising otherwise would
 * be a worse page than one that says so plainly.
 *
 * Both figures are counts rather than links into filtered views, because no filtered view exists.
 * The rail is the navigation, and it carries no entry that goes nowhere.
 */
export function DashboardPage({
  fullName,
  role,
  reportCount,
  activeStaff,
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

      {activeStaff === undefined && (
        <p class="hint dash-note">
          Your own work arrives in a later slice. Until reports are assigned, everyone sees the same
          list.
        </p>
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
