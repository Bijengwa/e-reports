import type { HistoryEvent } from "../../../../domain/assessment-history.js";
import type { F004Answers } from "../../../../domain/f004.js";
import type { FinalDocument } from "../../../../domain/final-document.js";
import { Layout } from "../../../../views/shared/layout.js";
import { F004Form } from "../../reports/components/f004.js";
import { OrangeReportIdentity } from "../../reports/components/orange-report.js";
import type { ReportDetail } from "../../reports/pages/reports.js";
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

/**
 * Which of the two final presentations this is.
 *
 * Not two outcomes and not two documents — one concluded case, presented twice. `"clean"` is the
 * office's position on its own, which is what the position is when anybody asks what it is.
 * `"history"` is that same document with the working record attached under it, for the manager and
 * for audit.
 *
 * One mode flag on one renderer rather than two pages, because the thing that must never drift is
 * Part A: a history document whose final answers disagreed with the clean one would not be an
 * audit trail, it would be a contradiction. There is exactly one place below that builds Part A
 * and both modes go through it.
 */
export type FinalDocumentMode = "clean" | "history";

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
  mode: FinalDocumentMode;
  /**
   * The working record, oldest first. Required by `mode="history"` and meaningless without it.
   *
   * Passed in already built. This component decides how a recorded action is printed and nothing
   * else: which events exist, and what each assessor was looking at, is `buildAssessmentHistory`'s
   * answer, and a renderer that could add an event would be a renderer that could invent one.
   */
  history?: readonly HistoryEvent[];
  /**
   * Whether the reader may open the history presentation, and therefore be offered it.
   *
   * Presentation only. The route decides, on the same rule, before rendering anything — see
   * `finalDocumentRoutes`. A link is not access, and its absence is not protection.
   */
  canReadHistory: boolean;
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

type PartAProps = Pick<
  FinalDocumentPageProps,
  "report" | "document" | "device" | "event" | "approvedByName" | "approvedOn" | "workOfficerName"
>;

/**
 * Part A: the Final F004, and nothing else.
 *
 * The one implementation of the concluded document. The clean presentation is this; the history
 * presentation is this plus a record underneath it; both PDFs are this through the print
 * stylesheet. Anything a reader must see in the office's settled position goes here once, and
 * every presentation gets it by construction rather than by three pages remembering to.
 */
function FinalF004({
  report,
  document,
  device,
  event,
  approvedByName,
  approvedOn,
  workOfficerName,
}: PartAProps): JSX.Element {
  return (
    <>
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
    </>
  );
}

/** One assessment's or decision's attribution lines — who, when, and in what capacity. */
function EventMeta({ pairs }: { pairs: readonly [string, string][] }): JSX.Element {
  return (
    <dl class="ah-meta">
      {pairs
        .filter(([, value]) => value.trim() !== "")
        .map(([label, value]) => (
          <>
            <dt safe>{label}</dt>
            <dd safe>{value}</dd>
          </>
        ))}
    </dl>
  );
}

/**
 * One secondary assessor's recorded actions, item by item.
 *
 * A table, because that is what the content is: one row per item, the same four facts on each.
 * What the assessor was looking at, what they did, what they put in its place where they replaced
 * it, and the words they recorded — and a cell is empty exactly when nothing was recorded in it.
 * An empty Replacement against an Agree is not a gap in the record; it is what agreeing is.
 */
function ActionTable({
  actions,
}: {
  actions: readonly Extract<HistoryEvent, { kind: "secondary_assessment" }>["actions"][number][];
}): JSX.Element {
  return (
    <table class="ah-items">
      <thead>
        <tr>
          <th>Item</th>
          <th>Value reviewed</th>
          <th>Action</th>
          <th>Replacement</th>
          <th>Recorded reason</th>
        </tr>
      </thead>
      <tbody>
        {actions.map((action) => (
          <tr>
            <td class="ah-no">
              <b safe>{action.itemNo}</b> <span safe>{action.itemTitle}</span>
            </td>
            <td safe>{action.asReviewed}</td>
            <td safe>{action.degreeLabel}</td>
            <td safe>{action.replacement ?? ""}</td>
            <td>
              {action.reason === undefined ? (
                <></>
              ) : (
                <>
                  <span class="ah-reason-l" safe>
                    {action.reasonLabel}
                  </span>
                  <span safe>{action.reason}</span>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Part B: the working record, in the order it happened.
 *
 * Rendered from the events it is given and only from those. A case assessed once and concluded
 * prints two entries; one that went round a third assessor prints that assessor because the row
 * exists. There is no placeholder for an assessment that was never made, no heading reserved for
 * one, and nothing anywhere below that counts up to a number of expected assessments.
 *
 * There is also no narrative. No entry explains why the case moved, because no column records
 * why: a manager's recorded grounds are printed where they wrote any, and where they wrote none
 * the record says nothing rather than supplying a reason on their behalf.
 *
 * Not styled as an F004. The final document above is the form; this is a dated list of entries
 * under a heading, which is what an audit record looks like on paper.
 */
function AssessmentHistory({ events }: { events: readonly HistoryEvent[] }): JSX.Element {
  return (
    <section class="fd-history" aria-label="Assessment history">
      <h2 class="fd-part">Assessment history</h2>
      <p class="fd-part-note">
        The working record of this assessment, in the order it was made. Recorded entries only.
      </p>

      {events.length === 0 ? (
        <p class="hint">No submitted assessment is recorded against this report.</p>
      ) : (
        <ol class="ah">
          {events.map((event) => {
            if (event.kind === "first_assessment") {
              return (
                <li class="ah-e">
                  <p class="ah-h">First assessment</p>
                  <EventMeta
                    pairs={[
                      ["Assessor", event.assessorName],
                      ["Role", event.role],
                      ["Date", event.on],
                      ["Status", event.status],
                    ]}
                  />
                  {event.results.length === 0 ? (
                    <></>
                  ) : (
                    <table class="ah-items">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Assessed value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {event.results.map((result) => (
                          <tr>
                            <td class="ah-no">
                              <b safe>{result.itemNo}</b> <span safe>{result.itemTitle}</span>
                            </td>
                            <td safe>{result.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </li>
              );
            }

            if (event.kind === "secondary_assessment") {
              return (
                <li class="ah-e">
                  <p class="ah-h" safe>
                    {`Secondary assessment ${event.ordinal}`}
                  </p>
                  <EventMeta
                    pairs={[
                      ["Assessor", event.assessorName],
                      ["Role", event.role],
                      ["Date", event.on],
                      ["Status", event.status],
                    ]}
                  />
                  {event.actions.length === 0 ? (
                    <p class="hint">No item-level action is recorded against this assessment.</p>
                  ) : (
                    <ActionTable actions={[...event.actions]} />
                  )}
                </li>
              );
            }

            if (event.kind === "manager_review") {
              return (
                <li class="ah-e ah-m">
                  <p class="ah-h" safe>
                    {event.ordinal === 1
                      ? "Manager review of the first assessment"
                      : `Manager review of secondary assessment ${event.ordinal}`}
                  </p>
                  <EventMeta
                    pairs={[
                      ["Reviewer", event.reviewerName],
                      ["Date", event.on],
                    ]}
                  />
                  {event.comment === undefined ? (
                    <></>
                  ) : (
                    <p class="ah-text" safe>
                      {event.comment}
                    </p>
                  )}
                </li>
              );
            }

            return (
              <li class="ah-e ah-m">
                <p class="ah-h" safe>
                  {event.decision}
                </p>
                <EventMeta
                  pairs={[
                    ["Decided by", event.decidedByName],
                    ["Date", event.on],
                    ["Handed to", event.handedTo ?? ""],
                  ]}
                />
                {event.grounds === undefined ? (
                  <></>
                ) : (
                  <p class="ah-text" safe>
                    {event.grounds}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * The document itself: Part A always, Part B when the presentation is the history one.
 *
 * Shared by the screen pages and the printable ones, which is what makes "the PDF is the same
 * document" true rather than aspirational. The divider between the two parts is a rule with the
 * next part's name on it, so a reader who has scrolled past the F004's own section 8 knows the
 * document has ended and a record has begun.
 */
function FinalDocumentBody(props: FinalDocumentPageProps): JSX.Element {
  return (
    <div class="fd-doc" data-print-document>
      {/* Part A, boxed in its own element in every mode — including the clean one, where it is the
          whole document. The two presentations must be the same document in the same wrapper, so
          that "Part A is identical" is a property of the markup rather than of where a divider
          happens to fall. */}
      <section class="fd-final" aria-label="Final F004">
        <FinalF004
          report={props.report}
          document={props.document}
          device={props.device}
          event={props.event}
          approvedByName={props.approvedByName}
          approvedOn={props.approvedOn}
          workOfficerName={props.workOfficerName}
        />
      </section>

      {props.mode === "history" ? (
        <>
          <hr class="fd-divide" />
          <AssessmentHistory events={props.history ?? []} />
        </>
      ) : (
        <></>
      )}
    </div>
  );
}

/**
 * The two downloads, offered only on a document that exists.
 *
 * This page is only reachable for a report a manager has approved — the route serves nothing
 * before the snapshot is written — so there is no state here in which a download could offer a
 * final document that has not been concluded. The working F004 has no download at all, which is
 * the same rule from the other side: an assessment in progress is not a document to file.
 *
 * The history download is offered to the reader who may read the history, and to nobody else.
 */
function Downloads({
  reportId,
  canReadHistory,
}: {
  reportId: string;
  canReadHistory: boolean;
}): JSX.Element {
  return (
    <>
      <a href={`/reports/${reportId}/final-document/print`} class="btn ghost">
        Download Final F004 (PDF)
      </a>
      {canReadHistory ? (
        <a href={`/reports/${reportId}/final-document/history/print`} class="btn ghost">
          Download Final F004 with Assessment History (PDF)
        </a>
      ) : (
        <></>
      )}
    </>
  );
}

export function FinalDocumentPage(props: FinalDocumentPageProps): JSX.Element {
  const { report, viewerRole, viewerName, active, mode, canReadHistory, backHref, backLabel } =
    props;

  return (
    <StaffShell
      title={
        mode === "history"
          ? `Final F004 with assessment history — ${report.number}`
          : `Final F004 — ${report.number}`
      }
      pageTitle={mode === "history" ? "Final F004 + assessment history" : "Final F004"}
      role={viewerRole}
      fullName={viewerName}
      active={active}
      f4Find
    >
      {/* The title bar above already says which document this is. A heading here said it a second
          time twenty pixels below the first, and the sentence under that explained a document that
          explains itself — this page IS the approved assessment, and the identity card, the
          approval card and the form say so in the only way that matters. */}
      <div class="staff-head">
        <div class="sp"></div>
        {/* The other presentation of the same case, for the reader entitled to it. Not a second
            document to choose between: the history view is this document with the working record
            attached, and the way back to the document alone is the same pair of links. */}
        {canReadHistory ? (
          mode === "history" ? (
            <a href={`/reports/${report.id}/final-document`} class="btn ghost">
              Final F004 only
            </a>
          ) : (
            <a href={`/reports/${report.id}/final-document/history`} class="btn ghost">
              Assessment history
            </a>
          )
        ) : (
          <></>
        )}
        <Downloads reportId={report.id} canReadHistory={canReadHistory} />
        <a href={backHref} class="btn ghost" safe>
          {backLabel}
        </a>
      </div>

      <FinalDocumentBody {...props} />
    </StaffShell>
  );
}

/**
 * The printable document: the same body, with the application taken off it.
 *
 * No rail, no title bar, no links — a reader printing a regulatory document does not want this
 * system's navigation in the file, and a PDF that carried a "Back to my work" button would be a
 * screenshot of an application rather than a document. `print.js` opens the print dialogue; the
 * page is the finished document with or without it.
 *
 * Deliberately the same `FinalDocumentBody` the screen pages render. There is no print-only copy
 * of the F004 and no second resolution of the answers: if the two could differ, the file somebody
 * archives would not be the document somebody approved.
 */
export function FinalDocumentPrintPage(props: FinalDocumentPageProps): JSX.Element {
  return (
    <Layout
      title={
        props.mode === "history"
          ? `Final F004 with assessment history — ${props.report.number}`
          : `Final F004 — ${props.report.number}`
      }
      locale="en"
      bodyClass="staff fd-print"
      printDocument
    >
      <main class="fd-print-page">
        <FinalDocumentBody {...props} />
      </main>
    </Layout>
  );
}
