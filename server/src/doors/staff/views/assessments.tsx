import { type ReceivedRow, ReceivedRows } from "./reports.js";
import { StaffShell } from "./shell.js";

/** One group of the Officer's work, with the sentence to print when it is empty. */
type Group = {
  title: string;
  hint: string;
  empty: string;
  rows: ReceivedRow[];
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
    <div class="mya">
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

      <Section
        group={{
          title: "Not started",
          hint: "Assigned to you and waiting for a first assessment.",
          empty: "Nothing is waiting to be assessed.",
          rows: notStarted,
        }}
      />

      <Section
        group={{
          title: "In progress",
          hint: "You have saved a draft assessment on these.",
          empty: "No assessment is part-written.",
          rows: inProgress,
        }}
      />

      <Section
        group={{
          title: "Submitted",
          hint: "Sent on. They are read-only to you now.",
          empty: "You have not submitted an assessment yet.",
          rows: submitted,
        }}
      />
    </StaffShell>
  );
}
