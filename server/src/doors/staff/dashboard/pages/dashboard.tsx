import type { ReceivedRow } from "../../../../domain/report-detail.js";
import { type ActivityEntry, ActivityTable } from "../../activity/pages/activity.js";
import { ReceivedRows } from "../../shared/components/report-views.js";
import { StaffShell } from "../../shared/shell.js";

export type DashboardPageProps = {
  fullName: string;
  role: string;

  reportCount: number;

  managerSummary?:
    | {
        notStarted: number;
        inProgress: number;
        decision: number;
        assignedForWork: number;
        finalReports: number;
      }
    | undefined;

  seriousSummary?: { total: number; overdue: number } | undefined;
  activeStaff?: number | undefined;

  received?: { count: number; rows: ReceivedRow[] } | undefined;
  recent: ActivityEntry[];
};


export function DashboardPage({
  fullName,
  role,
  reportCount,
  managerSummary,
  seriousSummary,
  activeStaff,
  received,
  recent,
}: DashboardPageProps): JSX.Element {
  return (
    <StaffShell
      title="AE Reports — Staff"
      pageTitle="Dashboard"
      pageCss="dashboard"
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

        {managerSummary !== undefined && (
          <>
            <div class="stat">
              <span class="eyebrow">Not started</span>
              <b>{managerSummary.notStarted}</b>
              <span class="hint">assessment not begun</span>
            </div>

            <div class="stat">
              <span class="eyebrow">In progress</span>
              <b>{managerSummary.inProgress}</b>
              <span class="hint">being assessed now</span>
            </div>

            <div class="stat">
              <span class="eyebrow">Decision</span>
              <b>{managerSummary.decision}</b>
              <span class="hint">waiting on you</span>
            </div>

            <div class="stat">
              <span class="eyebrow">Assigned for work</span>
              <b>{managerSummary.assignedForWork}</b>
              <span class="hint">approved and handed out</span>
            </div>

            <div class="stat">
              <span class="eyebrow">Final reports</span>
              <b>{managerSummary.finalReports}</b>
              <span class="hint">approved F004 documents</span>
            </div>
          </>
        )}

        {seriousSummary !== undefined && (
          <a href="/workload" class="stat stat-serious">
            <span class="eyebrow">Serious AEs/AIs</span>
            <b>{seriousSummary.total}</b>
            <span class="hint">
              {seriousSummary.overdue > 0 ? (
                <span class="stat-serious-overdue" safe>
                  {`${seriousSummary.overdue} overdue`}
                </span>
              ) : (
                "none overdue"
              )}
            </span>
          </a>
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
 
    {received !== undefined ? (
          <>
            <a href="/assessments" class="btn">
              My assessments
            </a>{" "}
            <a href="/my-work" class="btn ghost">
              My work
            </a>
          </>
        ) : managerSummary !== undefined ? (
          <>
            <a href="/workload" class="btn">
              Open workload
            </a>{" "}
            <a href="/final-reports" class="btn ghost">
              Final reports
            </a>
          </>
        ) : null}
      </p>

      {received !== undefined && (
        <p class="hint dash-note">
          Reports are not assigned yet, so this is everything that has arrived and not been
          assessed.
        </p>
      )}

      {received !== undefined && (
        <div class="dash-queue">
          <h2>Received reports</h2>

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
