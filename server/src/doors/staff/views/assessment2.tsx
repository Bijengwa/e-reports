import type { F004Answers, Issue } from "../../../domain/f004.js";
import { F004Form, F004Second } from "./f004.js";
import {
  ManagerReviewBlock,
  type ManagerReviewNote,
  type ReportDetail,
  ReportDocument,
} from "./reports.js";
import { StaffShell } from "./shell.js";

/** What the second assessor reads before writing: the first assessment, as its author left it. */
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
  /** The signed-in person, for the title bar and the 2nd assessor line. */
  viewerName: string;
  first: FirstAssessmentRead;
  /** The manager's review of the first assessment, when one was written before the handover. */
  managerComment: ManagerReviewNote | null;
  /** This Officer's own answers: 7.2 and their signature, and nothing of the first assessor's. */
  answers: F004Answers;
  assessedOn: string;
  submitted: boolean;
  issues: readonly Issue[];
};

/**
 * The second assessment of one report.
 *
 * The same page as the first assessor's in every way that matters — the F004 in full, the report a
 * click away in the same drawer — and different in the one way that does: this Officer is not
 * writing the document, they are concluding it. So the F004 above is the first assessor's finished
 * work rendered read-only, and the only form on the page is section 7.2 and a signature.
 *
 * `omitSecond` on the document above is what keeps 7.2 from appearing twice: that form carries a
 * disabled placeholder for it, which would otherwise sit immediately above the live box this page
 * adds, and a page showing one field twice makes its reader work out which of the two counts.
 *
 * The manager's review comes between the two, because that is where it belongs in the reading:
 * here is what the first assessor found, here is what the manager said about it, now write yours.
 */
export function Assessment2Page({
  report,
  viewerRole,
  viewerName,
  first,
  managerComment,
  answers,
  assessedOn,
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
        {/* The same drawer the first assessor works with, opened by a label rather than a script,
            for the same reason: it has to work for someone whose JavaScript never arrived. */}
        <label for="a1-drawer" class="btn ghost a1-open">
          The report
        </label>
        <a href={`/reports/${report.id}`} class="btn ghost">
          ← Back to the report
        </a>
      </div>

      <div class="a1-work">
        {/* No name, so it is never posted; outside the form below, so it is not its business. */}
        <input type="checkbox" id="a1-drawer" class="a1-pick" data-a1-drawer />

        <div>
          <F004Form
            reportId={report.id}
            answers={first.answers}
            device={first.device}
            event={first.event}
            assessorName={first.assessorName}
            assessedOn={first.submittedOn}
            submitted
            // The first assessor's document. Read here, never posted from here.
            readOnly
            omitSecond
            issues={[]}
          />

          {managerComment && (
            <ManagerReviewBlock
              review={managerComment}
              heading="Manager review of the first assessment"
            />
          )}

          <h2 class="report-heading">7.2 Second assessor concluding remarks</h2>

          {issues.length > 0 && (
            <div class="alert alert-error" role="alert">
              <strong>This assessment cannot be submitted yet.</strong>
              <ul>
                {issues.map((issue) => (
                  <li safe>{issue.message}</li>
                ))}
              </ul>
            </div>
          )}

          {/* A form only while there is something to post, on the argument the document above
              makes for itself: a submitted assessment is closed, and a POST target advertised on
              a page that may not use it is a route that answers 403 to its own reader. */}
          {submitted ? (
            <div class="f4">
              <F004Second answers={answers} signedOn={assessedOn} locked />
              <p class="hint">
                This assessment has been submitted and is now read-only. The report is with the
                manager for a decision.
              </p>
            </div>
          ) : (
            <form method="POST" action={`/reports/${report.id}/assessment-2`} class="f4">
              <fieldset>
                <F004Second answers={answers} signedOn={assessedOn} />
              </fieldset>
              <div class="bar f4-buttons">
                <button type="submit" name="intent" value="save" class="btn ghost">
                  Save draft
                </button>
                <div class="sp"></div>
                <button type="submit" name="intent" value="submit" class="btn">
                  Submit assessment
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Both siblings of the checkbox, which is what lets CSS alone open them. */}
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
