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
 * Both at once, because assessing is comparing one against the other. Given the width they sit
 * side by side with the report sticky, so scrolling the form does not scroll away the thing being
 * assessed. Below 1200px there is no room for two columns, so they become tabs — the assessor
 * still has both, one at a time, rather than one buried under the other.
 *
 * The tabs are two radios and CSS. No script: a page whose only interaction is "show me the other
 * pane" should not stop working because a bundle failed, and the radios sit outside the F004's own
 * form so choosing a tab can never submit an assessment.
 *
 * The report is rendered through `ReportDocument`, the same component `/reports/:id` uses, so what
 * is being assessed cannot drift from what was shown.
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
      active="assessments"
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

      <div class="a1-work">
        <input type="radio" name="a1-view" id="a1-form" class="a1-pick" checked />
        <input type="radio" name="a1-view" id="a1-report" class="a1-pick" />

        <div class="a1-tabs">
          <label for="a1-report">Report</label>
          <label for="a1-form">Assessment</label>
        </div>

        <div class="a1-split">
          <div class="a1-pane a1-report">
            <h3>The report as filed</h3>
            <ReportDocument report={report} />
          </div>

          <div class="a1-pane a1-form">
            <h3>Assessment 1 — F004</h3>
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
          </div>
        </div>
      </div>
    </StaffShell>
  );
}
