import { type ReceivedRow, ReceivedRows } from "./reports.js";
import { StaffShell } from "./shell.js";

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
}: MyAssessmentsPageProps): JSX.Element {
  const total = notStarted.length + inProgress.length + submitted.length;

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
      </div>
    </StaffShell>
  );
}
