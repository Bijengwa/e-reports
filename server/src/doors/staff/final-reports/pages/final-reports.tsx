import { SEVERITY_LABELS, severityTone } from "../../../../domain/report-detail.js";
import { receivedDay } from "../../shared/components/orange-report.js";
import { StaffShell } from "../../shared/shell.js";

/**
 * The index over every approved F004.
 *
 * Nothing here is new: each row is a `report_final_documents` snapshot that already existed, taken
 * the moment a manager approved. What was missing was any way to reach them — a manager could open
 * a final document only by walking to the report it belongs to and finding the button. This is the
 * list, and it is only a list; the documents, the approval, and the decision that produced them
 * are untouched.
 *
 * One destination per row — the Final F004 itself — so the row is the link rather than a strip of
 * buttons that all led there anyway. `.row-link` (`base.css`) stretches the number's own `<a>` over
 * the whole `<tr>`; there is still exactly one real link in the row's markup, just reachable from
 * anywhere in it.
 */

/** One approved F004, as the list prints it. */
export type FinalReportRow = {
  reportId: string;
  number: string;
  receivedAt: Date;
  deviceName: string;
  severity: string;
  status: string;
  approvedAt: Date;
  /** The last assessment folded into the document: 3 for a report resolved through A3. */
  resolvedThroughOrdinal: number;
  approvedByName: string;
  /** Named on the same decision that produced the document. Null only if that link is gone. */
  workOfficerName: string | null;
};

export type FinalReportsPageProps = {
  viewerRole: string;
  viewerName: string;
  rows: FinalReportRow[];
};

export function FinalReportsPage({
  viewerRole,
  viewerName,
  rows,
}: FinalReportsPageProps): JSX.Element {
  return (
    <StaffShell
      title="Final Reports — e-reports"
      pageTitle="Final Reports"
      role={viewerRole}
      fullName={viewerName}
      active="final-reports"
    >
      <div class="staff-head">
        <div class="sp">
          <h2>Final Reports</h2>
          <p class="hint">
            Approved F004 documents. Each one is the authoritative snapshot taken when the manager
            approved the assessment, and each carries the Orange Report it was assessed from.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        /* A sentence rather than an empty table, which reads as a list that failed to load. It
           says what has to happen for a row to appear, because on a new deployment this page is
           empty for a legitimate reason rather than a broken one. */
        <p class="hint">
          No final report yet. One is created the moment a manager approves an assessment and
          assigns the work.
        </p>
      ) : (
        // Wider than a narrow window, so it scrolls inside its own box rather than pushing the
        // page sideways. See `.tscroll` in the stylesheet.
        <div class="tscroll">
          <table class="utable">
            <thead>
              <tr>
                <th>Final F004</th>
                <th>Device</th>
                <th>Severity</th>
                <th>Approved</th>
                <th>Approved by</th>
                <th>Assessment</th>
                <th>Assigned officer</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                // The row's one destination, everywhere on it — see `.row-link` in `base.css`. The
                // number below is still the only real `<a>` in the markup; the class just stretches it.
                <tr class="row-link">
                  {/* The number names the document, so it leads to the document. */}
                  <td>
                    <a
                      href={`/reports/${row.reportId}/final-document`}
                      class="row-link-target"
                      safe
                    >
                      {row.number}
                    </a>
                  </td>

                  <td>
                    <span class="cap" safe>
                      {row.deviceName}
                    </span>
                  </td>

                  <td>
                    <span class={`tag ${severityTone(row.severity)}`} safe>
                      {SEVERITY_LABELS[row.severity] ?? row.severity}
                    </span>
                  </td>

                  <td safe>{receivedDay(row.approvedAt)}</td>
                  <td safe>{row.approvedByName}</td>

                  {/* How far the chain ran before the manager was satisfied. `A1 – A3` rather than
                      a bare 3, which would read as a count of something. */}
                  <td safe>
                    {row.resolvedThroughOrdinal <= 1
                      ? "A1"
                      : `A1 – A${String(row.resolvedThroughOrdinal)}`}
                  </td>

                  <td>
                    {row.workOfficerName === null ? (
                      <span class="hint">—</span>
                    ) : (
                      <span safe>{row.workOfficerName}</span>
                    )}
                  </td>

                  {/* Always "Assigned for work". A final document exists only because the manager
                      approved and handed the work out, and one decision does both — so this is the
                      report's real status, not a status invented for this page. There is no
                      closing workflow in this MVP and no Closed to show. */}
                  <td>
                    <span class="tag muted">Assigned for work</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </StaffShell>
  );
}
