/**
 * Presentation pieces shared by every reader of a report/case record: the dashboard's short
 * queue, and the Orange Report's submitted answers as the assessment workflow, My work and the
 * Register's case-detail page all render them.
 */
import { STEP_FIELDS, STEPS } from "../../../../domain/form-schema.js";
import {
  assessment1Href,
  caption,
  day,
  type ManagerReviewNote,
  type ReceivedRow,
  type ReportDetail,
  SEVERITY_LABELS,
  STATUS_LABELS,
  severityTone,
} from "../../../../domain/report-detail.js";
import { type MessageKey, translatorFor } from "../../../../i18n/index.js";

/**
 * A short list of reports, rendered the way the register renders them.
 *
 * Exported so the dashboard prints the number, the date and the severity tag through the same
 * code the register's own list uses — two pages captioning the same enum separately is how one of
 * them ends up printing `life_threatening`.
 */
export function ReceivedRows({ reports }: { reports: ReceivedRow[] }): JSX.Element {
  return (
    <div class="tscroll">
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
              {/* An orphan's number is not a link: nobody has been given it yet, so a case page
                  is not this reader's to open. */}
              <td>
                {report.mine ? (
                  <a href={`/register/${report.id}`} safe>
                    {report.number}
                  </a>
                ) : (
                  <span safe>{report.number}</span>
                )}
              </td>
              <td>{day(report.receivedAt)}</td>
              <td>
                <span class="cap" safe>
                  {report.deviceName}
                </span>
              </td>
              <td>
                <span class={`tag ${severityTone(report.severity) === "caution" ? "warn" : ""}`}>
                  {caption(SEVERITY_LABELS, report.severity)}
                </span>
              </td>
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
    </div>
  );
}

/** The staff app reads English, whatever the reporter filled the form in. */
const t = translatorFor("en");

type Answer = { label: string; value: string };

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
 * page a reviewer reads matches the paper form they are checking it against.
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
 * Every value is escaped, the payload included — this document came from an anonymous public form.
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

/**
 * A saved manager review, wherever it is read.
 *
 * One component because two pages show it — the manager's own case-detail page and a secondary
 * assessor's own assessment page — and a review that reads differently depending on who opened it
 * is two records pretending to be one.
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
