import { type ActivityEntry, ActivityTable } from "./activity.js";
import { type ReceivedRow, ReceivedRows } from "./reports.js";
import { StaffShell } from "./shell.js";

export type DashboardPageProps = {
  fullName: string;
  role: string;
  /** Every report in the register. Shown to everyone, because everyone can open the list. */
  reportCount: number;
  /**
   * Managers only: the register folded into the four states the workload page is divided by, and
   * how many reports have reached an approved F004.
   *
   * The same four meanings and the same words as the workload's own tabs, deliberately — a
   * manager reading "Decision: 3" here and opening that tab must find those three. Undefined for
   * every other role, whose dashboard does not run the query behind it.
   */
  managerSummary?:
    | {
        notStarted: number;
        inProgress: number;
        decision: number;
        assignedForWork: number;
        finalReports: number;
      }
    | undefined;
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
 * A manager gets the shape of the register: how much is at each stage, and how much has been
 * approved. It is a summary and stays one — the rows behind every figure are a click away on the
 * workload page, and a second table of them here would be that page with a different heading.
 */
export function DashboardPage({
  fullName,
  role,
  reportCount,
  managerSummary,
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

        {/* The four states, in pipeline order, under the words the workload page already uses for
            them. A status the database stores is never printed: `awaiting_second_assessor` is a
            step of the machine, and what a manager needs to read is that three reports are
            waiting on them. */}
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

        {activeStaff !== undefined && (
          <div class="stat">
            <span class="eyebrow">Staff</span>
            <b>{activeStaff}</b>
            <span class="hint">active accounts</span>
          </div>
        )}
      </div>

      <p class="dash-note">
        {/* The pipeline first for a manager: the figures above say how much, and the workload is
            where they act on it. The register is beside it, not replaced by it. */}
        {managerSummary === undefined ? (
          <></>
        ) : (
          <>
            <a href="/workload" class="btn">
              Open workload
            </a>{" "}
            <a href="/final-reports" class="btn ghost">
              Final reports
            </a>{" "}
          </>
        )}
        <a href="/reports" class={managerSummary === undefined ? "btn" : "btn ghost"}>
          Open the reports list
        </a>
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
