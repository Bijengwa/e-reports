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

/**
 * The six tab icons, drawn to the same contract as the rail's and the Officer's own tabs.
 *
 * A 24-unit box, no `fill`, and no colour of their own: `stroke: currentcolor` in the stylesheet
 * means the active tab's green reaches the icon through the rule that already paints its label.
 * `aria-hidden` because the label beside each one says the word.
 */
function IconNotStarted(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function IconFirstAssessment(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M14.5 7.5l3 3" />
    </svg>
  );
}

function IconAssignA2(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.6 20a6.4 6.4 0 0 1 12.8 0" />
      <path d="M17.5 8.5h5" />
      <path d="M20 6v5" />
    </svg>
  );
}

function IconSecondAssessment(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="11" cy="11" r="6" />
      <path d="M15.5 15.5L21 21" />
    </svg>
  );
}

function IconDecision(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5v14" />
      <path d="M7 19h10" />
      <path d="M3.5 8.5h17" />
      <path d="M6.5 8.5l-2.5 5a2.7 2.7 0 0 0 5 0z" />
      <path d="M17.5 8.5l-2.5 5a2.7 2.7 0 0 0 5 0z" />
    </svg>
  );
}

function IconClosed(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </svg>
  );
}

/**
 * The six, in pipeline order. The captions are the manager's words, not the enum's.
 *
 * Two of them, because a tab and a heading are read differently. `label` is what fits in a bar of
 * six — short enough that the row stays one line and the eye can sweep it. `heading` is what the
 * page says once a bucket is chosen and there is room to name who is being waited on, which is the
 * part a manager acts upon and the part a bare "Decision" would drop.
 */
export const BUCKETS: readonly {
  status: string;
  label: string;
  heading: string;
  Icon: () => JSX.Element;
}[] = [
  { status: "received", label: "Not started", heading: "Not started", Icon: IconNotStarted },
  {
    status: "first_assessment",
    label: "First assessment",
    heading: "In progress — first assessment",
    Icon: IconFirstAssessment,
  },
  {
    status: "awaiting_second_assessor",
    label: "Assign assessor",
    heading: "Waiting on you — assign the next assessor",
    Icon: IconAssignA2,
  },
  {
    status: "second_assessment",
    label: "Secondary assessment",
    heading: "In progress — secondary assessment",
    Icon: IconSecondAssessment,
  },
  {
    status: "awaiting_decision",
    label: "Decision",
    heading: "Waiting on you — decision",
    Icon: IconDecision,
  },
  {
    status: "assigned_for_work",
    label: "Assigned for work",
    heading: "Assigned for work",
    Icon: IconClosed,
  },
  { status: "closed", label: "Closed", heading: "Closed", Icon: IconClosed },
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

/** A row of the pipeline. `latestSecondaryName`/`secondaryCount` summarise however many secondary
 *  assessments the report has had, rather than naming a fixed second assessor. */
export type WorkloadRow = {
  id: string;
  number: string;
  receivedAt: Date;
  deviceName: string;
  severity: string;
  status: string;
  assessor1Name: string | null;
  latestSecondaryName: string | null;
  secondaryCount: number;
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
      {row.secondaryCount > 0 ? (
        <>
          <br />
          <span safe>
            {row.secondaryCount === 1
              ? `A2: ${row.latestSecondaryName ?? "—"}`
              : `A${row.secondaryCount + 1}: ${row.latestSecondaryName ?? "—"} (${row.secondaryCount} so far)`}
          </span>
        </>
      ) : (
        // The way into the one thing this bucket is waiting on the manager for. It is a link to
        // the report, where the picker lives and where the rules about who may be named are
        // enforced — not a control that assigns from here, which would have to repeat them.
        row.status === "awaiting_second_assessor" && (
          <>
            <br />
            <a href={`/reports/${row.id}`}>Assign next assessor</a>
          </>
        )
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
    selected === null ? "All reports" : (shown?.heading ?? STATUS_LABELS[selected] ?? selected);

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
      <nav class="wl-tabs" aria-label="Filter by stage">
        {BUCKETS.map((bucket) => {
          const on = bucket.status === selected;

          return (
            <a
              href={on ? "/workload" : `/workload?status=${bucket.status}`}
              class={on ? "on" : ""}
              aria-current={on ? "true" : undefined}
            >
              <bucket.Icon />
              <span>
                <span safe>{bucket.label}</span>{" "}
                <span class="wl-count">{counts[bucket.status] ?? 0}</span>
              </span>
            </a>
          );
        })}
      </nav>

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
