import type { F004Answers, Issue } from "../../../domain/f004.js";
import { F004Form } from "./f004.js";
import { type ReportDetail, ReportDocument } from "./reports.js";
import { StaffShell } from "./shell.js";

export type Assessment1PageProps = {
  report: ReportDetail;
  viewerRole: string;
  /** The signed-in person, for the title bar and the 1st assessor line. */
  viewerName: string;
  answers: F004Answers;
  device: Record<string, string>;
  event: Record<string, string>;
  assessedOn: string;
  submitted: boolean;
  issues: readonly Issue[];
};

/**
 * The first assessment of one report: the F004, and the report it is about.
 *
 * Both on one page, the form first and the submitted document under it, because an assessor is
 * comparing one against the other. The report is rendered through `ReportDocument`, the same
 * component `/reports/:id` uses, so what is being assessed cannot drift from what was shown.
 *
 * Inside `StaffShell` like every other staff page: the rail stays, and this is somewhere in the
 * portal rather than a form that replaced it.
 */
export function Assessment1Page({
  report,
  viewerRole,
  viewerName,
  answers,
  device,
  event,
  assessedOn,
  submitted,
  issues,
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

      <F004Form
        reportId={report.id}
        answers={answers}
        device={device}
        event={event}
        assessorName={viewerName}
        assessedOn={assessedOn}
        submitted={submitted}
        issues={issues}
      />

      <details class="f4-source">
        <summary>The report as it was submitted</summary>
        <ReportDocument report={report} />
      </details>
    </StaffShell>
  );
}
