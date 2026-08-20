import { type ActivityEntry, ActivityTable } from "./activity.js";
import { day, type ReceivedRow, ReceivedRows, SEVERITY_LABELS, severityTone } from "./reports.js";
import { StaffShell } from "./shell.js";

/** A row of the manager's queue: what it is, when it landed. No `mine` — nothing is assigned. */
export type AwaitingSecondRow = {
  id: string;
  number: string;
  receivedAt: Date;
  deviceName: string;
  severity: string;
};

/**
 * The manager's queue, read-only.
 *
 * Every row opens the report itself rather than an assessment — a manager does not have one to
 * open, first or second, and a link to `/reports/:id/assessment-1` here would be a route this
 * role is refused the moment it followed it.
 */
export function AwaitingSecondRows({ reports }: { reports: AwaitingSecondRow[] }): JSX.Element {
  return (
    <table class="utable">
      <thead>
        <tr>
          <th>Number</th>
          <th>Received</th>
          <th>Device</th>
          <th>Severity</th>
        </tr>
      </thead>
      <tbody>
        {reports.map((report) => (
          <tr>
            <td>
              <a href={`/reports/${report.id}`} safe>
                {report.number}
              </a>
            </td>
            <td>{day(report.receivedAt)}</td>
            <td safe>{report.deviceName}</td>
            <td>
              <span class={`tag ${severityTone(report.severity) === "caution" ? "warn" : ""}`}>
                {SEVERITY_LABELS[report.severity] ?? report.severity}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

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
  /**
   * Managers only: reports with a submitted first assessment and no second assessor yet.
   *
   * Newest first — the manager wants what just landed, unlike the Officer's queue above which
   * sorts oldest first for the tie-break the assignment rule reads. Undefined for every other
   * role, whose dashboard does not run the query behind it.
   */
  awaitingSecondAssessor?: { count: number; rows: AwaitingSecondRow[] } | undefined;
  /** Administrators only. Empty for anyone else, whose dashboard carries no trail. */
  recent: ActivityEntry[];
};

/**
 * Where a fully signed-in user lands.
 *
 * An administrator gets the two figures they are accountable for and the last few things that
 * happened. An Officer gets what is waiting — the size of the received queue and the newest of it,
 * which is the nearest thing to "your work" that is true before anything assigns it. A manager
 * gets the size of the queue waiting for a second assessor, on the same argument.
 */
export function DashboardPage({
  fullName,
  role,
  reportCount,
  activeStaff,
  received,
  awaitingSecondAssessor,
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

        {awaitingSecondAssessor !== undefined && (
          <div class="stat">
            <span class="eyebrow">Awaiting second assessor</span>
            <b>{awaitingSecondAssessor.count}</b>
            <span class="hint">first assessment submitted</span>
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

      {awaitingSecondAssessor !== undefined && (
        <p class="hint dash-note">
          These reports have a submitted first assessment and are waiting for a second assessor.
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

      {awaitingSecondAssessor !== undefined && (
        <div class="dash-queue">
          <h2>Awaiting second assessor</h2>

          {/* Same honesty as the Officer's queue above: an empty body under a header would read as
              a list that failed to load rather than a queue that is genuinely clear. */}
          {awaitingSecondAssessor.count === 0 ? (
            <p class="hint">Nothing is waiting for a second assessor.</p>
          ) : (
            <AwaitingSecondRows reports={awaitingSecondAssessor.rows} />
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
