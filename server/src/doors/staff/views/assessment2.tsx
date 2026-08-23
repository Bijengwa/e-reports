import type { A2ReviewPayload, F004Answers, Issue } from "../../../domain/f004.js";
import { F004Form } from "./f004.js";
import {
  ManagerReviewBlock,
  type ManagerReviewNote,
  type ReportDetail,
  ReportDocument,
} from "./reports.js";
import { StaffShell } from "./shell.js";

/** What the second assessor reads before annotating: A1's submitted F004. */
export type FirstAssessmentRead = {
  assessorName: string;
  answers: F004Answers;
  submittedOn: string;
  device: Record<string, string>;
  event: Record<string, string>;
};

export type Assessment2PageProps = {
  report: ReportDetail;
  viewerRole: string;
  viewerName: string;
  first: FirstAssessmentRead;
  managerComment: ManagerReviewNote | null;
  review: A2ReviewPayload;
  submitted: boolean;
  issues: readonly Issue[];
};

export function Assessment2Page({
  report,
  viewerRole,
  viewerName,
  first,
  managerComment,
  review,
  submitted,
  issues,
}: Assessment2PageProps): JSX.Element {
  return (
    <StaffShell
      title={`Assessment 2 — ${report.number}`}
      pageTitle="Assessment 2"
      role={viewerRole}
      fullName={viewerName}
      active="assessments"
      f4Find
    >
      <div class="staff-head">
        <div class="sp">
          <h2 safe>{report.number}</h2>
          <p class="hint" safe>
            {report.deviceName}
          </p>
        </div>
        <label for="a1-drawer" class="btn ghost a1-open">
          The report
        </label>
        <a href={`/reports/${report.id}`} class="btn ghost">
          ← Back to the report
        </a>
      </div>

      <div class="a1-work">
        <input type="checkbox" id="a1-drawer" class="a1-pick" data-a1-drawer />

        <div>
          <div class="a2-intro">
            <h2>Second assessor section review</h2>
            <p>
              This is the first assessor's submitted F004, read-only. Take a position on each of
              their answers where the form asks you to, using the A2 block beside the answer itself.
              Every one of them needs a position before you can submit.
            </p>
            <div class="a2-legend">
              <span class="k-agree">Agree — keeps their answer, nothing to write</span>
              <span class="k-clarification">
                Need Clarification — a statement only, their answer stands
              </span>
              <span class="k-disagree">Disagree — your corrected answer, and why</span>
            </div>
          </div>

          {managerComment && (
            <ManagerReviewBlock
              review={managerComment}
              heading="Manager review of the first assessment"
            />
          )}

          <F004Form
            reportId={report.id}
            answers={first.answers}
            device={first.device}
            event={first.event}
            assessorName={first.assessorName}
            assessedOn={first.submittedOn}
            submitted
            readOnly
            omitSecond
            issues={issues}
            a2Review={{
              action: `/reports/${report.id}/assessment-2`,
              review,
              submitted,
            }}
          />
        </div>

        <label for="a1-drawer" class="a1-scrim">
          <span class="vh">Close the report</span>
        </label>

        <aside class="a1-drawer" aria-label="The report as filed">
          <div class="a1-drawer-head">
            <h3>The report as filed</h3>
            <label for="a1-drawer" class="a1-drawer-close">
              Close
            </label>
          </div>
          <ReportDocument report={report} />
        </aside>
      </div>
    </StaffShell>
  );
}
