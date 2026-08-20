import {
  day,
  type ReceivedRow,
  ReceivedRows,
  SEVERITY_LABELS,
  STATUS_LABELS,
  severityTone,
} from "./reports.js";
import { StaffShell } from "./shell.js";

/**
 * A report this Officer holds as second assessor.
 *
 * Narrower than `ReceivedRow`: no `mine`, because that flag decides whether to offer the first
 * assessment's page and this is not the Officer who writes that one. It carries `status` instead,
 * which is what says how far the report has travelled since it was handed over.
 */
export type SecondAssessmentRow = {
  id: string;
  number: string;
  receivedAt: Date;
  deviceName: string;
  severity: string;
  status: string;
};

/**
 * The second assessor's work, listed but not yet openable as a form.
 *
 * Every row opens the report itself. Writing a second assessment is a page that does not exist
 * yet, and a link to one would answer 404 — so this lists what has been handed to the Officer and
 * says plainly that the form is still to come, rather than implying an action it cannot offer.
 */
function SecondAssessmentRows({ reports }: { reports: SecondAssessmentRow[] }): JSX.Element {
  return (
    <table class="utable">
      <thead>
        <tr>
          <th>Number</th>
          <th>Received</th>
          <th>Device</th>
          <th>Severity</th>
          <th>Status</th>
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
              <span class={`tag ${severityTone(report.severity) === "caution" ? "warn" : ""}`} safe>
                {SEVERITY_LABELS[report.severity] ?? report.severity}
              </span>
            </td>
            <td>
              <span class="tag muted" safe>
                {STATUS_LABELS[report.status] ?? report.status}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One group of the Officer's work, with the sentence to print when it is empty. */
type Group = {
  /** Anchor the tab links to, and what `:target` matches when it is the chosen one. */
  id: string;
  title: string;
  hint: string;
  empty: string;
  rows: ReceivedRow[];
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
  notStarted: ReceivedRow[];
  inProgress: ReceivedRow[];
  submitted: ReceivedRow[];
  /** Reports a manager has handed to this Officer as second assessor. */
  secondAssessment: SecondAssessmentRow[];
};

function Section({ group }: { group: Group }): JSX.Element {
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
        <ReceivedRows reports={group.rows} />
      )}
    </div>
  );
}

/**
 * Everything assigned to this Officer, in the three states it can be in.
 *
 * The dashboard shows what has just arrived; this shows the whole of one Officer's work, including
 * what they have already sent on. A submitted assessment stays listed because "I finished that
 * one" is something an assessor needs to be able to check, and a list that dropped work the moment
 * it left their hands would send them hunting through the register for it.
 *
 * Nobody else's reports appear, and there is no filter that could show them: the page is built
 * from one WHERE clause on the reader's own id.
 */
export function MyAssessmentsPage({
  viewerRole,
  viewerName,
  notStarted,
  inProgress,
  submitted,
  secondAssessment,
}: MyAssessmentsPageProps): JSX.Element {
  const total = notStarted.length + inProgress.length + submitted.length + secondAssessment.length;

  return (
    <StaffShell
      title="My assessments — AE Reports"
      pageTitle="My assessments"
      role={viewerRole}
      fullName={viewerName}
      active="assessments"
    >
      <div class="staff-head">
        <div class="sp">
          <p class="hint">
            {total} report{total === 1 ? "" : "s"} assigned to you
          </p>
        </div>
      </div>

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
            Not started <span class="mya-count">{notStarted.length}</span>
          </a>
          <a href="#in-progress">
            In progress <span class="mya-count">{inProgress.length}</span>
          </a>
          <a href="#submitted">
            Submitted <span class="mya-count">{submitted.length}</span>
          </a>
          <a href="#second-assessment">
            Second assessment <span class="mya-count">{secondAssessment.length}</span>
          </a>
        </nav>

        <Section
          group={{
            id: "not-started",
            title: "Not started",
            hint: "Assigned to you and waiting for a first assessment.",
            empty: "Nothing is waiting to be assessed.",
            rows: notStarted,
            initial: true,
          }}
        />

        <Section
          group={{
            id: "in-progress",
            title: "In progress",
            hint: "You have saved a draft assessment on these.",
            empty: "No assessment is part-written.",
            rows: inProgress,
          }}
        />

        <Section
          group={{
            id: "submitted",
            title: "Submitted",
            hint: "Sent on. They are read-only to you now.",
            empty: "You have not submitted an assessment yet.",
            rows: submitted,
          }}
        />

        {/* The fourth group is the other side of this Officer's work: reports a manager has handed
            them to review, rather than ones they were given at intake. Its own group rather than a
            state of the three above, because those three describe one report's journey through
            the first assessment and this is a different job on a different report. */}
        <div class="mya" id="second-assessment">
          <h2>Second assessment</h2>
          <p class="hint">
            A manager has assigned you as second assessor. The form for writing one arrives in a
            later release; until then these open as the report.
          </p>
          {secondAssessment.length === 0 ? (
            <p class="hint">Nothing has been assigned to you for a second assessment.</p>
          ) : (
            <SecondAssessmentRows reports={secondAssessment} />
          )}
        </div>
      </div>
    </StaffShell>
  );
}
