import { DEADLINE_UNITS, DEFAULT_DEADLINE } from "../../../../domain/assignment.js";
import type { F004Answers } from "../../../../domain/f004.js";
import {
  type AssessorOption,
  assessment1Href,
  caption,
  type DecisionEntry,
  type ManagerReviewNote,
  type ReportDetail,
  type SecondaryAssignment,
  STATUS_LABELS,
  secondaryAssessmentHref,
} from "../../../../domain/report-detail.js";
import { Countdown } from "../../assessment/components/countdown.js";
import {
  F004Form,
  type PriorSecondaryReview,
  type SectionComment,
} from "../../shared/components/f004.js";
import {
  OrangeReportIdentity,
  OrangeReportSurface,
} from "../../shared/components/orange-report.js";
import { ManagerReviewBlock, ReportDocument } from "../../shared/components/report-views.js";
import { StaffShell } from "../../shared/shell.js";

/**
 * The first assessment, as this page reads it for a manager's review: the F004's own answers,
 * already submitted, with nothing left to fill in.
 */
export type Assessment1ReviewProps = {
  assessorName: string;
  answers: F004Answers;
  conclusion: string | null;
  submittedOn: string;
  device: Record<string, string>;
  event: Record<string, string>;
  /** The manager's notes per section, keyed "1"…"8", and where a new one is posted. */
  sectionComments?: Record<string, SectionComment[]>;
  commentAction?: (section: string) => string;
  /** What the manager has already written about it, if anything. */
  managerComment: ManagerReviewNote | null;
};

function officerOptionLabel(option: AssessorOption): string {
  if (option.workload === undefined) return option.fullName;
  return `${option.fullName} — ${option.workload.active} (${option.workload.overdue} overdue)`;
}

/**
 * A compact, orientation-only strip of every assessment this report has had — who, and whether
 * they have finished.
 */
function AssessmentHistory({
  assessor1Name,
  assessor1DueAt,
  assessor1Submitted,
  secondaryAssessments,
  mySecondaryOrdinal,
}: {
  assessor1Name?: string | null;
  assessor1DueAt?: Date | null;
  assessor1Submitted?: boolean;
  secondaryAssessments: SecondaryAssignment[];
  mySecondaryOrdinal: number | null;
}): JSX.Element {
  return (
    <ol class="assessment-history">
      <li>
        <span class="a-hist-no">A1</span>
        <span safe>{assessor1Name ?? "Not assigned"}</span>
        {assessor1Name !== null && assessor1Name !== undefined && assessor1Submitted === true && (
          <span class="a-hist-done">✓</span>
        )}
        {assessor1Name !== null && assessor1Name !== undefined && assessor1Submitted !== true && (
          <Countdown dueAt={assessor1DueAt ?? null} completed={false} />
        )}
      </li>
      {secondaryAssessments.map((a) => (
        <li>
          <span class="a-hist-no" safe>{`A${a.ordinal}`}</span>
          <span safe>{a.assessorName}</span>
          {a.submitted ? (
            <span class="a-hist-done">✓</span>
          ) : (
            <>
              <Countdown dueAt={a.dueAt} completed={false} />
              {a.ordinal === mySecondaryOrdinal && <span class="a-hist-current">→ Current</span>}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * The manager's decision history: who decided, when, and what, oldest first.
 *
 * Exported because the Officer carrying out the work reads the same list on their own page.
 */
export function DecisionHistory({ decisions }: { decisions: DecisionEntry[] }): JSX.Element {
  if (decisions.length === 0) return <span hidden />;

  return (
    <>
      <h2 class="report-heading">Manager decision history</h2>
      <ol class="decision-history">
        {decisions.map((d) => (
          <li class="review">
            <p class="hint">
              <span safe>{d.decidedByName}</span> · <span safe>{d.decidedAt}</span> ·{" "}
              <span safe>
                {d.kind === "assign_next_assessor"
                  ? `Assigned ${d.nextAssessorName ?? "—"} as A${d.nextOrdinal ?? "?"}`
                  : `Assigned ${d.workOfficerName ?? "—"} for work`}
              </span>
            </p>
            {d.comment && (
              <p class="review-text" safe>
                {d.comment}
              </p>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

export type CaseDetailPageProps = {
  report: ReportDetail;
  viewerRole: string;
  viewerName: string;
  canAssess: boolean;
  mySecondaryOrdinal: number | null;
  canComment?: boolean;
  error?: string;
  assessor1Name?: string | null;
  assessor1DueAt?: Date | null;
  assessor1Submitted?: boolean;
  assessment1Review?: Assessment1ReviewProps;
  secondaryAssessments: SecondaryAssignment[];
  firstAssessorPicker?: AssessorOption[];
  nextAssessorPicker?: AssessorOption[];
  workOfficerPicker?: AssessorOption[];
  decisions: DecisionEntry[];
  hasFinalDocument?: boolean;
};

/**
 * One case, as the Register's own record of it: the Orange Report, every assessment, every
 * manager decision, and — for a manager — the controls that move it forward. Read-only except for
 * those decision controls, which is the one piece of writing the Register's case record owns.
 */
export function CaseDetailPage({
  report,
  viewerRole,
  viewerName,
  canAssess,
  mySecondaryOrdinal,
  canComment,
  error,
  assessor1Name,
  assessor1DueAt,
  assessor1Submitted,
  assessment1Review,
  secondaryAssessments,
  firstAssessorPicker,
  nextAssessorPicker,
  workOfficerPicker,
  decisions,
  hasFinalDocument,
}: CaseDetailPageProps): JSX.Element {
  const submitted = secondaryAssessments.filter((a) => a.submitted);
  const latest = submitted[submitted.length - 1];
  const earlierSecondary = submitted.slice(0, -1);

  const priorReviews: PriorSecondaryReview[] = earlierSecondary.map((a) => ({
    ordinal: a.ordinal,
    assessorName: a.assessorName,
    submittedOn: a.submittedOn ?? "",
    review: a.answers,
  }));

  return (
    <StaffShell
      title={`${report.number} — AE Reports`}
      pageTitle={report.number}
      role={viewerRole}
      fullName={viewerName}
      active="register"
      countdown
    >
      <div class="staff-head">
        <div class="sp">
          <OrangeReportIdentity report={report} />
          <AssessmentHistory
            assessor1Name={assessor1Name}
            assessor1DueAt={assessor1DueAt}
            assessor1Submitted={assessor1Submitted}
            secondaryAssessments={secondaryAssessments}
            mySecondaryOrdinal={mySecondaryOrdinal}
          />
        </div>

        {hasFinalDocument === true && (
          <a href={`/reports/${report.id}/final-document`} class="btn">
            Final F004
          </a>
        )}
        {canAssess && (
          <a href={assessment1Href(report.id)} class="btn">
            Assessment 1
          </a>
        )}
        {mySecondaryOrdinal !== null && (
          <a href={secondaryAssessmentHref(report.id)} class="btn">
            {`My assessment (A${mySecondaryOrdinal})`}
          </a>
        )}
        <a href="/register" class="btn ghost">
          ← Back to register
        </a>
      </div>

      {error && (
        <div class="alert alert-error" role="alert" safe>
          {error}
        </div>
      )}

      <OrangeReportSurface report={report}>
        <ReportDocument report={report} />
      </OrangeReportSurface>

      {assessment1Review && (
        <>
          <h2 class="report-heading">First assessment</h2>
          <F004Form
            reportId={report.id}
            answers={assessment1Review.answers}
            device={assessment1Review.device}
            event={assessment1Review.event}
            assessorName={assessment1Review.assessorName}
            assessedOn={assessment1Review.submittedOn}
            submitted
            readOnly
            sectionComments={assessment1Review.sectionComments}
            commentAction={assessment1Review.commentAction}
            a2Review={
              latest && {
                action: secondaryAssessmentHref(report.id),
                review: latest.answers,
                submitted: true,
                ordinal: latest.ordinal,
                assessorName: latest.assessorName,
                assessedOn: latest.submittedOn ?? "",
              }
            }
            priorReviews={priorReviews}
            issues={[]}
          />

          {assessment1Review.managerComment && (
            <ManagerReviewBlock
              review={assessment1Review.managerComment}
              heading="Manager review"
            />
          )}

          {canComment ? (
            <></>
          ) : (
            <p class="hint">
              This assessment is closed to further review — the report is now{" "}
              <span safe>{caption(STATUS_LABELS, report.status)}</span>. What was written about it
              stays above, and the decisions that moved it on are below.
            </p>
          )}

          {canComment && (
            <form
              method="POST"
              action={`/reports/${report.id}/assessment-1/comment`}
              class="review-form"
            >
              <div class="f">
                <label for="manager-comment">
                  {assessment1Review.managerComment
                    ? "Replace your review of this assessment"
                    : "Your review of this assessment"}
                </label>
                <textarea
                  id="manager-comment"
                  name="comment"
                  rows="4"
                  class="short"
                  placeholder="What the next assessor should know before starting."
                  safe
                >
                  {assessment1Review.managerComment?.text ?? ""}
                </textarea>
              </div>
              <div class="bar">
                <div class="sp"></div>
                <button type="submit" class="btn">
                  {assessment1Review.managerComment ? "Update review" : "Save review"}
                </button>
              </div>
            </form>
          )}
        </>
      )}

      <DecisionHistory decisions={decisions} />

      {(firstAssessorPicker || nextAssessorPicker || workOfficerPicker) && (
        <>
          <h2 class="report-heading">Manager decision</h2>
          <p class="hint">
            {firstAssessorPicker
              ? "Name the Officer who will make the first assessment of this report, and by when."
              : workOfficerPicker
                ? "Choose one: send the report for another assessment, or approve it and assign the work."
                : "Name the Officer who will assess this report next."}
          </p>
          <div class="grid2">
            {firstAssessorPicker && (
              <form
                method="POST"
                action={`/reports/${report.id}/assign-first-assessor`}
                class="card card-b review-form"
              >
                <h3>Assign first assessor</h3>
                {firstAssessorPicker.length === 0 ? (
                  <p class="hint">No active Officer is available to take this report.</p>
                ) : (
                  <>
                    <div class="f">
                      <label for="first-officer">Assign to</label>
                      <select id="first-officer" name="assessor_id" aria-label="First assessor">
                        {firstAssessorPicker.map((option) => (
                          <option value={option.id} safe>
                            {officerOptionLabel(option)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div class="f">
                      <label for="first-deadline-value">Deadline</label>
                      <div class="bar">
                        <input
                          type="number"
                          id="first-deadline-value"
                          name="deadline_value"
                          min="1"
                          step="1"
                          value={String(DEFAULT_DEADLINE.value)}
                          aria-label="Deadline value"
                        />
                        <select
                          id="first-deadline-unit"
                          name="deadline_unit"
                          aria-label="Deadline unit"
                        >
                          {DEADLINE_UNITS.map((unit) => (
                            <option value={unit} selected={unit === DEFAULT_DEADLINE.unit}>
                              {unit}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div class="bar">
                      <div class="sp"></div>
                      <button type="submit" class="btn ghost">
                        Assign first assessor
                      </button>
                    </div>
                  </>
                )}
              </form>
            )}

            {nextAssessorPicker && (
              <form
                method="POST"
                action={`/reports/${report.id}/assign-next-assessor`}
                class="card card-b review-form"
              >
                <h3>Assign next assessor</h3>
                {nextAssessorPicker.length === 0 ? (
                  <p class="hint">No eligible Officer is free to take the next assessment.</p>
                ) : (
                  <>
                    <div class="f">
                      <label for="next-comment">
                        {decisions.length > 0
                          ? "Comment — why another assessment is needed"
                          : "Comment (optional)"}
                      </label>
                      <textarea
                        id="next-comment"
                        name="comment"
                        rows="4"
                        class="short"
                        placeholder="What needs to be reassessed."
                      ></textarea>
                    </div>
                    <div class="f">
                      <label for="next-officer">Assign to</label>
                      <select id="next-officer" name="assessor_id" aria-label="Next assessor">
                        {nextAssessorPicker.map((option) => (
                          <option value={option.id} safe>
                            {officerOptionLabel(option)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div class="bar">
                      <div class="sp"></div>
                      <button type="submit" class="btn ghost">
                        Assign next assessor
                      </button>
                    </div>
                  </>
                )}
              </form>
            )}

            {workOfficerPicker && (
              <form
                method="POST"
                action={`/reports/${report.id}/assign-work-officer`}
                class="card card-b review-form"
              >
                <h3>Approve & assign work</h3>
                {workOfficerPicker.length === 0 ? (
                  <p class="hint">No active Officer is available to assign.</p>
                ) : (
                  <>
                    <div class="f">
                      <label for="work-comment">Comment / instruction (optional)</label>
                      <textarea
                        id="work-comment"
                        name="comment"
                        rows="4"
                        class="short"
                        placeholder="Instructions for the officer, if any."
                      ></textarea>
                    </div>
                    <div class="f">
                      <label for="work-officer">Assign to</label>
                      <select id="work-officer" name="officer_id" aria-label="Work officer">
                        {workOfficerPicker.map((option) => (
                          <option value={option.id} safe>
                            {option.fullName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div class="bar">
                      <div class="sp"></div>
                      <button type="submit" class="btn">
                        Approve & assign work
                      </button>
                    </div>
                  </>
                )}
              </form>
            )}
          </div>
        </>
      )}
    </StaffShell>
  );
}
