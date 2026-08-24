import { SEVERITY_LABELS, severityTone } from "./reports.js";
import { StaffShell } from "./shell.js";

/**
 * The manager's view of the whole pipeline.
 *
 * Six states, named for what is happening rather than for what the status column stores. The tabs
 * are the manager's own vocabulary: a report is not started, or somebody is writing its first
 * assessment, or it is back and needs the next assessor named, or somebody is writing a secondary
 * one, or it is back and needs deciding, or it has gone out for work.
 *
 * The two that matter most are the two that ask something of the reader, and they are deliberately
 * apart. "Assign next assessor" is *name who reads this next*; "Decision" is *approve it and send
 * the work out, or send it round again*. Folded into one tab — as they were — the bar could not
 * tell a manager which of the two moves was being asked of them, and they had to open a report to
 * find out. Closing that is the whole point of this page.
 *
 * Which assessment and which assessor is a column, not a tab. `A2` beside `Josh Edward` says which
 * ordinal a report is on without asking the reader to learn A1/A2/A3 as navigation.
 *
 * Nothing here writes. Every row links to the report, and what a manager may do to it is decided
 * there — a control here would have to repeat those rules.
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

function IconInProgress(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M14.5 7.5l3 3" />
    </svg>
  );
}

/** A handover: one person, and the arrow that passes the work on to the next. */
function IconAssignNext(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="8.5" cy="8" r="3.4" />
      <path d="M2.5 20a6 6 0 0 1 10.2-4.3" />
      <path d="M14 17.5h7" />
      <path d="M18 14.5l3 3-3 3" />
    </svg>
  );
}

/** A second sheet behind the first: the same document, being read again by somebody else. */
function IconSecondary(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 3h6l4 4v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M15 3v5h4" />
      <path d="M5 7v13a1 1 0 0 0 1 1h9" />
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

function IconAssignedForWork(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </svg>
  );
}

/** One state of the pipeline, as the bar draws it and the route filters by it. */
export type Bucket = {
  id: string;
  label: string;
  heading: string;
  state: string;
  /** The sentence under the heading: what this state means, in words a manager already uses. */
  hint: string;
  /** What a row's way in is called — the difference between "name someone" and "decide". */
  action: string;
  statuses: readonly string[];
  Icon: () => JSX.Element;
};

/**
 * The six states a manager reads the pipeline in, in pipeline order.
 *
 * `statuses` is the set each one folds together, and it is the only place that mapping is written
 * — the route filters by it and counts by it, so the tab, the figure and the list cannot come to
 * disagree about what a state contains.
 *
 * Four captions rather than one, because a tab, a heading, a cell and a link are read differently.
 * `label` is what fits in the bar. `heading` is what the page says once a state is chosen, where
 * there is room to name who is being waited on. `state` is what one row says about itself.
 * `action` is what the reader will be doing when they follow the row.
 *
 * One status per state, deliberately, and that is the change that made the page legible: every
 * status the workflow can hold is a state a manager can name, so no tab hides a distinction its
 * reader would have to open a report to discover. `second_assessment` is the one state that spans
 * several ordinals — A2, A3, A4 and every one after — because they are the same fact about the
 * report, and the row's own Assessment column is what tells them apart.
 *
 * `closed` is in no bucket. Nothing in this slice writes it and the MVP has no closing workflow,
 * so a tab for it would be a stage of a pipeline that does not run yet.
 */
export const BUCKETS: readonly Bucket[] = [
  {
    id: "not-started",
    label: "Not started",
    heading: "Not started",
    state: "Not started",
    hint: "Received. The first assessor has not begun.",
    action: "Open",
    statuses: ["received"],
    Icon: IconNotStarted,
  },
  {
    id: "first-assessment",
    label: "First assessment",
    heading: "First assessment",
    state: "First assessment",
    hint: "The first assessor is working on these now.",
    action: "Open",
    statuses: ["first_assessment"],
    Icon: IconInProgress,
  },
  {
    id: "assign-next-assessor",
    label: "Assign next assessor",
    heading: "Waiting on you — assign the next assessor",
    state: "Assign next assessor",
    hint: "The assessment is in. Name the Officer who assesses it next.",
    action: "Assign",
    statuses: ["awaiting_second_assessor"],
    Icon: IconAssignNext,
  },
  {
    id: "secondary-assessment",
    label: "Secondary assessment",
    heading: "Secondary assessment",
    state: "Secondary assessment",
    hint: "A second, third or later assessor is working on these now.",
    action: "Open",
    statuses: ["second_assessment"],
    Icon: IconSecondary,
  },
  {
    id: "decision",
    label: "Decision",
    heading: "Waiting on you — decision",
    state: "Decision",
    hint: "A secondary assessment is in. Approve and assign the work, or send it round again.",
    action: "Decide",
    statuses: ["awaiting_decision"],
    Icon: IconDecision,
  },
  {
    id: "assigned-for-work",
    label: "Assigned for work",
    heading: "Assigned for work",
    state: "Assigned for work",
    hint: "Approved, and with an Officer to carry out.",
    action: "Open",
    statuses: ["assigned_for_work"],
    Icon: IconAssignedForWork,
  },
];

/** Every status some bucket claims — what the unfiltered page shows, and nothing else. */
export const BUCKETED_STATUSES: readonly string[] = BUCKETS.flatMap((bucket) => bucket.statuses);

/** Which state a stored status reads as, or undefined for one no bucket claims. */
export function bucketOfStatus(status: string): Bucket | undefined {
  return BUCKETS.find((bucket) => bucket.statuses.includes(status));
}

/**
 * What the way into one row is called, read from the row's own state.
 *
 * Three words across six states, and which one a row gets is the shortest honest answer to "what
 * will I be doing when I get there": naming the next assessor, deciding, or simply reading. Taken
 * from the bucket rather than from a condition here, so a state added to the table above arrives
 * with its own verb instead of silently falling back to "Open".
 */
function actionOf(status: string): string {
  return bucketOfStatus(status)?.action ?? "Open";
}

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

/**
 * A row of the pipeline.
 *
 * `currentOrdinal`/`currentAssessorName` are the assessment the report is on right now, at
 * whatever ordinal that is — the pair that replaced the old stacked "A1: … / A2: …" cell. They
 * carry the A1/A2/A3 fact the workflow-specific tabs used to carry, as data in the row rather
 * than as navigation the reader has to understand first.
 */
export type WorkloadRow = {
  id: string;
  number: string;
  receivedAt: Date;
  deviceName: string;
  severity: string;
  status: string;
  currentOrdinal: number;
  currentAssessorName: string | null;
};

export type WorkloadPageProps = {
  viewerRole: string;
  /** The signed-in person, for the title bar. */
  viewerName: string;
  /** Every bucket's size, keyed by bucket id. A bucket with nothing in it is absent, not zero. */
  counts: Record<string, number>;
  /** The bucket being shown, or null for all of them. */
  selected: string | null;
  rows: WorkloadRow[];
};

export function WorkloadPage({
  viewerRole,
  viewerName,
  counts,
  selected,
  rows,
}: WorkloadPageProps): JSX.Element {
  const shown = selected === null ? undefined : BUCKETS.find((bucket) => bucket.id === selected);
  const heading = shown?.heading ?? "All reports";

  return (
    <StaffShell
      title="Workload — AE Reports"
      pageTitle="Workload"
      role={viewerRole}
      fullName={viewerName}
      active="workload"
    >
      {/*
       * Links, not buttons, and a filter only — never an action. Filtering is a different view of
       * the same page, so it is a GET with the state in the address, which means a filtered
       * pipeline can be bookmarked, opened in a second tab and reloaded. The chosen tab links back
       * to the unfiltered page, so clicking it twice undoes it.
       */}
      <nav class="wl-tabs" aria-label="Filter by state">
        {BUCKETS.map((bucket) => {
          const on = bucket.id === selected;

          return (
            <a
              href={on ? "/workload" : `/workload?stage=${bucket.id}`}
              class={on ? "on" : ""}
              aria-current={on ? "true" : undefined}
            >
              <bucket.Icon />
              <span>
                <span safe>{bucket.label}</span>{" "}
                <span class="wl-count">{counts[bucket.id] ?? 0}</span>
              </span>
            </a>
          );
        })}
      </nav>

      <div class="staff-head">
        <div class="sp">
          <h2 safe>{heading}</h2>
          {/* What this state means, said in the page rather than left to the tab's one or three
              words. It is the difference between "Assign next assessor" and "Decision" written
              out, for a reader who has arrived at one of them and wants to be sure which. */}
          <p class="hint" safe>
            {shown === undefined
              ? `${rows.length} report${rows.length === 1 ? "" : "s"}, newest first`
              : shown.hint}
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
            : "No reports are in this state right now."}
        </p>
      ) : (
        // Eight columns is wider than a narrow window, so the table scrolls inside its own box
        // rather than pushing the page sideways. See `.tscroll` in the stylesheet.
        <div class="tscroll">
          <table class="utable">
            <thead>
              <tr>
                <th>Number</th>
                <th>Received</th>
                <th>Device</th>
                <th>Severity</th>
                <th>Assessment</th>
                <th>Assessor</th>
                <th>Status</th>
                <th>Action</th>
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
                  {/* The ordinal, as data. This is where A1/A2/A3 lives now it is not a tab. */}
                  <td safe>{`A${row.currentOrdinal}`}</td>
                  {/* An unassigned report says so rather than printing an empty column: null here
                      means intake found no active Officer to give it to, which is a state a
                      manager needs to see, not a blank. */}
                  <td>
                    {row.currentAssessorName === null ? (
                      <span class="hint">Unassigned</span>
                    ) : (
                      <span safe>{row.currentAssessorName}</span>
                    )}
                  </td>
                  <td>
                    <span class="tag muted" safe>
                      {bucketOfStatus(row.status)?.state ?? row.status}
                    </span>
                  </td>
                  {/* One way in, worded for what the reader will be doing when they get there. The
                      decision itself is made on the report, where the rules about who may be named
                      are enforced — not from here, which would have to repeat them. */}
                  <td>
                    <a href={`/reports/${row.id}`} safe>
                      {actionOf(row.status)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </StaffShell>
  );
}
