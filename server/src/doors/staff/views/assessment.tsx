import type { F004Answers, Issue } from "../../../domain/f004.js";
import { F004Form } from "./f004.js";
import { type ReportDetail, ReportDocument } from "./reports.js";
import { StaffShell } from "./shell.js";

export type Assessment1PageProps = {
  report: ReportDetail;
  viewerRole: string;
  /** The signed-in person, for the title bar and the 1st assessor line. */
  viewerName: string;
  answers: F004Answers;
  device: Record<string, string>;
  event: Record<string, string>;
  assessedOn: string;
  submitted: boolean;
  issues: readonly Issue[];
};

/**
 * The first assessment of one report: the F004 in full, and the report a click away.
 *
 * It was a permanent 50/50 split, and that was the wrong trade. The F004 is the document being
 * written — nineteen administrative rows, seven IMDRF grids, four criteria cards — and it was
 * being written in half a column so a report the assessor needs in glances could sit open beside
 * it forever. Now the form has the whole main column and the report comes over it when asked for.
 * That is also what keeps 1.x and 2.x off the screen twice: those values are blended into sections
 * 1 and 2 already, so the drawer is for the rest of the document.
 *
 * A checkbox opens it rather than a script. The drawer has to work for someone whose JavaScript
 * never arrived, and the CSP rules out the inline handler the usual pattern reaches for. It sits
 * outside the F004's own form and carries no name, so it is not a field of the assessment; the
 * script only adds Escape, which is what anyone who has met a drawer tries first.
 *
 * The report is rendered through `ReportDocument`, the same component `/reports/:id` uses, so what
 * is being assessed cannot drift from what was shown.
 */
export function Assessment1Page({
  report,
  viewerRole,
  viewerName,
  answers,
  device,
  event,
  assessedOn,
  submitted,
  issues,
}: Assessment1PageProps): JSX.Element {
  return (
    <StaffShell
      title={`Assessment 1 — ${report.number}`}
      pageTitle="Assessment 1"
      role={viewerRole}
      fullName={viewerName}
      active="assessments"
      f4Find
    >
      <div class="staff-head">
        <div class="sp">
          <h2 safe>{report.number}</h2>
          <p class="hint" safe>
            {report.deviceName}
          </p>
        </div>
        {/* A label, not a button: it drives the checkbox below, so it opens the drawer with or
            without a script running. */}
        <label for="a1-drawer" class="btn ghost a1-open">
          The report
        </label>
        <a href={`/reports/${report.id}`} class="btn ghost">
          ← Back to the report
        </a>
      </div>

      <div class="a1-work">
        {/* No name, so it is never posted; outside the F004's form, so it is not its business. */}
        <input type="checkbox" id="a1-drawer" class="a1-pick" data-a1-drawer />

        <F004Form
          reportId={report.id}
          answers={answers}
          device={device}
          event={event}
          assessorName={viewerName}
          assessedOn={assessedOn}
          submitted={submitted}
          issues={issues}
        />

        {/* Both siblings of the checkbox, which is what lets CSS alone open them. The scrim says
            what it is rather than being an unlabelled patch of screen that happens to close
            things — the sighted reader has the dimmed page to go on, everyone else has this. */}
        <label for="a1-drawer" class="a1-scrim">
          <span class="vh">Close the report</span>
        </label>

        <aside class="a1-drawer" aria-label="The report as filed">
          <div class="a1-drawer-head">
            <h3>The report as filed</h3>
            <label for="a1-drawer" class="a1-drawer-close">
              Close
            </label>
          </div>
          <ReportDocument report={report} />
        </aside>
      </div>
    </StaffShell>
  );
}
