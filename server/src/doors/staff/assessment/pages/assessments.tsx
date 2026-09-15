import {
  assessment1Href,
  day,
  SEVERITY_LABELS,
  secondaryAssessmentHref,
  severityTone,
} from "../../../../domain/report-detail.js";
import { Countdown } from "../../assessment/components/countdown.js";
import { StaffShell } from "../../shared/shell.js";

/**
 * The three tab icons, drawn the way the rail draws its own.
 *
 * Same contract as `shell.tsx`'s set and no other: a 24-unit box, no `fill`, and no colour of
 * their own — `stroke: currentcolor` in the stylesheet means each one is painted by whatever the
 * tab's text colour already is, so the active tab's green reaches the icon without a second rule
 * naming it. `aria-hidden` because the label beside it already says the word.
 *
 * Local to this page rather than exported from the shell: those are the rail's, sized and placed
 * by rail rules, and one shared set would have to answer to both.
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

function IconSubmitted(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 4h11l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M15 4v5h5" />
      <path d="M8 14l2.5 2.5L16 11" />
    </svg>
  );
}

/** The three states one assignment can be in, whatever its ordinal. */
export type AssignmentState = "not-started" | "in-progress" | "submitted";

/**
 * One assessment this Officer holds, at whatever ordinal a manager gave them.
 *
 * One row type for the whole page, where there used to be two. The old page listed A1 from
 * `reports` in three state groups and A2..An from `assessments` in a fourth group of its own,
 * which meant "Submitted" silently meant "A1 submitted" and a secondary assessment had no state at
 * all — only its own tab. An assignment is an assignment: `ordinal` says which one it is, `state`
 * says how far along it is, and neither depends on the other.
 */
export type AssignmentRow = {
  reportId: string;
  number: string;
  receivedAt: Date;
  deviceName: string;
  severity: string;
  /** 1 for the first assessment, 2, 3, 4 … for each secondary one. */
  ordinal: number;
  state: AssignmentState;
  dueAt: Date | null;
  /** When this assignment was handed out. Null only for a legacy row from before assignment
   *  metadata was recorded. */
  assignedAt: Date | null;
  /** When this assignment was submitted, or null while it is still outstanding. */
  completedAt: Date | null;
  /**
   * Whether this Officer may still open the report page behind the number.
   *
   * False once the manager has approved and assigned the work: at that point the report page is
   * the settled record of an argument that is over, carrying every assessor's document and the
   * manager's whole decision history, and `caseDetailRoutes` refuses it to an Officer. The number
   * stays on the row and stops being a link, which is the honest rendering of "this is no longer
   * yours to open" — a link that answers 403 would be worse.
   */
  reportOpen: boolean;
};

/** What one row says about itself. The same three words at every ordinal — that is the point. */
const STATE_LABELS: Record<AssignmentState, string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  submitted: "Submitted",
};

/** What the way in is called, which is the one thing that does differ between the three. */
const ACTION_LABELS: Record<AssignmentState, string> = {
  "not-started": "Start",
  "in-progress": "Continue",
  submitted: "View",
};

/**
 * Where this Officer opens their own assessment of a report.
 *
 * Two addresses because they are two different documents — the F004 itself at ordinal 1, and the
 * review of it at every ordinal above — not because the page treats the ordinals differently. The
 * secondary address is one stable link for the whole A2..An chain; the route behind it resolves
 * which ordinal belongs to the reader for itself, so this decides what is drawn and never what may
 * be opened.
 */
function assignmentHref(row: AssignmentRow): string {
  return row.ordinal === 1 ? assessment1Href(row.reportId) : secondaryAssessmentHref(row.reportId);
}

/**
 * One state's worth of the Officer's work.
 *
 * The ordinal is a column, not a heading and not a tab. A1/A2/A3 is still the fact that decides
 * which document opens and still the fact an auditor needs, so it is printed on every row — but a
 * reader who does not know what "secondary assessment" means can still read this table, which is
 * exactly what four workflow-shaped tabs made impossible.
 */
function AssignmentRows({
  rows,
  assessorName,
}: {
  rows: AssignmentRow[];
  assessorName: string;
}): JSX.Element {
  return (
    // Wider than a narrow window once the ordinal and the assessor are on it, so the table scrolls
    // inside its own box rather than pushing the page sideways. See `.tscroll` in the stylesheet.
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
            <th>Assigned</th>
            <th>Deadline</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr>
              <td>
                {row.reportOpen ? (
                  <a href={`/reports/${row.reportId}`} safe>
                    {row.number}
                  </a>
                ) : (
                  <span safe>{row.number}</span>
                )}
              </td>
              <td>{day(row.receivedAt)}</td>
              <td>
                <span class="cap" safe>
                  {row.deviceName}
                </span>
              </td>
              <td>
                <span class={`tag ${severityTone(row.severity) === "caution" ? "warn" : ""}`} safe>
                  {SEVERITY_LABELS[row.severity] ?? row.severity}
                </span>
              </td>
              <td safe>{`A${row.ordinal}`}</td>
              {/* Always the reader, on a page built from one WHERE clause on their own id. Printed
                  anyway: this table is read alongside the manager's, which names somebody else in
                  the same column, and a column that vanishes between two views of the same work is
                  harder to read than one that states the obvious. */}
              <td safe>{assessorName}</td>
              <td>
                <span class="tag muted" safe>
                  {STATE_LABELS[row.state]}
                </span>
              </td>
              <td>{row.assignedAt === null ? "—" : day(row.assignedAt)}</td>
              <td>
                {row.state === "submitted" && row.completedAt !== null ? (
                  <span class="hint" safe>{`Completed: ${day(row.completedAt)}`}</span>
                ) : (
                  <Countdown dueAt={row.dueAt} completed={row.state === "submitted"} />
                )}
              </td>
              <td>
                <a href={assignmentHref(row)} class="btn ghost btn-sm" safe>
                  {ACTION_LABELS[row.state]}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One group of the Officer's work, with the sentence to print when it is empty. */
type Group = {
  /** Anchor the tab links to, and what `:target` matches when it is the chosen one. */
  id: string;
  title: string;
  hint: string;
  empty: string;
  rows: AssignmentRow[];
  /**
   * The group shown when the reader has picked nothing yet.
   *
   * Marked here rather than left to a `:not(:target)` rule, because that rule needs `:has()` to
   * scope it and a browser without `:has()` would then show no group at all. This way the worst
   * case is one group too many, not an empty page.
   */
  initial?: boolean;
};

export type MyAssessmentsPageProps = {
  viewerRole: string;
  viewerName: string;
  /** Assigned and not opened — at any ordinal. */
  notStarted: AssignmentRow[];
  /** Part-written — at any ordinal. */
  inProgress: AssignmentRow[];
  /** Sent on — at any ordinal. */
  submitted: AssignmentRow[];
};

function Section({ group, assessorName }: { group: Group; assessorName: string }): JSX.Element {
  return (
    <div class={group.initial ? "mya mya-default" : "mya"} id={group.id}>
      <h2 safe>{group.title}</h2>
      <p class="hint" safe>
        {group.hint}
      </p>
      {group.rows.length === 0 ? (
        <p class="hint" safe>
          {group.empty}
        </p>
      ) : (
        <AssignmentRows rows={group.rows} assessorName={assessorName} />
      )}
    </div>
  );
}

/**
 * Everything assigned to this Officer, in the three states an assignment can be in.
 *
 * Three groups, not four. The fourth used to be "Secondary assessments", which was a different
 * kind of thing from the other three — they were states, it was a position in the chain — so the
 * bar asked its reader to hold two incompatible ideas at once, and to know what "secondary" meant
 * before they could find a report they had already been told was theirs. An A2 nobody has opened
 * belongs under Not started for the same reason an A1 does: nobody has started it.
 *
 * A submitted assessment stays listed because "I finished that one" is something an assessor needs
 * to be able to check, and a list that dropped work the moment it left their hands would send them
 * hunting through the register for it.
 *
 * Nobody else's work appears, and there is no filter that could show it: the page is built from
 * one WHERE clause on the reader's own id.
 */
export function MyAssessmentsPage({
  viewerRole,
  viewerName,
  notStarted,
  inProgress,
  submitted,
}: MyAssessmentsPageProps): JSX.Element {
  return (
    <StaffShell
      title="My assessments — AE Reports"
      pageTitle="My assessments"
      role={viewerRole}
      fullName={viewerName}
      active="assessments"
      countdown
    >
      {/*
       * "Assigned to you" means work sitting untouched, not work in any of the three states —
       * an assessor already knows about the one they are mid-way through or already sent on, and
       * counting those into this sentence made it read as a to-do count when 0 of them were
       * actually waiting to be started. Absent entirely at zero, for the same reason: a bar
       * announcing "0 assessments assigned to you" reads as a problem needing attention, and the
       * Not started tab immediately below already says so plainly if it is empty.
       */}
      {notStarted.length > 0 && (
        <div class="staff-head">
          <div class="sp">
            <p class="hint">
              {notStarted.length} assessment{notStarted.length === 1 ? "" : "s"} assigned to you
            </p>
          </div>
        </div>
      )}

      {/*
       * Three tabs over one group at a time, not three lists stacked down the page.
       *
       * They are plain links to the group ids, so the hash keeps working — /assessments#submitted
       * opens Submitted, and Back steps between tabs the way it does between anchors. The counts
       * ride on the tabs so the bar answers "is there anything in there" without switching.
       *
       * All three groups are still rendered; CSS shows the chosen one. That is what keeps this a
       * filter rather than three round trips, and what lets the hash select one on arrival.
       */}
      {/* The tabs and the groups share this wrapper because the CSS that picks one has to see
          both: which group is `:target` decides which tab is drawn as chosen. */}
      <div class="mya-wrap">
        <nav class="mya-tabs" aria-label="Filter by state">
          <a href="#not-started" class="on">
            <IconNotStarted />
            <span>
              Not started <span class="mya-count">{notStarted.length}</span>
            </span>
          </a>
          <a href="#in-progress">
            <IconInProgress />
            <span>
              In progress <span class="mya-count">{inProgress.length}</span>
            </span>
          </a>
          <a href="#submitted">
            <IconSubmitted />
            <span>
              Submitted <span class="mya-count">{submitted.length}</span>
            </span>
          </a>
        </nav>

        <Section
          assessorName={viewerName}
          group={{
            id: "not-started",
            title: "Not started",
            hint: "Assigned to you and not opened yet.",
            empty: "Nothing is waiting for you to start.",
            rows: notStarted,
            initial: true,
          }}
        />

        <Section
          assessorName={viewerName}
          group={{
            id: "in-progress",
            title: "In progress",
            hint: "You have saved a draft on these.",
            empty: "No assessment is part-written.",
            rows: inProgress,
          }}
        />

        <Section
          assessorName={viewerName}
          group={{
            id: "submitted",
            title: "Submitted",
            hint: "Sent on. They are read-only to you now.",
            empty: "You have not submitted an assessment yet.",
            rows: submitted,
          }}
        />
      </div>
    </StaffShell>
  );
}
