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

export function RegisterPage({ rows, viewerRole, viewerName }: RegisterPageProps): JSX.Element {
  return (
    <StaffShell
      title="Register | e-Reports"
      pageTitle="Register"
      role={viewerRole}
      fullName={viewerName}
      active="register"
    >
      <style>{`
        .register-page {
          display: flex;
          flex-direction: column;
          width: 100%;
          max-width: 100%;
          min-height: 100%;
          background: #f5f7f9;
          overflow-x: hidden;
        }

        .register-header {
          padding: 20px 24px;
          background: #fff;
          border-bottom: 1px solid #dbe2e6;
          flex-shrink: 0;
        }

        .register-header h1 {
          margin: 0 0 8px 0;
          font-size: 18px;
          font-weight: 700;
          color: #263640;
          line-height: 1.3;
        }

        .register-header p {
          margin: 0;
          font-size: 12px;
          color: #687681;
        }

        .register-toolbar {
          padding: 12px 24px;
          background: #fff;
          border-bottom: 1px solid #e4e9ec;
          display: flex;
          gap: 12px;
          align-items: center;
          flex-shrink: 0;
        }

        .register-toolbar input {
          flex: 1;
          padding: 8px 12px;
          border: 1px solid #cbd5db;
          border-radius: 6px;
          font-size: 13px;
          font-family: inherit;
        }

        .register-toolbar-end {
          font-size: 12px;
          color: #687681;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .register-table-wrapper {
          flex: 1;
          min-height: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          background: #fff;
          border: 1px solid #dbe2e6;
          margin: 0 24px 24px 24px;
          border-radius: 8px;
        }

        .register-table-container {
          flex: 1;
          overflow: auto;
          -webkit-overflow-scrolling: touch;
        }

        .register-table {
          border-collapse: collapse;
          width: 100%;
          min-width: min-content;
          font-size: 12px;
          font-family: inherit;
        }

        .register-table thead {
          position: sticky;
          top: 0;
          z-index: 10;
          background: #2c3e50;
          color: #fff;
        }

        .register-table th {
          padding: 10px 8px;
          text-align: left;
          font-weight: 600;
          border-right: 1px solid #34495e;
          border-bottom: 1px solid #34495e;
          white-space: nowrap;
          min-width: 80px;
        }

        .register-table tbody tr {
          border-bottom: 1px solid #e4e9ec;
        }

        .register-table tbody tr:nth-child(odd) {
          background: #ffffff;
        }

        .register-table tbody tr:nth-child(even) {
          background: #f8fafb;
        }

        .register-table tbody tr:hover {
          background: #f0f3f7;
        }

        .register-table td {
          padding: 9px 8px;
          border-right: 1px solid #e4e9ec;
          vertical-align: top;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }

        .register-table td:last-child {
          border-right: none;
        }

        .register-table-empty {
          padding: 40px 24px;
          text-align: center;
          color: #687681;
          font-size: 13px;
        }

        @media (max-width: 768px) {
          .register-toolbar {
            flex-direction: column;
            align-items: stretch;
          }

          .register-toolbar input {
            width: 100%;
          }

          .register-table-wrapper {
            margin: 0 12px 12px 12px;
          }
        }
      `}</style>

      <div className="register-page">
        <div className="register-header">
          <h1>MEDICAL DEVICE AND IN VITRO DIAGNOSTIC ADVERSE EVENTS/INCIDENTS REGISTER</h1>
          <p>TMDA/DMD/MDV/R/002 Rev #: 01</p>
        </div>

        <div className="register-toolbar">
          <input
            type="text"
            placeholder="Search by Report Number, Device, Manufacturer..."
            id="search-register"
          />
          <span className="register-toolbar-end">{rows.length} records</span>
        </div>

        <div className="register-table-wrapper">
          {rows.length === 0 ? (
            <div className="register-table-empty">No adverse events recorded yet.</div>
          ) : (
            <div className="register-table-container">
              <table className="register-table">
                <thead>
                  <tr>
                    <th>S/N</th>
                    <th>TMDA Report Number</th>
                    <th>Date Received</th>
                    <th>Device Brand Name</th>
                    <th>Device Common Name</th>
                    <th>Size</th>
                    <th>Batch/Lot/Serial</th>
                    <th>Device Type</th>
                    <th>Manufacturing Date</th>
                    <th>Expiry Date</th>
                    <th>Manufacturer</th>
                    <th>Manufacturing Country</th>
                    <th>Supplier</th>
                    <th>Adverse Event Description</th>
                    <th>Date of Onset</th>
                    <th>Report Date</th>
                    <th>Event Location</th>
                    <th>Region</th>
                    <th>Report Type</th>
                    <th>Reporter Details</th>
                    <th>Seriousness</th>
                    <th>Device Component L1</th>
                    <th>Device Component L2</th>
                    <th>Device Component L3</th>
                    <th>Component IMDRF</th>
                    <th>Device Problem L1</th>
                    <th>Device Problem L2</th>
                    <th>Device Problem L3</th>
                    <th>Problem IMDRF</th>
                    <th>Clinical Sign L1</th>
                    <th>Clinical Sign L2</th>
                    <th>Clinical Sign L3</th>
                    <th>Sign IMDRF</th>
                    <th>Health Impact L1</th>
                    <th>Health Impact L2</th>
                    <th>Health Impact L3</th>
                    <th>Impact IMDRF</th>
                    <th>Investigation Type</th>
                    <th>Investigation Finding</th>
                    <th>Finding IMDRF</th>
                    <th>Investigation Status</th>
                    <th>Causality</th>
                    <th>Risk Level</th>
                    <th>Regulatory Action</th>
                    <th>1st Assessor Name</th>
                    <th>1st Assessment Date</th>
                    <th>2nd Assessor Name</th>
                    <th>2nd Assessment Date</th>
                    <th>Acknowledgement/Feedback</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr>
                      <td>{row.sn}</td>
                      <td>{row.tmda_report_number || "—"}</td>
                      <td>{row.date_received || "—"}</td>
                      <td>{row.device_brand_name || "—"}</td>
                      <td>{row.device_common_name || "—"}</td>
                      <td>{row.size || "—"}</td>
                      <td>{row.batch_lot_serial_number || "—"}</td>
                      <td>{row.device_type || "—"}</td>
                      <td>{row.manufacturing_date || "—"}</td>
                      <td>{row.expiry_date || "—"}</td>
                      <td>{row.manufacturer_name_address || "—"}</td>
                      <td>{row.manufacturing_country || "—"}</td>
                      <td>{row.supplier_name || "—"}</td>
                      <td>{row.event_description || "—"}</td>
                      <td>{row.date_onset_event || "—"}</td>
                      <td>{row.date_report || "—"}</td>
                      <td>{row.event_location || "—"}</td>
                      <td>{row.region || "—"}</td>
                      <td>{row.type_of_report || "—"}</td>
                      <td>{row.reporter_details || "—"}</td>
                      <td>{row.event_seriousness || "—"}</td>
                      <td>{row.device_component_level_1 || "—"}</td>
                      <td>{row.device_component_level_2 || "—"}</td>
                      <td>{row.device_component_level_3 || "—"}</td>
                      <td>{row.device_component_codes || "—"}</td>
                      <td>{row.device_problem_level_1 || "—"}</td>
                      <td>{row.device_problem_level_2 || "—"}</td>
                      <td>{row.device_problem_level_3 || "—"}</td>
                      <td>{row.device_problem_codes || "—"}</td>
                      <td>{row.clinical_sign_level_1 || "—"}</td>
                      <td>{row.clinical_sign_level_2 || "—"}</td>
                      <td>{row.clinical_sign_level_3 || "—"}</td>
                      <td>{row.clinical_sign_codes || "—"}</td>
                      <td>{row.health_impact_level_1 || "—"}</td>
                      <td>{row.health_impact_level_2 || "—"}</td>
                      <td>{row.health_impact_level_3 || "—"}</td>
                      <td>{row.health_impact_codes || "—"}</td>
                      <td>{row.investigation_type_codes || "—"}</td>
                      <td>{row.investigation_finding_level_1 || "—"}</td>
                      <td>{row.investigation_finding_codes || "—"}</td>
                      <td>{row.investigation_status || "—"}</td>
                      <td>{row.causality_assessment || "—"}</td>
                      <td>{row.risk_assessment || "—"}</td>
                      <td>{row.regulatory_action || "—"}</td>
                      <td>{row.assessor_1_name || "—"}</td>
                      <td>{row.date_assessment_1 || "—"}</td>
                      <td>{row.assessor_2_name || "—"}</td>
                      <td>{row.date_assessment_2 || "—"}</td>
                      <td>{row.acknowledgement_feedback || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <script>{`
        const search = document.getElementById('search-register');
        if (search) {
          search.addEventListener('input', function() {
            const q = this.value.toLowerCase();
            document.querySelectorAll('.register-table tbody tr').forEach(row => {
              row.style.display = row.innerText.toLowerCase().includes(q) ? '' : 'none';
            });
          });
        }
      `}</script>
    </StaffShell>
  );
}
