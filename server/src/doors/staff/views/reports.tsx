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

/** Death and life-threatening are the two an officer should see without reading the row. */
function severityTone(severity: string): string {
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

function day(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

export type ReportsPageProps = {
  reports: ReportRow[];
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
export function ReportsPage({ reports, error, viewerRole }: ReportsPageProps): JSX.Element {
  return (
    <StaffShell title="Reports — AE Reports" pageTitle="Reports" role={viewerRole} active="reports">
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
};

/**
 * A stored answer, flattened to lines a page can print.
 *
 * The payload is whatever the orange form wrote at submission time and is never migrated, so this
 * cannot assume a shape. It walks the value and produces label/value pairs; anything it does not
 * recognise is JSON-stringified rather than dropped, because a report is evidence and a field
 * silently missing from the page is worse than one that reads awkwardly.
 */
function flatten(value: unknown, prefix = ""): Array<[string, string]> {
  if (value === null || value === undefined) return [[prefix, "—"]];

  if (Array.isArray(value)) {
    if (value.length === 0) return [[prefix, "—"]];
    return value.flatMap((item, index) =>
      flatten(item, prefix ? `${prefix} [${index + 1}]` : `[${index + 1}]`),
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return [[prefix, "—"]];
    return entries.flatMap(([key, inner]) => flatten(inner, prefix ? `${prefix} · ${key}` : key));
  }

  return [[prefix, String(value)]];
}

export type ReportPageProps = {
  report: ReportDetail;
  viewerRole: string;
};

/**
 * One report, read-only.
 *
 * Every value is escaped, the payload included. That matters more here than anywhere else in the
 * staff app: this document came from an anonymous public form, so it is the least trusted text in
 * the system, and it is rendered to the people who decide what happens next.
 */
export function ReportPage({ report, viewerRole }: ReportPageProps): JSX.Element {
  const answers = flatten(report.payload);

  return (
    <StaffShell
      title={`${report.number} — AE Reports`}
      pageTitle={report.number}
      role={viewerRole}
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
        <a href="/reports" class="btn ghost">
          Back to reports
        </a>
      </div>

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

          <dt>Form</dt>
          <dd safe>{report.formVersion}</dd>
        </dl>
      </div>

      <h2 class="report-heading">Submitted answers</h2>

      <table class="utable">
        <thead>
          <tr>
            <th>Field</th>
            <th>Answer</th>
          </tr>
        </thead>
        <tbody>
          {answers.map(([label, value]) => (
            <tr>
              <td safe>{label}</td>
              <td safe>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </StaffShell>
  );
}
