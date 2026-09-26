import type { F004Answers } from "../../../../domain/f004.js";
import type { FinalDocument } from "../../../../domain/final-document.js";
import type { ReportDetail } from "../../../../domain/report-detail.js";
import { Layout } from "../../../../views/shared/layout.js";
import { F004Form, type PriorSecondaryReview } from "../../shared/components/f004.js";
import { IconBack, IconClose, IconDownload, IconPrint } from "../../../../views/shared/icons.js";
import {
  OrangeReportIdentity,
  OrangeReportSurface,
} from "../../shared/components/orange-report.js";
import { ReportDocument } from "../../shared/components/report-views.js";
import { StaffShell } from "../../shared/shell.js";

/**
 * The Final F004: the assessment form, completed, with one resolved answer in every box.
 *
 * Three documents exist and this is the third. The Orange Report is the source — what a member of
 * the public filed, immutable, and shown here only as the identity of what is being assessed. The
 * assessments A1…An are the internal working record of how the office argued its way to a
 * position. This is the position, on the form the position belongs on.
 *
 * Rendered through `F004Form` — the same component the assessors write on and the manager reviews
 * — rather than through a layout of its own. That is the whole design of this page: a final F004
 * that did not look like an F004 would be a fourth document for a reader to learn, and the one
 * thing a consolidated assessment must be is recognisable as the thing it consolidates. Every
 * section number, every criterion card and every IMDRF grid is the form's own.
 *
 * `presentation="final"` is the form's own flag rather than this page hiding things after the fact
 * — see `F004Presentation` in `f004.tsx`. No assessor is named on this document, no assessment date
 * is printed on it, 7.2 is absent, and section 8 is the manager's approval.
 *
 * Two presentation TYPES sit over that one document, both resolved to the same snapshot:
 *
 *   - "clean": `priorReviews` is empty. Every item's `A2InlineDecision` then renders only the
 *     resolved answer and its resolved statement (`resolvedNotes`) — no per-item history, because
 *     there is nothing to expand. This is `a2Review`/`priorReviews` omitted exactly as the single
 *     original rendering always did.
 *   - "history": `priorReviews` carries every submitted secondary assessment in the chain, in the
 *     same shape the working secondary-assessment page already builds for its own read-only
 *     context. The same `A2InlineDecision`/`PriorReviewHistory` machinery that page uses to show
 *     "Previous assessments (N)" per item now shows the SAME thing here — collapsed by default,
 *     expandable per question — with no second history renderer written for it.
 *
 * There is deliberately no third component and no branch inside `F004Form` for either type: the
 * type is entirely the presence or absence of one prop already defined on the shared renderer.
 */

export type FinalDocumentType = "clean" | "history";

export type FinalDocumentPageProps = {
  report: ReportDetail;
  viewerRole: string;
  viewerName: string;
  /** Which rail entry this page belongs under, decided by who is reading it. */
  active: "final-reports" | "my-work";
  document: FinalDocument;
  /** Section 1's device rows and section 2's event rows, off the Orange Report. Read, not typed. */
  device: Record<string, string>;
  event: Record<string, string>;
  /** Who approved it and when — the moment this document became authoritative. */
  approvedByName: string;
  approvedOn: string;
  /**
   * The Officer the work went to, named on the same decision.
   *
   * Metadata about the report, printed in the card above the document and never inside it. Being
   * handed the work is not having assessed it, and the F004 has no box that means "the officer who
   * will act on this".
   */
  workOfficerName: string | null;
  /** Where the reader came from, so the way back is the way they arrived. */
  backHref: string;
  backLabel: string;
  /** Which of the two presentations is showing. */
  type: FinalDocumentType;
  /**
   * `{ clean, history }` — the same page, with `?type=` set to the other value.
   *
   * `null` when this reader may not see "Assessment History" at all — the assigned Officer, who
   * `resolveFinalDocument`'s own route keeps to "clean" regardless of what `?type=` says, because
   * that presentation names every secondary assessor and their individual positions. See the
   * route's own comment. The switch itself is not rendered for that reader, rather than rendered
   * and disabled: a control offering a document they will never receive is worse than no control.
   */
  typeHrefs: Record<FinalDocumentType, string> | null;
  /** The PDF attachment endpoint for the current `type`. */
  downloadHref: string;
  /**
   * Every submitted secondary assessment in the chain — A2, A3, …, whatever the case actually has.
   *
   * Empty for "clean". For "history", this is exactly what `SecondaryAssessmentPage` already
   * builds as its own `priorReviews`, reused verbatim: `F004Form` does not know or care that no
   * assessor is "currently" reviewing here, only that these are read-only positions to fold into
   * each item's expandable history.
   */
  priorReviews: readonly PriorSecondaryReview[];
};

/**
 * The resolved statements that have nowhere to live in the F004's own fields.
 *
 * `provenance` is where the resolver parks a clarification whose item carries no comment box —
 * 1.3, 4.2, the IMDRF grids. It is not history: only the statement that survived the chain is
 * here, one per item at most, exactly as the answers above carry only the value that survived.
 */
function resolvedNotes(document: FinalDocument): Record<string, string> {
  const notes: Record<string, string> = {};
  for (const [key, entry] of Object.entries(document.provenance)) {
    if (entry.note !== undefined && entry.note.trim() !== "") notes[key] = entry.note;
  }
  return notes;
}

/** The two-way Clean / Assessment History switch — see the module doc comment for what each does. */
function TypeSwitch({
  type,
  typeHrefs,
}: {
  type: FinalDocumentType;
  typeHrefs: Record<FinalDocumentType, string>;
}): JSX.Element {
  return (
    <nav class="f4-type-switch" aria-label="Final F004 presentation">
      <a href={typeHrefs.clean} aria-current={type === "clean" ? "page" : undefined}>
        Clean
      </a>
      <a href={typeHrefs.history} aria-current={type === "history" ? "page" : undefined}>
        Assessment History
      </a>
    </nav>
  );
}

/**
 * Final F004's whole title-bar row, rendered in place of `pageTitle`/`titleExtra` via `StaffShell`'s
 * `topContent` — one `.top` bar, not a second `.f4-toolbar` row underneath it. The hamburger and the
 * signed-in name/role are `StaffShell`'s own and stay put; this is everything between them.
 */
function FinalF004TopContent({
  backHref,
  backLabel,
  type,
  typeHrefs,
  downloadHref,
}: {
  backHref: string;
  backLabel: string;
  type: FinalDocumentType;
  typeHrefs: Record<FinalDocumentType, string> | null;
  downloadHref: string;
}): JSX.Element {
  return (
    <div class="final-f004-top">
      <a href={backHref} class="f4-icon-btn" aria-label={backLabel}>
        <IconBack />
      </a>

      <h1>Final F004</h1>

      {typeHrefs !== null && <TypeSwitch type={type} typeHrefs={typeHrefs} />}

      <a href={downloadHref} class="f4-icon-btn" aria-label="Download this Final F004" download="">
        <IconDownload />
      </a>

      <button type="button" class="f4-icon-btn" data-f4-print aria-label="Print this Final F004">
        <IconPrint />
      </button>

      <label for="a1-drawer" class="btn orange-action">
        Orange Report
      </label>
    </div>
  );
}

export function FinalDocumentPage({
  report,
  viewerRole,
  viewerName,
  active,
  document,
  device,
  event,
  approvedByName,
  approvedOn,
  backHref,
  backLabel,
  type,
  typeHrefs,
  downloadHref,
  priorReviews,
}: FinalDocumentPageProps): JSX.Element {
  // `workOfficerName` is still part of `FinalDocumentPageProps` and still passed by the route —
  // the approval card that used to print it on screen is gone per this round's instruction, but
  // nobody has decided yet how (or whether) it belongs somewhere else on the screen page, so it
  // is left off this destructure rather than rendered again by guesswork.
  return (
    <StaffShell
      title={`Final F004 — ${report.number}`}
      pageTitle="Final F004"
      pageCss="caseCss"
      role={viewerRole}
      fullName={viewerName}
      active={active}
      f4Find
      f4Print
      // One `.top` bar, not a second `.f4-toolbar` row underneath it — see `FinalF004TopContent`'s
      // own doc comment.
      topContent={
        <FinalF004TopContent
          backHref={backHref}
          backLabel={backLabel}
          type={type}
          typeHrefs={typeHrefs}
          downloadHref={downloadHref}
        />
      }
    >
      <div class="a1-work">
        <input type="checkbox" id="a1-drawer" class="a1-pick" data-a1-drawer />

        <div>
          <F004Form
            reportId={report.id}
            answers={document.answers as F004Answers}
            // The clarifications the F004 has no comment box for. Everything else a clarification
            // touched is already inside `answers`, written there by the resolver.
            resolvedNotes={resolvedNotes(document)}
            device={device}
            event={event}
            // Nothing. The concluded document names no assessor and carries no assessment date, and
            // the honest way to say that is to have nothing to say it with — see `presentation`.
            assessorName=""
            assessedOn=""
            // The concluded F004, not a working assessment: no assessor strip, no assessor dates, no
            // 7.2, no secondary-assessor slot, and section 8 signed by the manager who approved it.
            presentation="final"
            approval={{ byName: approvedByName, on: approvedOn }}
            submitted
            readOnly
            // The approved F004 is a document, not a filled-in form: the answer is shown, the
            // twenty-odd options it was chosen from are not. See `documentMode` in `f004.tsx`.
            documentMode
            // Empty for "clean"; the full chain for "history" — see the module doc comment. This
            // is the entire difference between the two presentations.
            priorReviews={priorReviews}
            issues={[]}
          />
        </div>

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

export type FinalDocumentPrintPageProps = {
  report: ReportDetail;
  document: FinalDocument;
  device: Record<string, string>;
  event: Record<string, string>;
  approvedByName: string;
  approvedOn: string;
  workOfficerName: string | null;
  type: FinalDocumentType;
  priorReviews: readonly PriorSecondaryReview[];
};

/**
 * The same approved Final F004, as the document a reader takes away rather than reads on screen.
 *
 * Rendered server-side to a PDF, not served directly as a browser tab — see
 * `routes/final-document.tsx`'s download route and `../../../../pdf/index.js`. This component's
 * job is only to produce the HTML that PDF is made from: an A4-width sheet with no staff-portal
 * chrome at all — no rail, no title bar, no jump bar, no toolbar, no drawer — built on `Layout`
 * rather than `StaffShell` for the same reason it always was: this page IS the document, so there
 * is nothing here to hide with CSS, only nothing to render in the first place.
 *
 * `F004Form` is the same component and the same `presentation="final"` / `documentMode` the screen
 * uses, with `interactiveNav={false}` dropping the section-jump bar and find box a printed page has
 * no use for, and `priorReviews` carrying the same Clean/History difference the screen page does —
 * see `FinalDocumentPage`'s module doc comment.
 *
 * `.fd-print-page` is what makes it read as a document rather than a bare page: an A4-ish sheet on
 * screen, and — under `@media print` in css/case.css — the shape both the browser's own
 * Print/Save-as-PDF and this module's headless-Chromium render turn it into.
 */
export function FinalDocumentPrintPage({
  report,
  document,
  device,
  event,
  approvedByName,
  approvedOn,
  workOfficerName,
  type,
  priorReviews,
}: FinalDocumentPrintPageProps): JSX.Element {
  return (
    <Layout title={`Final F004 — ${report.number}`} locale="en" bodyClass="staff" caseCss>
      <div class="fd-print-page">
        <p class="eyebrow">
          {type === "history"
            ? "Final F004 — approved assessment, with assessment history"
            : "Final F004 — approved assessment"}
        </p>

        <OrangeReportIdentity report={report} />

        <div class="card card-b fd-approval">
          <dl>
            <dt>Approved by</dt>
            <dd safe>{approvedByName}</dd>

            <dt>Approved on</dt>
            <dd safe>{approvedOn}</dd>

            {workOfficerName === null ? (
              <></>
            ) : (
              <>
                <dt>Assigned for work to</dt>
                <dd safe>{workOfficerName}</dd>
              </>
            )}
          </dl>
        </div>

        <F004Form
          reportId={report.id}
          answers={document.answers as F004Answers}
          resolvedNotes={resolvedNotes(document)}
          device={device}
          event={event}
          assessorName=""
          assessedOn=""
          presentation="final"
          approval={{ byName: approvedByName, on: approvedOn }}
          submitted
          readOnly
          documentMode
          interactiveNav={false}
          priorReviews={priorReviews}
          issues={[]}
        />
      </div>
    </Layout>
  );
}
