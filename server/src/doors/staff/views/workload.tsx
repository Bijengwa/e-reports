import { SEVERITY_LABELS, STATUS_LABELS, severityTone } from "./reports.js";
import { StaffShell } from "./shell.js";

/**
 * The manager's view of the whole pipeline.
 *
 * Six buckets, one per status, and the register underneath filtered to whichever is chosen. The
 * dashboard this replaces showed a manager one queue — the reports waiting on them to name a
 * second assessor — which is the third of these six and told them nothing about the other five.
 *
 * Nothing here writes. The rows carry no action button: what a manager may do to a report is
 * decided on the report's own page, and a control here would have to repeat those rules.
 */

/** The six, in pipeline order. The captions are the manager's words, not the enum's. */
export const BUCKETS: readonly { status: string; label: string; icon: string }[] = [
  { status: "received", label: "Not started", icon: "📋" },
  { status: "first_assessment", label: "In progress — first assessment", icon: "✍️" },
  { status: "awaiting_second_assessor", label: "Waiting on you — assign A2", icon: "👥" },
  { status: "second_assessment", label: "In progress — second assessment", icon: "🔍" },
  { status: "awaiting_decision", label: "Waiting on you — decision", icon: "⚖️" },
  { status: "closed", label: "Closed", icon: "✅" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `19 Aug 2026`, written out rather than left as an ISO date.
 *
 * The register prints `YYYY-MM-DD` because it is a dense list read by column. This page is read
 * across the row — device, people, status — and a written month is what stops `2026-08-19` and
 * `2026-09-18` looking alike at a glance.
 */
function day(value: Date): string {
  const at = new Date(value);
  return `${String(at.getUTCDate()).padStart(2, "0")} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/** A row of the pipeline, with both assessors resolved to names rather than ids. */
export type WorkloadRow = {
  id: string;
  number: string;
  receivedAt: Date;
  deviceName: string;
  severity: string;
  status: string;
  assessor1Name: string | null;
  assessor2Name: string | null;
};

export type WorkloadPageProps = {
  viewerRole: string;
  /** The signed-in person, for the title bar. */
  viewerName: string;
  /** Every bucket's size, keyed by status. A bucket with nothing in it is absent, not zero. */
  counts: Record<string, number>;
  /** The status being shown, or null for all of them. */
  selected: string | null;
  rows: WorkloadRow[];
};

/**
 * Who a report is with, as one cell.
 *
 * An unassigned report says so rather than printing an empty column: null here means intake found
 * no active Officer to give it to, which is a state a manager needs to see, not a blank.
 */
function Assessors({ row }: { row: WorkloadRow }): JSX.Element {
  if (row.assessor1Name === null) return <span class="hint">Unassigned</span>;

  return (
    <>
      <span safe>{`A1: ${row.assessor1Name}`}</span>
      {row.assessor2Name !== null && (
        <>
          <br />
          <span safe>{`A2: ${row.assessor2Name}`}</span>
        </>
      )}
    </>
  );
}

export function WorkloadPage({
  viewerRole,
  viewerName,
  counts,
  selected,
  rows,
}: WorkloadPageProps): JSX.Element {
  const shown = selected === null ? undefined : BUCKETS.find((b) => b.status === selected);

  // Filtering is validated against the schema enum, which may one day carry a status this page
  // draws no card for. Falling back to "All reports" there would head a filtered list with the
  // one caption that is certainly wrong, so the status' own label answers instead.
  const heading =
    selected === null ? "All reports" : (shown?.label ?? STATUS_LABELS[selected] ?? selected);

  return (
    <StaffShell
      title="Workload — AE Reports"
      pageTitle="Workload"
      role={viewerRole}
      fullName={viewerName}
      active="workload"
    >
      {/*
       * Links, not buttons. Filtering is a different view of the same page, so it is a GET with the
       * status in the address — which means a filtered pipeline can be bookmarked, opened in a
       * second tab and reloaded, none of which a scripted filter would give. The chosen card links
       * back to the unfiltered page, so clicking it twice undoes it.
       */}
      <div class="stats stats-pick">
        {BUCKETS.map((bucket) => {
          const on = bucket.status === selected;

          return (
            <a
              href={on ? "/workload" : `/workload?status=${bucket.status}`}
              class={on ? "stat stat-pick on" : "stat stat-pick"}
              aria-current={on ? "true" : undefined}
            >
              <span class="stat-icon" aria-hidden="true" safe>
                {bucket.icon}
              </span>
              <span class="eyebrow" safe>
                {bucket.label}
              </span>
              <b>{counts[bucket.status] ?? 0}</b>
            </a>
          );
        })}
      </div>

      <div class="staff-head">
        <div class="sp">
          <h2 safe>{heading}</h2>
          <p class="hint">
            {rows.length} report{rows.length === 1 ? "" : "s"}, newest first
          </p>
        </div>
        {/* Only when there is something to clear, so the page does not carry a control that would
            take the reader where they already are. */}
        {selected !== null && (
          <a href="/workload" class="btn ghost">
            Show all
          </a>
        )}
      </div>

      {/* No header over an empty body: that reads as a list that failed to load rather than a
          bucket that is genuinely clear — the argument the dashboard's queue already made. */}
      {rows.length === 0 ? (
        <p class="hint">
          {selected === null
            ? "Nothing has been reported yet."
            : "No reports are in this stage right now."}
        </p>
      ) : (
        <table class="utable">
          <thead>
            <tr>
              <th>Number</th>
              <th>Received</th>
              <th>Device</th>
              <th>Severity</th>
              <th>Assessors</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr>
                <td>
                  <a href={`/reports/${row.id}`} safe>
                    {row.number}
                  </a>
                </td>
                <td>{day(row.receivedAt)}</td>
                <td safe>{row.deviceName}</td>
                <td>
                  <span
                    class={`tag ${severityTone(row.severity) === "caution" ? "warn" : ""}`}
                    safe
                  >
                    {SEVERITY_LABELS[row.severity] ?? row.severity}
                  </span>
                </td>
                <td>
                  <Assessors row={row} />
                </td>
                <td>
                  <span class="tag muted" safe>
                    {STATUS_LABELS[row.status] ?? row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </StaffShell>
  );
}
