import { StaffShell } from "../../shared/shell.js";

export type RegisterRow = {
  reportId: string;
  sn: number;
  tmda_report_number: string;
  date_received: string;
  device_brand_name: string;
  device_common_name: string;
  size: string;
  batch_lot_serial_number: string;
  device_type: string;
  manufacturing_date: string;
  expiry_date: string;
  manufacturer_name_address: string;
  manufacturing_country: string;
  supplier_name: string;
  event_description: string;
  date_onset_event: string;
  date_report: string;
  event_location: string;
  region: string;
  type_of_report: string;
  reporter_details: string;
  event_seriousness: string;
  device_component_level_1: string;
  device_component_level_2: string;
  device_component_level_3: string;
  device_component_codes: string;
  device_problem_level_1: string;
  device_problem_level_2: string;
  device_problem_level_3: string;
  device_problem_codes: string;
  clinical_sign_level_1: string;
  clinical_sign_level_2: string;
  clinical_sign_level_3: string;
  clinical_sign_codes: string;
  health_impact_level_1: string;
  health_impact_level_2: string;
  health_impact_level_3: string;
  health_impact_codes: string;
  investigation_type_codes: string;
  investigation_finding_level_1: string;
  investigation_finding_codes: string;
  investigation_finding_level_2: string;
  investigation_type_cause_level_2: string;
  investigation_type_cause_level_3: string;
  investigation_conclusion_codes: string;
  investigation_conclusion_level_1: string;
  investigation_conclusion_level_2: string;
  investigation_status: string;
  causality_assessment: string;
  risk_assessment: string;
  regulatory_action: string;
  assessor_1_name: string;
  date_assessment_1: string;
  assessor_2_name: string;
  date_assessment_2: string;
  acknowledgement_feedback: string;
};

export type RegisterPageProps = {
  rows: ReadonlyArray<RegisterRow>;
  viewerRole: string;
  viewerName: string;
};

/**
 * One `[header, width px, cell getter]` per Register column, in the authoritative order.
 *
 * A single source of truth for the header row, the `<colgroup>` and each body row, so the three
 * can never drift out of sync — the failure mode the previous version had no guard against.
 * `register-export.ts` reads the same array, so the sheet and the page can never disagree either.
 *
 * Header strings mirror the TMDA Adverse Events/Incidents Register worksheet
 * (TMDA/DMD/MDV/R/002) column-for-column, with typos in the worksheet corrected.
 *
 * `narrative: true` marks the columns whose values are free-form prose written by a reporter or an
 * assessor rather than a date, a code or a picked term. It buys them a deliberately wider column
 * and one more line of preview — it is not what decides whether a value is previewed at all; see
 * `cellOverflows`, which asks the value itself.
 */
export type RegisterColumn = {
  header: string;
  width: number;
  /** Free-form prose, as opposed to a date, a code, a name or a picked IMDRF term. */
  narrative?: true;
  cell: (row: RegisterRow) => string | number;
};

export const COLUMNS: ReadonlyArray<RegisterColumn> = [
  { header: "S/N", width: 56, cell: (r) => r.sn },
  { header: "TMDA Report Number", width: 150, cell: (r) => r.tmda_report_number },
  { header: "Date Received", width: 110, cell: (r) => r.date_received },
  { header: "Device Brand Name", width: 150, cell: (r) => r.device_brand_name },
  { header: "Device Common Name", width: 150, cell: (r) => r.device_common_name },
  { header: "Size", width: 80, cell: (r) => r.size },
  { header: "Batch/Lot/Serial Number", width: 120, cell: (r) => r.batch_lot_serial_number },
  { header: "Device Type", width: 90, cell: (r) => r.device_type },
  { header: "Manufacturing Date", width: 105, cell: (r) => r.manufacturing_date },
  { header: "Expiry Date", width: 105, cell: (r) => r.expiry_date },
  {
    header: "Name and Physical Address of Manufacturer",
    width: 240,
    narrative: true,
    cell: (r) => r.manufacturer_name_address,
  },
  { header: "Manufacturing Country", width: 120, cell: (r) => r.manufacturing_country },
  {
    header: "Name of the Supplier (If applicable)",
    width: 160,
    cell: (r) => r.supplier_name,
  },
  // The one field that is always a paragraph. 320px is as wide as a single column may be without
  // starting to dominate a 56-column sheet, and the preview below is what keeps the row compact —
  // widening it further was the wrong lever and is why this note is here.
  {
    header: "Adverse Event(s)/Incident(s) Description",
    width: 320,
    narrative: true,
    cell: (r) => r.event_description,
  },
  {
    header: "Date of Onset of Event(s)/Incident(s)",
    width: 140,
    cell: (r) => r.date_onset_event,
  },
  { header: "Date of the Report", width: 120, cell: (r) => r.date_report },
  {
    header: "Place/Location of Event(s)/Incident(s)",
    width: 180,
    narrative: true,
    cell: (r) => r.event_location,
  },
  { header: "Region", width: 100, cell: (r) => r.region },
  { header: "Type of Report", width: 100, cell: (r) => r.type_of_report },
  {
    header: "Reporter Details (Name / Contact Information)",
    width: 240,
    narrative: true,
    cell: (r) => r.reporter_details,
  },
  { header: "Event Seriousness (Yes/No)", width: 120, cell: (r) => r.event_seriousness },
  {
    header: "Preferred Term - Device Component Level 1",
    width: 160,
    cell: (r) => r.device_component_level_1,
  },
  {
    header: "Preferred Term - Device Component Level 2",
    width: 160,
    cell: (r) => r.device_component_level_2,
  },
  {
    header: "Preferred Term - Device Component Level 3",
    width: 160,
    cell: (r) => r.device_component_level_3,
  },
  {
    header: "Device Component IMDRF Codes #",
    width: 130,
    cell: (r) => r.device_component_codes,
  },
  {
    header: "Preferred Term - Device Problem Level 1",
    width: 160,
    cell: (r) => r.device_problem_level_1,
  },
  {
    header: "Preferred Term - Device Problem Level 2",
    width: 160,
    cell: (r) => r.device_problem_level_2,
  },
  {
    header: "Preferred Term - Device Problem Level 3",
    width: 160,
    cell: (r) => r.device_problem_level_3,
  },
  {
    header: "Device Problem IMDRF Codes #",
    width: 130,
    cell: (r) => r.device_problem_codes,
  },
  {
    header: "Preferred Term - Clinical Sign Level 1",
    width: 160,
    cell: (r) => r.clinical_sign_level_1,
  },
  {
    header: "Preferred Term - Clinical Sign Level 2",
    width: 160,
    cell: (r) => r.clinical_sign_level_2,
  },
  {
    header: "Preferred Term - Clinical Sign Level 3",
    width: 160,
    cell: (r) => r.clinical_sign_level_3,
  },
  {
    header: "Clinical Signs IMDRF Codes #",
    width: 130,
    cell: (r) => r.clinical_sign_codes,
  },
  {
    header: "Preferred Term - Health Impact Level 1",
    width: 160,
    cell: (r) => r.health_impact_level_1,
  },
  {
    header: "Preferred Term - Health Impact Level 2",
    width: 160,
    cell: (r) => r.health_impact_level_2,
  },
  {
    header: "Preferred Term - Health Impact Level 3",
    width: 160,
    cell: (r) => r.health_impact_level_3,
  },
  {
    header: "Health Impact IMDRF Codes #",
    width: 130,
    cell: (r) => r.health_impact_codes,
  },
  {
    header: "Cause of Investigation - Type of Investigation IMDRF Codes #",
    width: 170,
    cell: (r) => r.investigation_type_codes,
  },
  {
    header: "Preferred Term - Investigation Finding Level 1",
    width: 170,
    cell: (r) => r.investigation_finding_level_1,
  },
  {
    header: "Cause of Investigation - Investigation Finding IMDRF Codes #",
    width: 170,
    cell: (r) => r.investigation_finding_codes,
  },
  // Excel AO carries the same label as AM (TMDA worksheet has a duplicate
  // "Level 1" header here); kept verbatim so the register matches the source
  // document column-for-column. The backing field is the second investigation
  // finding column and is stored separately from AM.
  {
    header: "Preferred Term - Investigation Finding Level 1",
    width: 170,
    cell: (r) => r.investigation_finding_level_2,
  },
  {
    header: "Preferred Term - Type/Cause of Investigation Level 2",
    width: 170,
    cell: (r) => r.investigation_type_cause_level_2,
  },
  {
    header: "Preferred Term - Type/Cause of Investigation Level 3",
    width: 170,
    cell: (r) => r.investigation_type_cause_level_3,
  },
  {
    header: "Cause of Investigation - Investigation Conclusion IMDRF Codes #",
    width: 170,
    cell: (r) => r.investigation_conclusion_codes,
  },
  {
    header: "Preferred Term - Investigation Conclusion Level 1",
    width: 170,
    cell: (r) => r.investigation_conclusion_level_1,
  },
  {
    header: "Preferred Term - Investigation Conclusion Level 2",
    width: 170,
    cell: (r) => r.investigation_conclusion_level_2,
  },
  {
    header: "Investigation Status of the AEs/AIs (Done/Not Done)",
    width: 150,
    cell: (r) => r.investigation_status,
  },
  {
    header: "Causality Assessment (Unrelated, Possible, Probable & Certain)",
    width: 170,
    cell: (r) => r.causality_assessment,
  },
  {
    header: "Risk Assessment (Critical/High/Medium/Low)",
    width: 150,
    cell: (r) => r.risk_assessment,
  },
  {
    header: "Regulatory Action(s) Taken",
    width: 260,
    narrative: true,
    cell: (r) => r.regulatory_action,
  },
  { header: "1st Assessor Name", width: 140, cell: (r) => r.assessor_1_name },
  { header: "Date of Assessment", width: 120, cell: (r) => r.date_assessment_1 },
  { header: "2nd Assessor Name", width: 140, cell: (r) => r.assessor_2_name },
  { header: "Date of Assessment", width: 120, cell: (r) => r.date_assessment_2 },
  {
    header: "Acknowledgement / Feedback",
    width: 240,
    narrative: true,
    cell: (r) => r.acknowledgement_feedback,
  },
];

/**
 * How many lines of a value the register shows before it becomes a preview.
 *
 * Three for an ordinary column, four for a narrative one. Both are enforced in CSS (`.rg-text`,
 * `.rg-narrative`) — the numbers are repeated here only to decide which cells get the control that
 * opens the rest, and the two must stay in step.
 */
const PREVIEW_LINES = 3;
const NARRATIVE_PREVIEW_LINES = 4;

/** `padding: 8px 10px` on `.register-table td`, so 20px of a column is never text. */
const CELL_PADDING_PX = 20;
/**
 * Average glyph advance at the table's 12.5px system font, measured against the longest headers
 * on the sheet. Deliberately a little narrow: erring towards "this will not fit" offers the reader
 * the full value on a cell that would have just fitted, which is a smaller fault than clipping a
 * regulatory value with no way to see the rest.
 */
const AVG_CHAR_PX = 6.2;

/**
 * Whether a value is longer than the lines its own column can show.
 *
 * This — not the field name — is what decides that a cell is rendered as a preview. A register is
 * mostly dates, codes and picked terms that always fit, and giving every one of them a control
 * that opens a dialog on the same text already on screen would be noise. Asking the value means a
 * genuinely long device name gets the same treatment as a genuinely long narrative, and a short
 * narrative gets none.
 */
export function cellOverflows(col: RegisterColumn, text: string): boolean {
  const lines = col.narrative ? NARRATIVE_PREVIEW_LINES : PREVIEW_LINES;
  const charsPerLine = Math.max(6, Math.floor((col.width - CELL_PADDING_PX) / AVG_CHAR_PX));
  return text.length > charsPerLine * lines;
}

/** Only S/N stays put while every later column — TMDA report number, date received, and the rest — scrolls. See `.rg-c1` in the stylesheet. */
const STICKY_COUNT = 1;

function stickyClass(index: number): string | undefined {
  return index < STICKY_COUNT ? `rg-c${index + 1}` : undefined;
}

export function RegisterPage({ rows, viewerRole, viewerName }: RegisterPageProps): JSX.Element {
  return (
    <StaffShell
      title="Register | e-Reports"
      pageTitle="Register"
      role={viewerRole}
      fullName={viewerName}
      active="register"
      registerDownload
    >
      <div class="register-page">
        <div class="staff-head">
          <div class="sp">
            <p class="register-title" safe>
              MEDICAL DEVICE AND IN VITRO DIAGNOSTIC ADVERSE EVENTS/INCIDENTS REGISTER
            </p>
            <p class="hint">
              TMDA/DMD/MDV/R/002 Rev #: 01 · {rows.length} record{rows.length === 1 ? "" : "s"}
            </p>
          </div>
          <div class="register-toolbar">
            <input
              type="search"
              class="register-search"
              placeholder="Search report number, device, manufacturer…"
              id="search-register"
              aria-label="Search the register"
            />
            <a
              class="btn register-download"
              href="/register/download/xlsx"
              data-download
              data-default-label="Download Register"
              data-loading-label="Downloading…"
              data-error-label="Download failed — try again"
            >
              <svg
                class="register-download-icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M12 3v11" />
                <path d="M7.5 10.5L12 15l4.5-4.5" />
                <path d="M4 17.5v2A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-2" />
              </svg>
              <svg
                class="register-download-spinner"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <circle cx="12" cy="12" r="9" />
              </svg>
              <span class="register-download-label" safe>
                Download Register
              </span>
            </a>
          </div>
        </div>

        {rows.length === 0 ? (
          <p class="hint">No adverse events or incidents have been recorded yet.</p>
        ) : (
          // Wider than a narrow window on purpose — see `.tscroll`/`.register-scroll` in the
          // stylesheet. This box scrolls sideways; the page around it does not.
          <div class="tscroll register-scroll">
            <table class="register-table">
              {/* `width` as the plain HTML attribute, not a CSS `style`: this browser's
                `table-layout: fixed` column-sizing algorithm silently ignores a `<col>`'s CSS
                `width` and falls back to distributing space by each cell's content, which is
                exactly the "columns overlap, headers get clipped" failure this page had. The
                legacy attribute is what the fixed-layout algorithm actually keys off. */}
              <colgroup>
                {COLUMNS.map((col) => {
                  // kitajs/html's `col` type omits the legacy `width` attribute (it's deprecated
                  // HTML), but it is what the fixed-layout algorithm actually reads — see the
                  // comment above — so it is cast in explicitly rather than left off.
                  const colProps = { width: String(col.width) } as JSX.IntrinsicElements["col"];
                  return <col {...colProps} />;
                })}
              </colgroup>
              <thead>
                <tr>
                  {COLUMNS.map((col, i) => (
                    <th class={stickyClass(i)} safe>
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  // The row's own identity, for the dialog a preview opens: a value shown out of
                  // the table needs to say which record it belongs to.
                  <tr data-rg-row={row.tmda_report_number || `S/N ${row.sn}`}>
                    {COLUMNS.map((col, i) => {
                      const value = col.cell(row);
                      const isEmpty = value === "" || value === null || value === undefined;
                      const text = isEmpty ? "" : String(value);
                      const textClass = col.narrative ? "rg-text rg-narrative" : "rg-text";

                      if (isEmpty) {
                        return (
                          <td class={stickyClass(i)}>
                            <span class="rg-empty">—</span>
                          </td>
                        );
                      }

                      /*
                       * The whole value is in the document either way — clipped by CSS, never cut
                       * here. That is what keeps the search below, the Excel export and assistive
                       * technology reading the record rather than the preview of it.
                       */
                      // The report number is the row's own way into its case: the Register is the
                      // index, and a case's full record — the Orange Report, every assessment,
                      // every manager decision — lives at the case-detail page this links to.
                      if (col.header === "TMDA Report Number") {
                        return (
                          <td class={stickyClass(i)}>
                            <a href={`/register/${row.reportId}`} class={textClass} safe>
                              {text}
                            </a>
                          </td>
                        );
                      }

                      return (
                        <td class={stickyClass(i)}>
                          {cellOverflows(col, text) ? (
                            <button
                              type="button"
                              class="rg-open"
                              data-rg-open
                              data-rg-label={col.header}
                              aria-haspopup="dialog"
                            >
                              <span class={textClass} safe>
                                {text}
                              </span>
                              <span class="rg-more" aria-hidden="true">
                                Show all
                              </span>
                            </button>
                          ) : (
                            <span class={textClass} safe>
                              {text}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/*
          Where a previewed cell shows the rest of itself.

          The page's one dialog, reusing the shell's `.modal` conventions rather than a second
          modal system: `showModal()` is what buys the backdrop, the focus trap and Escape, and
          `method="dialog"` is what makes Close need no script. Rendered once and filled by
          `register.js` from the cell that was clicked, so a register of five hundred rows carries
          one dialog rather than one per long value.
        */}
        <dialog class="modal rg-modal" data-rg-dialog aria-labelledby="rg-modal-title">
          <div class="modal-body">
            <p class="eyebrow" data-rg-dialog-row></p>
            {/* The column's name replaces this the moment a cell is opened; the wording only
                stands in for the fraction of a second before then, and gives the heading the
                content a screen reader is entitled to find. */}
            <h2 id="rg-modal-title" data-rg-dialog-label>
              Register value
            </h2>
            <p class="rg-modal-value" data-rg-dialog-value></p>

            <form method="dialog" class="bar modal-actions">
              <button type="submit" class="btn ghost">
                Close
              </button>
            </form>
          </div>
        </dialog>
      </div>

      <script>{`
        const search = document.getElementById('search-register');
        if (search) {
          /*
           * textContent, not innerText: a cell whose value is clipped to a few lines is still in
           * the document in full, and searching what is rendered rather than what is stored would
           * quietly stop finding words inside a long narrative — the one place a register search
           * matters most.
           */
          const rows = Array.from(document.querySelectorAll('.register-table tbody tr')).map(
            function (row) {
              // The values only. A preview cell also carries a 'Show all' affordance, and a
              // register where typing 'show' matched every long row would be a search of the
              // furniture rather than of the record.
              const text = Array.from(row.querySelectorAll('.rg-text'))
                .map(function (cell) { return cell.textContent || ''; })
                .join(' ')
                .toLowerCase();
              return { row: row, text: text };
            }
          );
          search.addEventListener('input', function () {
            const q = this.value.trim().toLowerCase();
            rows.forEach(function (entry) {
              entry.row.hidden = q.length > 0 && !entry.text.includes(q);
            });
          });
        }
      `}</script>
    </StaffShell>
  );
}
