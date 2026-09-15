import type { F004Answers } from "../../../../domain/f004.js";
import type { FinalDocument } from "../../../../domain/final-document.js";
import type { ReportDetail } from "../../../../domain/report-detail.js";
import { Layout } from "../../../../views/shared/layout.js";
import { F004Form } from "../../shared/components/f004.js";
import { OrangeReportIdentity } from "../../shared/components/orange-report.js";
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
 * What is deliberately NOT passed is `a2Review` and `priorReviews`. Those are what draw the
 * agree/clarify/disagree blocks and the per-item history through the body of the form, and they
 * are exactly what must not appear here: the argument stays in `assessments`, readable on the
 * report page and in the audit trail, and this document carries only the answer it settled on.
 * `sectionComments` and `commentAction` are omitted for the same reason.
 *
 * `presentation="final"` is the rest of it, and it is the form's own flag rather than this page
 * hiding things after the fact — see `F004Presentation` in `f004.tsx`. No assessor is named on this
 * document, no assessment date is printed on it, 7.2 is absent, and section 8 is the manager's
 * approval. Nothing about who assessed the report reaches this component at all, which is a
 * stronger statement than not rendering it.
 *
 * `readOnly` and `submitted` together mean there is no form element at all — nothing on this page
 * is editable, and nothing on it advertises a route that would refuse the reader.
 */

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
  workOfficerName,
  backHref,
  backLabel,
}: FinalDocumentPageProps): JSX.Element {
  return (
    <StaffShell
      title={`Final F004 — ${report.number}`}
      pageTitle="Final F004"
      role={viewerRole}
      fullName={viewerName}
      active={active}
      f4Find
    >
      {/* The title bar above already says "Final F004" once. A heading here said it a second time
          twenty pixels below the first, and the sentence under that explained a document that
          explains itself — this page IS the approved assessment, and the identity card, the
          approval card and the form say so in the only way that matters. */}
      <div class="staff-head">
        <div class="sp"></div>
        {/* The download's own route, `resolveFinalDocument` and all — see routes/final-document.tsx.
            Opened in a new tab so the staff screen stays put behind it: the download is a document
            to read or print, not a page this one navigates away to. */}
        <a
          href={`/reports/${report.id}/final-document/download`}
          class="btn"
          target="_blank"
          rel="noopener"
        >
          Download Final F004
        </a>
        <a href={backHref} class="btn ghost" safe>
          {backLabel}
        </a>
      </div>

      {/* The source document this F004 assesses, wearing the identity it wears everywhere else.
          It is not part of the F004 and is not restated inside it — sections 1 and 2 already carry
          the reporter's own facts, read from the same immutable payload. */}
      <OrangeReportIdentity report={report} />

      {/* The approval, and who is carrying it out. Metadata about the document, outside the
          document — how far the assessment chain ran is a fact about the working record and is
          printed on the Final Reports register, which is the manager's index over it. It has no
          place on the concluded F004, where it would be the one line still describing the
          argument. */}
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
        // The clarifications the F004 has no comment box for. Everything else a clarification
        // touched is already inside `answers`, written there by the resolver.
        resolvedNotes={resolvedNotes(document)}
        device={device}
        event={event}
        // Nothing. The concluded document names no assessor and carries no assessment date, and
        // the honest way to say that is to have nothing to say it with — see `presentation` below.
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
        issues={[]}
      />
    </StaffShell>
  );
}

export type FinalDocumentDownloadPageProps = {
  report: ReportDetail;
  document: FinalDocument;
  device: Record<string, string>;
  event: Record<string, string>;
  approvedByName: string;
  approvedOn: string;
  workOfficerName: string | null;
};

/**
 * The same approved Final F004, as the document a reader takes away rather than reads on screen.
 *
 * `resolveFinalDocument` (routes/final-document.tsx) is the one place either presentation asks "is
 * this reader allowed to see this document" and the one place the row is loaded — this page trusts
 * whatever it is handed and resolves nothing of its own, on the same argument `FinalDocumentPage`
 * above already follows for the answers themselves.
 *
 * Built on `Layout` rather than `StaffShell`: the rail, the title bar and the jump bar are not
 * hidden by CSS here, they are never rendered — a reader who saves or prints this page gets exactly
 * the document and nothing the staff portal put around it. `F004Form` is the same component and the
 * same `presentation="final"` / `documentMode` the screen uses; `interactiveNav={false}` is the one
 * difference, dropping the section-jump bar and find box a printed page has no use for.
 *
 * `.fd-print-page` is what makes it read as a document rather than a bare page: an A4-width sheet
 * on screen, and — under `@media print` in app.css — the page the browser's own Print/Save-as-PDF
 * turns into. No PDF library sits behind this; the project already prints the staff portal's own
 * chrome away for `Ctrl+P`, and this is that same architecture, applied to a page built to be
 * printed rather than merely surviving it.
 */
export function FinalDocumentDownloadPage({
  report,
  document,
  device,
  event,
  approvedByName,
  approvedOn,
  workOfficerName,
}: FinalDocumentDownloadPageProps): JSX.Element {
  return (
    <Layout title={`Final F004 — ${report.number}`} locale="en" bodyClass="staff">
      <div class="fd-print-page">
        <p class="eyebrow">Final F004 — approved assessment</p>

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
          issues={[]}
        />
      </div>
    </Layout>
  );
}
