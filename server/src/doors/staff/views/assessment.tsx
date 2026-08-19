import { type ReportDetail, ReportDocument } from "./reports.js";
import { StaffShell } from "./shell.js";

export type Assessment1PageProps = {
  report: ReportDetail;
  viewerRole: string;
  /** The signed-in person, for the title bar. */
  viewerName: string;
};

/**
 * Where the first assessment of a report will be made.
 *
 * The doorway, and nothing behind it yet. It shows the Officer the report they have been given —
 * the same document `ReportPage` renders, through the same component, so what they assess cannot
 * drift from what they were shown — under a heading saying what the page is for.
 *
 * Deliberately without a form. F004 is a long document with rules of its own, and half of one
 * posting to a route that does not exist would be worse than an honest empty space. Nothing here
 * submits anywhere and nothing changes a status. Section 7.2 is not here at all: the second
 * assessor is a different person, and who may open their page is a decision this slice does not
 * make.
 */
export function Assessment1Page({
  report,
  viewerRole,
  viewerName,
}: Assessment1PageProps): JSX.Element {
  return (
    <StaffShell
      title={`Assessment 1 — ${report.number}`}
      pageTitle="Assessment 1"
      role={viewerRole}
      fullName={viewerName}
      active="reports"
    >
      <div class="staff-head">
        <div class="sp">
          <h2 safe>{report.number}</h2>
          <p class="hint" safe>
            {report.deviceName}
          </p>
        </div>
        <a href={`/reports/${report.id}`} class="btn ghost">
          ← Back to the report
        </a>
      </div>

      <div class="alert">
        The assessment form arrives in a later slice. This page is the report as it was submitted,
        for the Officer it was assigned to.
      </div>

      <ReportDocument report={report} />
    </StaffShell>
  );
}
