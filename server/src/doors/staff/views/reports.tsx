import type { F004Answers, SecondaryReviewPayload } from "../../../domain/f004.js";
import { STEP_FIELDS, STEPS } from "../../../domain/form-schema.js";
import { type MessageKey, translatorFor } from "../../../i18n/index.js";
import { F004Form, type PriorSecondaryReview, type SectionComment } from "./f004.js";
import { StaffShell } from "./shell.js";

/**
 * Captions for the three enums a report carries.
 *
 * Same argument as `ROLE_LABELS`: the stored value is the fact and these are the words. Written
 * together with the values they caption so an enum member cannot arrive with no caption — the
 * fallback prints the raw value, which makes that visible rather than blank.
 */
export const CHANNEL_LABELS: Record<string, string> = {
  online_form: "Online form",
  email: "Email",
  hard_copy: "Hard copy",
};

export const SEVERITY_LABELS: Record<string, string> = {
  death: "Death",
  life_threatening: "Life-threatening",
  hospitalization: "Hospitalization",
  other: "Other",
};

/**
 * `awaiting_second_assessor` and `second_assessment` are reused for every secondary-assessment
 * cycle now, not only the second — the captions say "next"/"a secondary assessor" rather than
 * "second" so the wording stays true once a report reaches A3 or A4. The stored enum values are
 * unchanged; see `db/schema/index.ts`.
 */
export const STATUS_LABELS: Record<string, string> = {
  received: "Received",
  first_assessment: "First assessment",
  awaiting_second_assessor: "Awaiting next assessor",
  second_assessment: "Secondary assessment in progress",
  awaiting_decision: "Awaiting manager decision",
  closed: "Closed",
  assigned_for_work: "Assigned for work",
};

function caption(labels: Record<string, string>, value: string): string {
  return labels[value] ?? value;
}

/**
 * Death and life-threatening are the two an officer should see without reading the row.
 *
 * Exported on the same argument as `SEVERITY_LABELS` beside it: two rows tagging the same
 * severity a different colour is how a queue starts contradicting the register it is drawn from.
 */
export function severityTone(severity: string): string {
  return severity === "death" || severity === "life_threatening" ? "caution" : "safe";
}

/** A row of the register, as the list needs it. `payload` is deliberately not among these. */
export type ReportRow = {
  id: string;
  number: string;
  receivedAt: Date;
  deviceName: string;
  severity: string;
  status: string;
  channel: string;
  facility: string | null;
};

/** Exported for the same reason `severityTone` is: one date format for every queue in the app. */
export function day(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * A report as a short list needs it: what it is, when it landed, and how badly it went.
 *
 * Narrower than `ReportRow` on purpose, and the query behind it selects exactly these. Status is
 * the same word on every row of a queue built by filtering on status, and channel and facility are
 * what the register is for.
 */
export type ReceivedRow = Pick<
  ReportRow,
  "id" | "number" | "receivedAt" | "deviceName" | "severity"
> & {
  /**
   * Whether this report is the reader's own to assess.
   *
   * The queue also carries orphans — reports filed while no assessor was active — and those are
   * nobody's until something assigns them. Only a row already yours offers the way in.
   */
  mine: boolean;
};

/** Where an Officer opens the first assessment of a report that is theirs. */
export function assessment1Href(reportId: string): string {
  return `/reports/${reportId}/assessment-1`;
}

/** Where an Officer opens their own secondary assessment of a report, whatever ordinal it is. */
export function secondaryAssessmentHref(reportId: string): string {
  return `/reports/${reportId}/secondary-assessment`;
}

/**
 * A short list of reports, rendered the way the register renders them.
 *
 * Exported so the dashboard prints the number, the date and the severity tag through this code
 * rather than its own. Two pages captioning the same enum separately is how one of them ends up
 * printing `life_threatening` — the argument `ROLE_LABELS` makes, one level up.
 */
export function ReceivedRows({ reports }: { reports: ReceivedRow[] }): JSX.Element {
  return (
    <table class="utable">
      <thead>
        <tr>
          <th>Number</th>
          <th>Received</th>
          <th>Device</th>
          <th>Severity</th>
          <th>Assessment</th>
        </tr>
      </thead>
      <tbody>
        {reports.map((report) => (
          <tr>
            <td>
              <a href={`/reports/${report.id}`} safe>
                {report.number}
              </a>
            </td>
            <td>{day(report.receivedAt)}</td>
            <td safe>{report.deviceName}</td>
            <td>
              <span class={`tag ${severityTone(report.severity) === "caution" ? "warn" : ""}`}>
                {caption(SEVERITY_LABELS, report.severity)}
              </span>
            </td>
            {/* An orphan is waiting for somebody to be given it; until then there is nothing to
                open, and a link that answered 403 would be worse than no link. */}
            <td>
              {report.mine ? (
                <a href={assessment1Href(report.id)}>Assessment 1</a>
              ) : (
                <span class="hint">Unassigned</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export type ReportsPageProps = {
  reports: ReportRow[];
  /** The signed-in person, for the title bar. */
  viewerName: string;
  /** A stale or malformed link, reported over the register it failed to reach. */
  error?: string;
  viewerRole: string;
};

/**
 * The register, read-only.
 *
 * Every signed-in role sees the same rows. Nothing here assigns, opens an assessment or changes a
 * status — those need a decision about who may do them, and this slice does not make one.
 */
export function ReportsPage({
  reports,
  error,
  viewerRole,
  viewerName,
}: ReportsPageProps): JSX.Element {
  return (
    <StaffShell
      title="Reports — AE Reports"
      pageTitle="Reports"
      role={viewerRole}
      fullName={viewerName}
      active="reports"
    >
      <div class="staff-head">
        <div class="sp">
          <p class="hint">
            {reports.length} report{reports.length === 1 ? "" : "s"}, newest first
          </p>
        </div>
      </div>

      {error && (
        <div class="alert alert-error" safe>
          {error}
        </div>
      )}

      {reports.length === 0 ? (
        <p class="hint">Nothing has been reported yet.</p>
      ) : (
        <table class="utable">
          <thead>
            <tr>
              <th>Number</th>
              <th>Received</th>
              <th>Device</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Channel</th>
              <th>Facility</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr>
                <td>
                  <a href={`/reports/${report.id}`} safe>
                    {report.number}
                  </a>
                </td>
                <td>{day(report.receivedAt)}</td>
                <td safe>{report.deviceName}</td>
                <td>
                  <span class={`tag ${severityTone(report.severity) === "caution" ? "warn" : ""}`}>
                    {caption(SEVERITY_LABELS, report.severity)}
                  </span>
                </td>
                <td safe>{caption(STATUS_LABELS, report.status)}</td>
                <td safe>{caption(CHANNEL_LABELS, report.channel)}</td>
                <td safe>{report.facility ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </StaffShell>
  );
}

/** One report in full: the columns above, plus the document the reporter actually submitted. */
export type ReportDetail = ReportRow & {
  reporterName: string | null;
  formVersion: string;
  /** The immutable submission snapshot. Rendered as text, never interpreted. */
  payload: unknown;
  /**
   * The staff member who keyed it in, or null when the public filed it themselves.
   *
   * Who typed it, not who is handling it. Nothing is assigned yet and this line must not be read
   * as saying otherwise — which is why it reads "Filled by" and appears only when somebody did.
   */
  filledBy: string | null;
};

/**
 * The staff app reads English, whatever the reporter filled the form in.
 *
 * The payload stores field names, not captions, so the language of the page is a choice made here
 * rather than one baked into the document. Staff pages are English throughout.
 */
const t = translatorFor("en");

/** One answer as the page shows it. An empty string stays empty: absent is not the same as "no". */
type Answer = { label: string; value: string };

/**
 * A submitted value as text.
 *
 * A checkbox group arrives as an array and is joined; anything else is stringified. Objects are
 * JSON rather than "[object Object]" — the orange form does not nest today, and if it ever does,
 * an ugly line is recoverable evidence where a blank one is lost evidence.
 */
function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export type ReportSection = { title: string; answers: Answer[] };

/**
 * The document, grouped the way it was filled in.
 *
 * The groups and their order are the orange form's five steps, and every caption is the form's own
 * label — both read from `form-schema` and the message table rather than restated here, so the
 * page a reviewer reads matches the paper form they are checking it against. Nothing is invented:
 * a field the payload does not carry is not shown, and one it carries empty is shown empty.
 *
 * Keys the schema does not know about are collected at the end rather than dropped. A report is
 * evidence; a field silently missing from the page is worse than one with an unlovely name.
 */
export function sectionsOf(payload: unknown): ReportSection[] {
  const answers = (payload ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const sections: ReportSection[] = [];

  for (const step of STEPS) {
    const rows: Answer[] = [];

    for (const field of STEP_FIELDS[step]) {
      if (!(field in answers)) continue;
      seen.add(field);
      rows.push({ label: t(`f.${field}` as MessageKey), value: asText(answers[field]) });
    }

    if (rows.length > 0) sections.push({ title: t(`step.${step}` as MessageKey), answers: rows });
  }

  const rest = Object.keys(answers).filter((key) => !seen.has(key));
  if (rest.length > 0) {
    sections.push({
      title: "Other answers",
      answers: rest.map((key) => ({ label: key, value: asText(answers[key]) })),
    });
  }

  return sections;
}

/**
 * The report itself: the facts that were normalised out of it, then the document as submitted.
 *
 * Exported because the first assessment is read against this and must be reading the same thing.
 * An assessor comparing a form to a summary rendered by different code is exactly the drift that
 * makes two pages disagree about one report.
 *
 * Every value is escaped, the payload included. That matters more here than anywhere else in the
 * staff app: this document came from an anonymous public form, so it is the least trusted text in
 * the system, and it is rendered to the people who decide what happens next.
 */
export function ReportDocument({ report }: { report: ReportDetail }): JSX.Element {
  const sections = sectionsOf(report.payload);

  return (
    <>
      <div class="card card-b report-facts">
        <dl>
          <dt>Severity</dt>
          <dd safe>{caption(SEVERITY_LABELS, report.severity)}</dd>

          <dt>Status</dt>
          <dd safe>{caption(STATUS_LABELS, report.status)}</dd>

          <dt>Facility</dt>
          <dd safe>{report.facility ?? "—"}</dd>

          <dt>Reporter</dt>
          <dd safe>{report.reporterName ?? "—"}</dd>

          {report.filledBy !== null && (
            <>
              <dt>Filled by</dt>
              <dd safe>{report.filledBy}</dd>
            </>
          )}

          <dt>Form</dt>
          <dd safe>{report.formVersion}</dd>
        </dl>
      </div>

      <h2 class="report-heading">Submitted answers</h2>

      {sections.length === 0 ? (
        <p class="hint">This report carries no submitted answers.</p>
      ) : (
        sections.map((section) => (
          <div class="report-group">
            <h3 safe>{section.title}</h3>
            <dl>
              {section.answers.map((answer) => (
                <>
                  <dt safe>{answer.label}</dt>
                  <dd safe>{answer.value}</dd>
                </>
              ))}
            </dl>
          </div>
        ))
      )}
    </>
  );
}

/** One candidate for a next-assessor or work-officer picker: enough to name them. */
export type AssessorOption = { id: string; fullName: string };

/**
 * A manager's review of one assessment, as a page prints it.
 *
 * The reviewer's name and the day, never their id: who reviewed an assessment is a fact the page
 * states, and the row's own key is not the reader's business.
 */
export type ManagerReviewNote = { text: string; byName: string; on: string };

/**
 * A saved manager review, wherever it is read.
 *
 * One component because two pages show it — the manager's own report page and a secondary
 * assessor's own assessment page — and a review that reads differently depending on who opened it
 * is two records pretending to be one. The heading is passed in rather than fixed, because those
 * readers need to be told different things about the same text: whose it is, or which assessment
 * it is about.
 */
export function ManagerReviewBlock({
  review,
  heading,
}: {
  review: ManagerReviewNote;
  heading: string;
}): JSX.Element {
  return (
    <>
      <h2 class="report-heading" safe>
        {heading}
      </h2>
      <div class="review">
        <p class="hint">
          <span safe>{review.byName}</span> · <span safe>{review.on}</span>
        </p>
        <p class="review-text" safe>
          {review.text}
        </p>
      </div>
    </>
  );
}

/**
 * The first assessment, as the manager's copy of this page reads it: the F004's own answers,
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

/** One finished secondary assessment, as the manager's consolidated view and the history strip
 *  both read it. */
export type SecondaryAssignment = {
  ordinal: number;
  assessorId: string;
  assessorName: string;
  submitted: boolean;
  submittedOn: string | null;
  answers: SecondaryReviewPayload;
};

/** One manager decision, as the decision-history block prints it. */
export type DecisionEntry = {
  kind: "assign_next_assessor" | "assign_work_officer";
  comment: string | null;
  decidedByName: string;
  decidedAt: string;
  reviewedThroughOrdinal: number;
  nextAssessorName: string | null;
  nextOrdinal: number | null;
  workOfficerName: string | null;
};

export type ReportPageProps = {
  report: ReportDetail;
  viewerRole: string;
  /** The signed-in person, for the title bar. */
  viewerName: string;
  /**
   * Whether this report is the reader's own first assessment to make.
   *
   * True only for the Officer it is assigned to. A manager, an administrator, another Officer and
   * the Officer looking at an orphan all get the page without the way in, because the route
   * behind that link would refuse them and a link that answers 403 is worse than no link.
   */
  canAssess: boolean;
  /**
   * Which ordinal, if any, is this reader's own secondary assessment on this report — null for
   * every reader who holds none. One flag rather than a fixed `canAssess2`, because the reader who
   * may open a secondary assessment is whichever Officer an `assessments` row names, at whatever
   * ordinal that happens to be.
   */
  mySecondaryOrdinal: number | null;
  /**
   * Whether to offer the manager's review box on the first assessment.
   *
   * True only for a manager, and only over a submitted first assessment. The route behind the box
   * makes the same test — this decides whether the control is drawn, never whether it may be used.
   */
  canComment?: boolean;
  /** A refused action, re-rendered over the page it was refused on. */
  error?: string;
  /** Who holds the first assessment. Null until intake has named them. */
  assessor1Name?: string | null;
  /**
   * The first assessment, read-only, for a manager reviewing what the first Officer submitted.
   *
   * Undefined for every other role, and undefined for a manager too until ordinal 1 is actually
   * submitted — a draft in progress is not this page's to show.
   */
  assessment1Review?: Assessment1ReviewProps;
  /** Every submitted secondary assessment, oldest first — the manager's accumulated picture. */
  secondaryAssessments: SecondaryAssignment[];
  /**
   * Who a manager could hand the next secondary assessment to. Present only once the report is
   * waiting for one; undefined otherwise.
   */
  nextAssessorPicker?: AssessorOption[];
  /**
   * Who a manager could hand the report to for work once satisfied. Present only at
   * `awaiting_decision`; undefined otherwise.
   */
  workOfficerPicker?: AssessorOption[];
  /** Every manager decision recorded on this report, oldest first. */
  decisions: DecisionEntry[];
};

/**
 * A compact, orientation-only strip of every assessment this report has had — who, and whether
 * they have finished. Not a tab bar and not a navigation control: it exists so a reader can tell
 * at a glance how far the report has travelled without opening five separate documents.
 */
function AssessmentHistory({
  assessor1Name,
  secondaryAssessments,
  mySecondaryOrdinal,
}: {
  assessor1Name?: string | null;
  secondaryAssessments: SecondaryAssignment[];
  mySecondaryOrdinal: number | null;
}): JSX.Element {
  return (
    <ol class="assessment-history">
      <li>
        <span class="a-hist-no">A1</span>
        <span safe>{assessor1Name ?? "Not assigned"}</span>
        {assessor1Name !== null && assessor1Name !== undefined && (
          <span class="a-hist-done">✓</span>
        )}
      </li>
      {secondaryAssessments.map((a) => (
        <li>
          <span class="a-hist-no" safe>{`A${a.ordinal}`}</span>
          <span safe>{a.assessorName}</span>
          {a.submitted ? (
            <span class="a-hist-done">✓</span>
          ) : a.ordinal === mySecondaryOrdinal ? (
            <span class="a-hist-current">→ Current</span>
          ) : (
            <span class="hint">In progress</span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** The manager's decision history: who decided, when, and what, oldest first. */
function DecisionHistory({ decisions }: { decisions: DecisionEntry[] }): JSX.Element {
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

/** One report, read-only except for the manager's decision controls. */
export function ReportPage({
  report,
  viewerRole,
  viewerName,
  canAssess,
  mySecondaryOrdinal,
  canComment,
  error,
  assessor1Name,
  assessment1Review,
  secondaryAssessments,
  nextAssessorPicker,
  workOfficerPicker,
  decisions,
}: ReportPageProps): JSX.Element {
  // The history strip carries every secondary assessment, including one just assigned and not yet
  // written — that is what tells a reader the report is with somebody right now. The document
  // below carries only the submitted ones: an empty draft has no findings to render.
  const submitted = secondaryAssessments.filter((a) => a.submitted);

  // The most recently submitted secondary review, if any — the one every reader most wants to see
  // first. Everything before it renders as history; this one and the rest are read the same way,
  // just in a different slot of `F004Form`'s props (see the comment on `priorReviews` there).
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
      active="reports"
    >
      <div class="staff-head">
        <div class="sp">
          <h2 safe>{report.deviceName}</h2>
          <p class="hint">
            Received {day(report.receivedAt)} ·{" "}
            <span safe>{caption(CHANNEL_LABELS, report.channel)}</span>
          </p>
          <AssessmentHistory
            assessor1Name={assessor1Name}
            secondaryAssessments={secondaryAssessments}
            mySecondaryOrdinal={mySecondaryOrdinal}
          />
        </div>

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
        <a href="/reports" class="btn ghost">
          ← Back to reports
        </a>
      </div>

      {error && (
        <div class="alert alert-error" role="alert" safe>
          {error}
        </div>
      )}

      <ReportDocument report={report} />

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
            omitSecond={submitted.length > 0}
            // The most recently submitted secondary review is shown through the same slot the
            // active-review UI would use, so its option badges render inline exactly as they do
            // on the reviewer's own page. Everything earlier is `priorReviews` — collapsed
            // history, the same mechanism a later reviewer's own working page uses.
            a2Review={
              latest && {
                action: secondaryAssessmentHref(report.id),
                review: latest.answers,
                submitted: true,
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

      {(nextAssessorPicker || workOfficerPicker) && (
        <>
          <h2 class="report-heading">Manager decision</h2>
          <div class="grid2">
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
                            {option.fullName}
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
                <h3>Assign work officer</h3>
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
                        Assign work officer
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
