import {
  type DecisionEntry,
  DecisionHistory,
  day,
  type ReportDetail,
  ReportDocument,
  SEVERITY_LABELS,
  severityTone,
} from "./reports.js";
import { StaffShell } from "./shell.js";

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
                    <a href={`/my-work/${row.reportId}`} safe>
                      {row.number}
                    </a>
                  </td>
                  <td>{day(row.receivedAt)}</td>
                  <td safe>{row.deviceName}</td>
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
                    <a href={`/my-work/${row.reportId}`} class="btn ghost btn-sm">
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

/** One assessment the report went through, as the Officer carrying out the work reads it. */
export type WorkAssessmentRead = {
  ordinal: number;
  assessorName: string;
  submittedOn: string | null;
  /** Section 7.1 for the first assessment. Null wherever the column holds nothing. */
  conclusion: string | null;
};

export type MyWorkItemPageProps = {
  report: ReportDetail;
  viewerRole: string;
  viewerName: string;
  /** The manager who approved it, and when. */
  assignedByName: string;
  assignedAt: string;
  /** The manager's instruction on the assignment itself, where they wrote one. */
  instruction: string | null;
  /** Every assessment the report went through, oldest first — A1 and each secondary one. */
  assessments: WorkAssessmentRead[];
  /** The whole decision history, the same list the manager reads on the report. */
  decisions: DecisionEntry[];
};

/**
 * One assigned report, as the Officer who has to act on it needs to read it.
 *
 * The report as filed, then how it was assessed, then what the manager decided — in that order,
 * because that is the order the case happened in. The assessments are a summary rather than four
 * full F004s: this reader is carrying out a recommendation, not auditing the assessment, and the
 * whole document is one link away for the reader who wants it.
 *
 * Nothing here is a control. There is no Start and no Complete, because the MVP has no work
 * lifecycle — see the note at the top of this file.
 */
export function MyWorkItemPage({
  report,
  viewerRole,
  viewerName,
  assignedByName,
  assignedAt,
  instruction,
  assessments,
  decisions,
}: MyWorkItemPageProps): JSX.Element {
  return (
    <StaffShell
      title={`${report.number} — my work`}
      pageTitle="My work"
      role={viewerRole}
      fullName={viewerName}
      active="my-work"
    >
      <div class="staff-head">
        <div class="sp">
          <h2 safe>{report.number}</h2>
          <p class="hint" safe>
            {report.deviceName}
          </p>
        </div>
        <a href="/my-work" class="btn ghost">
          ← Back to my work
        </a>
      </div>

      {/* Who handed it over and when, said once at the top. The reader arrived here because
          somebody named them, and the first thing they need is who, and why. */}
      <div class="review manager-instruction">
        <p class="hint">
          Assigned to you by <span safe>{assignedByName}</span> on <span safe>{assignedAt}</span>
        </p>
        {instruction === null ? (
          <p class="hint">No further instruction was left with the assignment.</p>
        ) : (
          <p class="review-text" safe>
            {instruction}
          </p>
        )}
      </div>

      <h2 class="report-heading">The report as filed</h2>
      <ReportDocument report={report} />

      <h2 class="report-heading">How it was assessed</h2>
      {assessments.length === 0 ? (
        <p class="hint">No assessment is recorded against this report.</p>
      ) : (
        <ol class="decision-history">
          {assessments.map((a) => (
            <li class="review">
              <p class="hint">
                <span safe>{`A${a.ordinal}`}</span> · <span safe>{a.assessorName}</span>
                {a.submittedOn === null ? (
                  <span> · not submitted</span>
                ) : (
                  <span safe>{` · submitted ${a.submittedOn}`}</span>
                )}
              </p>
              {a.conclusion && (
                <p class="review-text" safe>
                  {a.conclusion}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      <DecisionHistory decisions={decisions} />

      {/* The full document, for a reader who wants the assessment itself rather than its outcome.
          A link rather than a second copy of the report page: that page already exists, already
          decides what each role may see on it, and duplicating it here would mean two answers to
          the same question. */}
      <p class="hint">
        <a href={`/reports/${report.id}`}>Open the full report and assessments</a>
      </p>
    </StaffShell>
  );
}
