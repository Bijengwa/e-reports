import type { A2ReviewPayload, F004Answers } from "../../../domain/f004.js";
import { STEP_FIELDS, STEPS } from "../../../domain/form-schema.js";
import { type MessageKey, translatorFor } from "../../../i18n/index.js";
import { F004Form, type SectionComment } from "./f004.js";
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

export const STATUS_LABELS: Record<string, string> = {
  received: "Received",
  first_assessment: "First assessment",
  awaiting_second_assessor: "Awaiting second assessor",
  second_assessment: "Second assessment",
  awaiting_decision: "Awaiting decision",
  closed: "Closed",
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
 * status — those need a decision about who may do them, and this slice does not make it.
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

          {/* Omitted rather than dashed when nobody keyed it in. An empty "Filled by" would be a
              field the reader has to interpret; its absence says the public filed it directly. */}
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

/** One candidate for the second-assessor picker: enough to name them, nothing to act on yet. */
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
 * One component because two pages show it — the manager's own report page and the second
 * assessor's assessment page — and a review that reads differently depending on who opened it is
 * two records pretending to be one. The heading is passed in rather than fixed, because those two
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
   * The same, for the second assessment: true only for the Officer a manager named as second.
   *
   * A separate flag rather than a widened `canAssess`, because the two lead to different pages
   * and the reader who may open one is never the reader who may open the other.
   */
  canAssess2?: boolean;
  /**
   * Whether to offer the manager's review box.
   *
   * True only for a manager, and only over a submitted first assessment. The route behind the box
   * makes the same test — this decides whether the control is drawn, never whether it may be used.
   */
  canComment?: boolean;
  /** A refused action, re-rendered over the page it was refused on. */
  error?: string;
  /** Who holds each half of the review. Null until intake, or a manager, has named them. */
  assessor1Name?: string | null;
  assessor2Name?: string | null;
  /**
   * The first assessment, read-only, for a manager reviewing what the first Officer submitted.
   *
   * Undefined for every other role, and undefined for a manager too until ordinal 1 is actually
   * submitted — a draft in progress is not this page's to show.
   */
  assessment1Review?: Assessment1ReviewProps;
  /**
   * Who a manager could hand the second assessment to. Present only once the report is waiting
   * for one and the first assessment behind it is submitted; undefined otherwise.
   */
  secondAssessorPicker?: AssessorOption[];
  /**
   * Who a manager could hand the report to once both assessments are in.
   *
   * Present only once the report is `awaiting_decision`, on the same argument
   * `secondAssessorPicker` is: the route decides whether the decision belongs on this page, and
   * the page only asks whether the list is here.
   */
  officerPicker?: AssessorOption[];
  /**
   * The second assessment, once it is submitted — never a draft.
   *
   * Present makes the difference between "7.2 is pending" and "here is what the second assessor
   * concluded", and the page must not say the first while the second is true. A draft stays out:
   * it is that Officer's unfinished work, on the same argument ordinal 1 is withheld until it is
   * submitted.
   */
  assessment2Review?: Assessment2ReviewProps;
};

/** The second assessment as a finished record: 7.2, its signature, and the day it was signed. */
export type Assessment2ReviewProps = {
  assessorName: string;
  answers: A2ReviewPayload;
  submittedOn: string;
};

/** One report, read-only. */
export function ReportPage({
  report,
  viewerRole,
  viewerName,
  canAssess,
  canAssess2,
  canComment,
  error,
  assessor1Name,
  assessor2Name,
  assessment1Review,
  secondAssessorPicker,
  officerPicker,
  assessment2Review,
}: ReportPageProps): JSX.Element {
  return (
    <StaffShell
      title={`${report.number} — AE Reports`}
      pageTitle={report.number}
      role={viewerRole}
      fullName={viewerName}
      active="reports"
    >
      {/*
       * The page's own top bar carries the assignment, beside the two actions that were already
       * there. Who holds each half of the review reads on the same line as the rest of the
       * report's facts, because that is where this page has always said what a report is — a card
       * of its own would have been a second place to look for one line of text.
       */}
      <div class="staff-head">
        <div class="sp">
          <h2 safe>{report.deviceName}</h2>
          <p class="hint">
            Received {day(report.receivedAt)} ·{" "}
            <span safe>{caption(CHANNEL_LABELS, report.channel)}</span> ·{" "}
            <span safe>{`A1: ${assessor1Name ?? "not assigned"}`}</span> ·{" "}
            <span safe>{`A2: ${assessor2Name ?? "not assigned"}`}</span>
          </p>
        </div>

        {canAssess && (
          <a href={assessment1Href(report.id)} class="btn">
            Assessment 1
          </a>
        )}
        {canAssess2 && (
          <a href={`/reports/${report.id}/assessment-2`} class="btn">
            Assessment 2
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

      {/*
       * The rest of the page is the manager's work on this report, in the order the process does
       * it: read the first assessment, write a review of it, then hand it to a second Officer.
       * The picker used to sit in the top bar, above the assessment it is a decision about; it is
       * here now so that a manager scrolling down meets the three steps in the order they happen.
       */}
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
            // Not this reader's document to write, whatever its state: the manager reads the
            // finished F004 here and never posts one, so the page carries no form for it.
            readOnly
            // Once 7.2 is actually in, it is rendered below with what the second assessor wrote.
            // Leaving the placeholder here as well would have the page say "pending" directly
            // above the finished thing.
            sectionComments={assessment1Review.sectionComments}
            commentAction={assessment1Review.commentAction}
            omitSecond={assessment2Review !== undefined}
            a2Review={
              assessment2Review && {
                action: `/reports/${report.id}/assessment-2`,
                review: assessment2Review.answers,
                submitted: true,
                assessorName: assessment2Review.assessorName,
                assessedOn: assessment2Review.submittedOn,
              }
            }
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
                  placeholder="What the second assessor should know before starting."
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

      {/* Drawn only when the report is waiting for a second assessor and the first assessment
          behind it is submitted. The route makes the same test for itself, so this decides
          whether the control appears, never whether the assignment may be made. */}
      {secondAssessorPicker && (
        <>
          <h2 class="report-heading">Second assessment</h2>
          {secondAssessorPicker.length === 0 ? (
            <p class="hint">No eligible Officer is free to take the second assessment.</p>
          ) : (
            <form method="POST" action={`/reports/${report.id}/assign-assessor-2`} class="bar">
              <select name="assessor_id" aria-label="Second assessor">
                {secondAssessorPicker.map((option) => (
                  <option value={option.id} safe>
                    {option.fullName}
                  </option>
                ))}
              </select>
              <button type="submit" class="btn">
                Assign second assessor
              </button>
            </form>
          )}
        </>
      )}

      {/* Drawn only once both assessments are in and the report is waiting on the manager. The
          route makes the same test for itself, so this decides whether the decision is offered,
          never whether it may be made. */}
      {officerPicker && (
        <>
          <h2 class="report-heading">Manager decision</h2>
          {officerPicker.length === 0 ? (
            <p class="hint">No active Officer is available to assign.</p>
          ) : (
            <div class="grid2">
              <form
                method="POST"
                action={`/reports/${report.id}/decide/approve`}
                class="card card-b review-form"
              >
                <div class="f">
                  <label for="decision-approve-comment">Comment / instruction (optional)</label>
                  <textarea
                    id="decision-approve-comment"
                    name="comment"
                    rows="4"
                    class="short"
                    placeholder="Instructions for the officer, if any."
                  ></textarea>
                </div>
                <div class="f">
                  <label for="decision-approve-officer">Assign to</label>
                  <select id="decision-approve-officer" name="officer_id" aria-label="Officer">
                    {officerPicker.map((option) => (
                      <option value={option.id} safe>
                        {option.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div class="bar">
                  <div class="sp"></div>
                  <button type="submit" class="btn">
                    Approve &amp; assign for work
                  </button>
                </div>
              </form>

              <form
                method="POST"
                action={`/reports/${report.id}/decide/send-back`}
                class="card card-b review-form"
              >
                <div class="f">
                  <label for="decision-send-back-comment">Comment</label>
                  <textarea
                    id="decision-send-back-comment"
                    name="comment"
                    rows="4"
                    class="short"
                    placeholder="What needs to be reassessed."
                  ></textarea>
                </div>
                <div class="f">
                  <label for="decision-send-back-officer">Assign to</label>
                  <select id="decision-send-back-officer" name="officer_id" aria-label="Officer">
                    {officerPicker.map((option) => (
                      <option value={option.id} safe>
                        {option.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div class="bar">
                  <div class="sp"></div>
                  <button type="submit" class="btn ghost">
                    Send back for re-assessment
                  </button>
                </div>
              </form>
            </div>
          )}
        </>
      )}
    </StaffShell>
  );
}
