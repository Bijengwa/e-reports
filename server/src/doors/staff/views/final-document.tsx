import type { F004Answers } from "../../../domain/f004.js";
import type { FinalDocument } from "../../../domain/final-document.js";
import { F004Form } from "./f004.js";
import { OrangeReportIdentity } from "./orange-report.js";
import type { ReportDetail } from "./reports.js";
import { StaffShell } from "./shell.js";

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
 * `readOnly` and `submitted` together mean there is no form element at all — nothing on this page
 * is editable, and nothing on it advertises a route that would refuse the reader.
 */

export type FinalDocumentPageProps = {
  report: ReportDetail;
  viewerRole: string;
  viewerName: string;
  document: FinalDocument;
  /** Section 1's device rows and section 2's event rows, off the Orange Report. Read, not typed. */
  device: Record<string, string>;
  event: Record<string, string>;
  /**
   * The F004's own "1st Assessor" strip: who wrote the assessment this document resolves, and
   * when they submitted it.
   *
   * A1's, not the manager's. The manager approved the document; they did not assess the report,
   * and a form that named them as its assessor would be saying something untrue on the one line
   * that has to be exactly true. Who approved it is the card above, where it belongs.
   */
  assessorName: string;
  assessedOn: string;
  /** Who approved it and when — the moment this document became authoritative. */
  approvedByName: string;
  approvedOn: string;
  /** The last assessment folded in: 3 for a report resolved through A3. */
  resolvedThroughOrdinal: number;
  /** The Officer the work went to, named on the same decision. */
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
  document,
  device,
  event,
  assessorName,
  assessedOn,
  approvedByName,
  approvedOn,
  resolvedThroughOrdinal,
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
      active="reports"
      f4Find
    >
      <div class="staff-head">
        <div class="sp">
          <h2>Final F004</h2>
          <p class="hint">
            The approved assessment of this report, resolved to one answer per question. The working
            assessments behind it stay on the report page.
          </p>
        </div>
        <a href={backHref} class="btn ghost" safe>
          {backLabel}
        </a>
      </div>

      {/* The source document this F004 assesses, wearing the identity it wears everywhere else.
          It is not part of the F004 and is not restated inside it — sections 1 and 2 already carry
          the reporter's own facts, read from the same immutable payload. */}
      <OrangeReportIdentity report={report} />

      <div class="card card-b fd-approval">
        <dl>
          <dt>Approved by</dt>
          <dd safe>{approvedByName}</dd>

          <dt>Approved on</dt>
          <dd safe>{approvedOn}</dd>

          <dt>Assessments resolved</dt>
          <dd>{resolvedThroughOrdinal <= 1 ? "A1" : `A1 – A${String(resolvedThroughOrdinal)}`}</dd>

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
        assessorName={assessorName}
        assessedOn={assessedOn}
        submitted
        readOnly
        // The approved F004 is a document, not a filled-in form: the answer is shown, the
        // twenty-odd options it was chosen from are not. See `documentMode` in `f004.tsx`.
        documentMode
        // 7.2, as the last assessor in the chain concluded it — the one the manager was finally
        // satisfied with. Not a merge of every secondary assessor's remarks and not a history of
        // them; see `second` in `final-document.ts`.
        //
        // A document snapshotted before 7.2 was collected has none, and leaves the section out
        // altogether rather than printing the form's "pending" block, which would be untrue of a
        // document that has already been approved.
        omitSecond={document.secondAssessor === undefined}
        secondSection={
          document.secondAssessor === undefined
            ? undefined
            : {
                answers: document.second,
                ordinal: document.secondAssessor.ordinal,
                signedOn: approvedOn,
              }
        }
        issues={[]}
      />
    </StaffShell>
  );
}
