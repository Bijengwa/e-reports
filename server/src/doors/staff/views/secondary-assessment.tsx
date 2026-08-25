import type { F004Answers, Issue, SecondaryReviewPayload } from "../../../domain/f004.js";
import { F004Form, type PriorSecondaryReview } from "./f004.js";
import {
  ManagerReviewBlock,
  type ManagerReviewNote,
  type ReportDetail,
  ReportDocument,
} from "./reports.js";
import { OrangeReportIdentity, OrangeReportSurface } from "./orange-report.js";
import { StaffShell } from "./shell.js";

/** What a secondary assessor reads before annotating: A1's submitted F004. */
export type FirstAssessmentRead = {
  assessorName: string;
  answers: F004Answers;
  submittedOn: string;
  device: Record<string, string>;
  event: Record<string, string>;
};

export type SecondaryAssessmentPageProps = {
  report: ReportDetail;
  viewerRole: string;
  viewerName: string;
  /** 2, 3, 4, … — this reader's own position in the chain. */
  ordinal: number;
  first: FirstAssessmentRead;
  managerComment: ManagerReviewNote | null;
  /** The manager's reason for THIS assignment specifically — not the whole decision history. */
  managerInstruction: string | null;
  /** Every earlier secondary assessor's finished work, read-only context for this one. */
  priorReviews: readonly PriorSecondaryReview[];
  review: SecondaryReviewPayload;
  submitted: boolean;
  issues: readonly Issue[];
};

/** Today, for the date printed beside this assessor's own signature in 7.2. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SecondaryAssessmentPage({
  report,
  viewerRole,
  viewerName,
  ordinal,
  first,
  managerComment,
  managerInstruction,
  priorReviews,
  review,
  submitted,
  issues,
}: SecondaryAssessmentPageProps): JSX.Element {
  return (
    <StaffShell
      title={`Secondary assessment — ${report.number}`}
      pageTitle={`Secondary assessment (A${ordinal})`}
      role={viewerRole}
      fullName={viewerName}
      active="assessments"
      f4Find
    >
      <div class="staff-head">
        <div class="sp">
          {/* The Orange Report this assessment is OF, wearing its own identity. The assessment
              being written has its own heading and its own dates below; the two must not read as
              one document. */}
          <OrangeReportIdentity report={report} />
        </div>
        <label for="a1-drawer" class="btn a1-open orange-action">
          Orange Report
        </label>
        <a href={`/reports/${report.id}`} class="btn ghost">
          ← Back to the report page
        </a>
      </div>

      <div class="a1-work">
        <input type="checkbox" id="a1-drawer" class="a1-pick" data-a1-drawer />

        <div>
          <div class="a2-intro">
            <h2>Secondary assessment</h2>
            <p>
              This is the first assessor's submitted F004, read-only. Take a position on each of
              their answers where the form asks you to, using the block beside the answer itself.
              Every one of them needs a position before you can submit. Where an earlier secondary
              assessor has already reviewed a field, their finding is folded away above yours — open
              it if you want it before deciding your own.
            </p>
            <div class="a2-legend">
              <span class="k-agree">Agree — keeps their answer, nothing to write</span>
              <span class="k-clarification">
                Required clarification — your corrected wording, their answer stands
              </span>
              <span class="k-disagree">Disagree — your corrected answer, and why</span>
            </div>
          </div>

          {/* The manager's reason for handing THIS assessor the report, prominently, once — not
              repeated at every section. A reader who wants the fuller decision history reads it on
              the report page instead; this is oriented to the one instruction that explains why
              this page exists at all. */}
          {managerInstruction && (
            <div class="review manager-instruction">
              <p class="hint">Manager's instruction for this assignment</p>
              <p class="review-text" safe>
                {managerInstruction}
              </p>
            </div>
          )}

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
            issues={issues}
            // No `omitSecond`: 7.2 is this assessor's own half of the F004, and it renders live
            // inside the same form their positions on A1 post from.
            a2Review={{
              action: `/reports/${report.id}/secondary-assessment`,
              review,
              submitted,
              ordinal,
              assessorName: viewerName,
              assessedOn: today(),
            }}
            priorReviews={priorReviews}
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
          <OrangeReportSurface report={report} withIdentity>
            <ReportDocument report={report} />
          </OrangeReportSurface>
        </aside>
      </div>
    </StaffShell>
  );
}
