import type { F004Answers, Issue } from "../../../../domain/f004.js";
import type { ReportDetail } from "../../../../domain/report-detail.js";
import { isSeriousCase } from "../../../../domain/reports.js";
import { DocHeader } from "../../shared/components/doc-header.js";
import { F004Form } from "../../shared/components/f004.js";
import { IconClose } from "../../shared/components/icons.js";
import { OrangeReportSurface } from "../../shared/components/orange-report.js";
import { ReportDocument } from "../../shared/components/report-views.js";
import { StaffShell } from "../../shared/shell.js";
import { Countdown } from "../components/countdown.js";

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
  /** This assignment's own deadline — the same `assessments.due_at` every other queue reads it
   *  from (`loadReport`'s `assessor1DueAt`, `workload.tsx`'s `currentDueAt`), never a date read
   *  off the F004 itself. Null means no deadline was set. */
  dueAt: Date | null;
  /** The report's established IMDRF release, resolved server-side — never a choice offered here.
   *  See `domain/imdrf/f004-integration.ts`'s `resolveAssessmentRelease`. Read out of `answers`
   *  itself by `F004Form`'s pickers; this is only the passive display label. */
  imdrfReleaseLabel?: string;
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
  dueAt,
  imdrfReleaseLabel,
}: Assessment1PageProps): JSX.Element {
  return (
    <StaffShell
      title={`Assessment 1 — F004 — ${report.number}`}
      // The compact `DocHeader` below is now the page's own title row — an F004's identity, its
      // countdown and its way back all live there, in one line, directly above the document. The
      // shell's own title bar keeps a short label for the tab/a11y landmark and nothing that would
      // print the same fact twice.
      pageTitle="Assessment 1 — F004"
      role={viewerRole}
      fullName={viewerName}
      active="assessments"
      f4Find
      countdown
      imdrfPicker
    >
      {/* Everything that used to sit here — the Orange Report identity card, a standalone back
          button, the divider under them — is gone. `DocHeader` is the one row the page opens
          with; the official F004 masthead (`.f4-doc-head`, inside `F004Form`) follows immediately
          after it. */}
      <DocHeader
        backHref="/assessments"
        backLabel="Back to my assessments"
        title="Assessment 1 — F004"
        badge={
          <Countdown dueAt={dueAt} completed={submitted} serious={isSeriousCase(report.severity)} />
        }
      >
        {/* A label, not a button: it drives the checkbox below, so it opens the drawer with or
            without a script running. Text, not an icon — the Orange Report control is named, not
            just symbolised, the same way it always has been. */}
        <label for="a1-drawer" class="btn a1-open orange-action">
          Orange Report
        </label>
      </DocHeader>

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
          // 7.2, the secondary assessor's name and the second signature row are all a secondary
          // assessment's business, and there is no secondary assessment here — this route reads
          // and writes ordinal 1 and nothing else. Drawn on A1 they were empty boxes implying a
          // second assessor the report may never have, on a form the first assessor is trying to
          // fill in. The official F004 keeps 7.2; the page that shows it is the one that owns it.
          omitSecond
          issues={issues}
          imdrfReleaseLabel={imdrfReleaseLabel}
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
            <label for="a1-drawer" class="a1-drawer-close" aria-label="Close the report">
              <IconClose />
            </label>
          </div>
          <OrangeReportSurface report={report} withIdentity>
            <ReportDocument report={report} />
          </OrangeReportSurface>
        </aside>
      </div>
    </StaffShell>
  );
}
