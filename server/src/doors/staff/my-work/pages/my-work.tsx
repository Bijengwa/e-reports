import {
  OrangeReportIdentity,
  OrangeReportSurface,
} from "../../reports/components/orange-report.js";
import {
  day,
  type ReportDetail,
  ReportDocument,
  SEVERITY_LABELS,
  severityTone,
} from "../../reports/pages/reports.js";
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
                    <a href={`/my-work/${row.reportId}`} safe>
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

/**
 * What the Officer carrying out the work is given, and it is deliberately short.
 *
 * The report as filed, the assignment, and the Final F004. Nothing about the assessments and
 * nothing about the decisions — this page used to carry both, naming every assessor and printing
 * the manager's whole decision history, which handed one Officer the internal record of how the
 * office argued its way to a position and who was overruled getting there. That record belongs to
 * the manager and to the audit trail.
 *
 * The Officer is not being kept in the dark about their own task: the Final F004 IS the office's
 * position, in full, on the form it belongs on, and it is the thing they have been asked to carry
 * out. What they no longer see is the working out.
 */
export type MyWorkItemPageProps = {
  report: ReportDetail;
  viewerRole: string;
  viewerName: string;
  /** The manager who approved it, and when. */
  assignedByName: string;
  assignedAt: string;
  /** The manager's instruction on the assignment itself, where they wrote one. */
  instruction: string | null;
};

/**
 * One assigned report, as the Officer who has to act on it needs to read it.
 *
 * Who assigned it and why, the approved F004 they are carrying out, and the report as the reporter
 * filed it. That is the whole page, and the order is the order the reader needs it in: the
 * instruction first, because it is why they are here, then the document, then the source.
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
          {/* The report this work is about, wearing the identity it wears on every other page. */}
          <OrangeReportIdentity report={report} />
        </div>
        {/* A label, not a link: it drives the drawer's checkbox, exactly as on the two assessment
            pages. The Orange Report is reached the same way from every page that has one. */}
        <label for="a1-drawer" class="btn a1-open orange-action">
          Orange Report
        </label>
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

      {/*
        The approved outcome, first and at full weight.

        This page used to print the Orange Report in full under a heading and offer the Final F004
        as a line of hint text above it, which told the Officer that the thing they were here to
        read was the report a member of the public filed. It is not. They have been handed the
        office's position and asked to carry it out; the Final F004 IS that position, and the
        report is the source it was reached from.

        So the order is the order of the reader's task: what was decided, then what it was decided
        about. Always present — a report only reaches this page through the approval that writes
        the final document.
      */}
      <div class="mw-final">
        <a href={`/reports/${report.id}/final-document`} class="btn">
          Open the Final F004
        </a>
        <p class="hint">
          The assessment of this report, as approved. This is the work to carry out.
        </p>
      </div>

      {/* The source, in the drawer every other page keeps it in. Available in one click from the
          header, and not competing with the document above for the first thing read. */}
      <input type="checkbox" id="a1-drawer" class="a1-pick" data-a1-drawer />
      <label for="a1-drawer" class="a1-scrim">
        <span class="vh">Close the Orange Report</span>
      </label>
      <aside class="a1-drawer" aria-label="The report as filed">
        <div class="a1-drawer-head">
          <h3>The report as filed</h3>
          <label for="a1-drawer" class="a1-drawer-close">
            Close
          </label>
        </div>
        <OrangeReportSurface report={report} withIdentity>
          <ReportDocument report={report} />
        </OrangeReportSurface>
      </aside>

      {/* Nothing follows.

          "How it was assessed" and the decision history used to, and both are gone: the first
          named every assessor on the report and the second printed the manager's whole record of
          what was decided and why, to a reader whose business is carrying out the conclusion. The
          way to the general report page went with them — `/reports/:id` is the assessment
          workflow, and an Officer whose report has reached `assigned_for_work` is refused it by
          `reportsRoutes` regardless, so a link to it here would be a dead end drawn on purpose. */}
    </StaffShell>
  );
}
