import { day, SEVERITY_LABELS, severityTone } from "../../../../domain/report-detail.js";
import { StaffShell } from "../../shared/shell.js";

/**
 * The work an Officer has been handed once a report is through assessment.
 *
 * The other end of the manager's "Approve & assign work". Until this page existed the decision was
 * written, the report moved to `assigned_for_work`, and the Officer named in it was told nothing —
 * the assignment was real in the database and invisible to the only person it obliged.
 *
 * Not a work-execution system, deliberately. There is no Start, no In progress, no Submit and no
 * Close, because the MVP ends where the manager's decision does: this says what was assigned, by
 * whom, and what the assessors and the manager concluded. What an Officer then does about it
 * happens off the system for now, and inventing a lifecycle here would be inventing a workflow
 * that has not been designed yet.
 */

/** One report the manager has approved and assigned to this Officer to carry out. */
export type WorkRow = {
  reportId: string;
  number: string;
  receivedAt: Date;
  deviceName: string;
  severity: string;
  /** The manager who approved it and named this Officer. */
  assignedByName: string;
  assignedAt: Date;
  /** The report's own status. `assigned_for_work` for everything this page can list. */
  status: string;
};

export type MyWorkPageProps = {
  viewerRole: string;
  viewerName: string;
  rows: WorkRow[];
};

/** The caption for the one status this page can show, so the cell never prints an enum value. */
const STATUS_LABELS: Record<string, string> = {
  assigned_for_work: "Assigned for work",
};

/**
 * Everything assigned to this Officer to carry out, newest assignment first.
 *
 * No tabs. Three state tabs are what "My assessments" needs because an assessment genuinely moves
 * through three states; assigned work has exactly one, and a bar with a single tab is furniture
 * rather than navigation.
 *
 * Nobody else's work appears, and there is no filter that could show it: the page is built from
 * one WHERE clause on the reader's own id.
 */
export function MyWorkPage({ viewerRole, viewerName, rows }: MyWorkPageProps): JSX.Element {
  return (
    <StaffShell
      title="My work — AE Reports"
      pageTitle="My work"
      role={viewerRole}
      fullName={viewerName}
      active="my-work"
    >
      <div class="staff-head">
        <div class="sp">
          <h2>Assigned for work</h2>
          <p class="hint">
            {rows.length} report{rows.length === 1 ? "" : "s"} the manager has approved and assigned
            to you
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        // No header over an empty body: the same argument every other queue in the app makes.
        <p class="hint">Nothing has been assigned to you for work yet.</p>
      ) : (
        // Wider than a narrow window once the two people and the two dates are on it, so the table
        // scrolls inside its own box rather than pushing the page sideways. See `.tscroll`.
        <div class="tscroll">
          <table class="utable">
            <thead>
              <tr>
                <th>Number</th>
                <th>Received</th>
                <th>Device</th>
                <th>Severity</th>
                <th>Assigned by</th>
                <th>Assigned</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr>
                  {/* To the work item, not to the register's copy of the report. The work item is
                      the reader's own page and is refused to anyone the assignment does not name. */}
                  <td>
                    <a href={`/reports/${row.reportId}/final-document`} safe>
                      {row.number}
                    </a>
                  </td>
                  <td>{day(row.receivedAt)}</td>
                  <td>
                    <span class="cap" safe>
                      {row.deviceName}
                    </span>
                  </td>
                  <td>
                    <span
                      class={`tag ${severityTone(row.severity) === "caution" ? "warn" : ""}`}
                      safe
                    >
                      {SEVERITY_LABELS[row.severity] ?? row.severity}
                    </span>
                  </td>
                  <td safe>{row.assignedByName}</td>
                  <td>{day(row.assignedAt)}</td>
                  <td>
                    <span class="tag muted" safe>
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </td>
                  <td>
                    <a href={`/reports/${row.reportId}/final-document`} class="btn ghost btn-sm">
                      Open
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </StaffShell>
  );
}
