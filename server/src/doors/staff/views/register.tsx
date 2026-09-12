import { StaffShell } from "./shell.js";

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
 *
 * Header strings mirror the TMDA Adverse Events/Incidents Register worksheet
 * (TMDA/DMD/MDV/R/002) column-for-column, with typos in the worksheet corrected.
 */
const COLUMNS: ReadonlyArray<{
  header: string;
  width: number;
  cell: (row: RegisterRow) => string | number;
}> = [
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
    width: 220,
    cell: (r) => r.manufacturer_name_address,
  },
  { header: "Manufacturing Country", width: 120, cell: (r) => r.manufacturing_country },
  {
    header: "Name of the Supplier (If applicable)",
    width: 160,
    cell: (r) => r.supplier_name,
  },
  {
    header: "Adverse Event(s)/Incident(s) Description",
    width: 220,
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
    cell: (r) => r.event_location,
  },
  { header: "Region", width: 100, cell: (r) => r.region },
  { header: "Type of Report", width: 100, cell: (r) => r.type_of_report },
  {
    header: "Reporter Details (Name / Contact Information)",
    width: 220,
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
  {
    header: "Preferred Term - Investigation Finding Level 2",
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
  { header: "Regulatory Action(s) Taken", width: 210, cell: (r) => r.regulatory_action },
  { header: "1st Assessor Name", width: 140, cell: (r) => r.assessor_1_name },
  { header: "Date of Assessment", width: 120, cell: (r) => r.date_assessment_1 },
  { header: "2nd Assessor Name", width: 140, cell: (r) => r.assessor_2_name },
  { header: "Date of Assessment", width: 120, cell: (r) => r.date_assessment_2 },
  { header: "Acknowledgement / Feedback", width: 190, cell: (r) => r.acknowledgement_feedback },
];

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
                  <tr>
                    {COLUMNS.map((col, i) => {
                      const value = col.cell(row);
                      const isEmpty = value === "" || value === null || value === undefined;
                      return (
                        <td class={stickyClass(i)}>
                          {isEmpty ? <span class="rg-empty">—</span> : <span safe>{value}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <script>{`
        const search = document.getElementById('search-register');
        if (search) {
          search.addEventListener('input', function () {
            const q = this.value.toLowerCase();
            document.querySelectorAll('.register-table tbody tr').forEach(function (row) {
              row.hidden = q.length > 0 && !row.innerText.toLowerCase().includes(q);
            });
          });
        }
      `}</script>
    </StaffShell>
  );
}