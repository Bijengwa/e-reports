import type { F004Answers } from "../../../domain/f004.js";
import { STEP_FIELDS, STEPS } from "../../../domain/form-schema.js";
import { type MessageKey, translatorFor } from "../../../i18n/index.js";
import { F004Form } from "./f004.js";
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
   *
   * Naming this is all the page does with it — there is no form here, and no route to post to
   * yet. Picking one is a later slice's work.
   */
  secondAssessorPicker?: AssessorOption[];
};

/** One report, read-only. */
export function ReportPage({
  report,
  viewerRole,
  viewerName,
  canAssess,
  assessor1Name,
  assessor2Name,
  assessment1Review,
  secondAssessorPicker,
}: ReportPageProps): JSX.Element {
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
        </div>
        {canAssess && (
          <a href={assessment1Href(report.id)} class="btn">
            Assessment 1
          </a>
        )}
        <a href="/reports" class="btn ghost">
          ← Back to reports
        </a>
      </div>

      <ReportDocument report={report} />

      {/* Who the report is with, named rather than left to be inferred from the status. A manager
          who has just assigned a second assessor is told here that it took, and everyone else can
          see who holds the report without opening the register. */}
      <div class="card card-b">
        <h2 class="report-heading">Assessors</h2>
        <dl>
          <dt>First assessor</dt>
          <dd safe>{assessor1Name ?? "Not assigned"}</dd>

          <dt>Second assessor</dt>
          <dd safe>{assessor2Name ?? "Not assigned"}</dd>
        </dl>
      </div>

      {assessment1Review && (
        <div class="card card-b">
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
            issues={[]}
          />
        </div>
      )}

      {secondAssessorPicker && (
        <div class="card card-b">
          <h2 class="report-heading">Assign second assessor</h2>
          {secondAssessorPicker.length === 0 ? (
            <p class="hint">No active Officers are available to assign.</p>
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
                Assign
              </button>
            </form>
          )}
        </div>
      )}
    </StaffShell>
  );
}
