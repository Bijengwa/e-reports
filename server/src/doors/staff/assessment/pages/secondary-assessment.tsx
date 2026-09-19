import type { F004Answers, Issue, SecondaryReviewPayload } from "../../../../domain/f004.js";
import type { ManagerReviewNote, ReportDetail } from "../../../../domain/report-detail.js";
import { isSeriousCase } from "../../../../domain/reports.js";
import { DocHeader } from "../../shared/components/doc-header.js";
import { F004Form, type PriorSecondaryReview } from "../../shared/components/f004.js";
import { IconClose } from "../../shared/components/icons.js";
import { OrangeReportSurface } from "../../shared/components/orange-report.js";
import { ManagerReviewBlock, ReportDocument } from "../../shared/components/report-views.js";
import { StaffShell } from "../../shared/shell.js";
import { Countdown } from "../components/countdown.js";

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
  /** A1's own established IMDRF release, formatted for display — see `F004FormProps`. */
  imdrfReleaseLabel?: string;
  /** This assignment's own deadline, the same `assessments.due_at` field `assessor1DueAt` reads
   *  for the first assessment — read off `resolveMine`'s own `mine.dueAt`, never recomputed. */
  dueAt: Date | null;
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
  dueAt,
  imdrfReleaseLabel,
}: SecondaryAssessmentPageProps): JSX.Element {
  return (
    <StaffShell
      title={`Secondary assessment — ${report.number}`}
      pageCss="caseCss"
      // The compact `DocHeader` below is now the page's own title row — see the same note on
      // `Assessment1Page`.
      pageTitle={`Secondary assessment (A${ordinal})`}
      role={viewerRole}
      fullName={viewerName}
      active="assessments"
      f4Find
      countdown
      imdrfPicker
    >
      {/* Everything that used to sit here — the Orange Report identity card, a standalone back
          button, the "Secondary assessment" heading and explanatory paragraph, and the
          Agree/Clarification/Disagree legend — is gone. What each of those colours means is
          already carried by the inline review controls themselves (`A2InlineDecision`'s own
          labelled radios), so the legend was restating, not teaching. `DocHeader` is the one row
          the page opens with; the official F004 masthead follows immediately after it. */}
      <DocHeader
        backHref="/assessments"
        backLabel="Back to my assessments"
        title={`Secondary assessment (A${ordinal})`}
        badge={
          <Countdown dueAt={dueAt} completed={submitted} serious={isSeriousCase(report.severity)} />
        }
      >
        <label for="a1-drawer" class="btn a1-open orange-action">
          Orange Report
        </label>
      </DocHeader>

      <div class="a1-work">
        <input type="checkbox" id="a1-drawer" class="a1-pick" data-a1-drawer />

        <div>
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
            imdrfReleaseLabel={imdrfReleaseLabel}
          />
        </div>

        <label for="a1-drawer" class="a1-scrim">
          <span class="vh">Close the report</span>
        </label>

        <aside class="a1-drawer" aria-label="The report as filed">
          <div class="a1-drawer-head">
            <h3>The report as filed</h3>
            <label for="a1-drawer" class="a1-drawer-close" aria-label="Close the report">
              <IconClose />
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
