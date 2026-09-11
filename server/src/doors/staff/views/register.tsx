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

export function RegisterPage({
  rows,
  viewerRole,
  viewerName,
}: RegisterPageProps): JSX.Element {
  return (
    <StaffShell
      title="Register | e-Reports"
      pageTitle="Register"
      role={viewerRole}
      fullName={viewerName}
      active="register"
    >
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#f5f7f9" }}>
        <div style={{ padding: "20px 24px", background: "#fff", borderBottom: "1px solid #dbe2e6" }}>
          <h1 style={{ margin: "0 0 8px 0", fontSize: "20px", fontWeight: 700, color: "#263640" }}>
            MEDICAL DEVICE AND IN VITRO DIAGNOSTIC ADVERSE EVENTS/INCIDENTS REGISTER
          </h1>
          <p style={{ margin: "0", fontSize: "12px", color: "#687681" }}>
            TMDA/DMD/MDV/R/002 Rev #: 01
          </p>
        </div>

        <div style={{ padding: "12px 24px", background: "#fff", borderBottom: "1px solid #e4e9ec", display: "flex", gap: "12px", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Search by Report Number, Device, Manufacturer..."
            style={{
              flex: "1",
              padding: "8px 12px",
              border: "1px solid #cbd5db",
              borderRadius: "6px",
              fontSize: "13px",
              fontFamily: "inherit",
            }}
            id="search-register"
          />
          <span style={{ fontSize: "12px", color: "#687681", whiteSpace: "nowrap" }}>
            {rows.length} records
          </span>
        </div>

        <div style={{ flex: "1", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ overflow: "auto", flex: "1" }}>
            <table
              style={{
                borderCollapse: "collapse",
                width: "100%",
                fontSize: "12px",
                fontFamily: "inherit",
                background: "#fff",
              }}
            >
              <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                <tr style={{ background: "#2c3e50", color: "#fff" }}>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "40px" }}>S/N</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "110px" }}>TMDA Report Number</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "95px" }}>Date Received</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "110px" }}>Device Brand Name</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "110px" }}>Device Common Name</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "70px" }}>Size</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "95px" }}>Batch/Lot/Serial</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "85px" }}>Device Type</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "95px" }}>Manufacturing Date</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "85px" }}>Expiry Date</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "130px" }}>Manufacturer</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "110px" }}>Manufacturing Country</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "110px" }}>Supplier</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "180px" }}>Adverse Event Description</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "95px" }}>Date of Onset</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "90px" }}>Report Date</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "110px" }}>Event Location</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "90px" }}>Region</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "85px" }}>Report Type</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "130px" }}>Reporter Details</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "80px" }}>Seriousness</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "120px" }}>Device Component L1</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "120px" }}>Device Component L2</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "120px" }}>Device Component L3</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "100px" }}>Component IMDRF</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "120px" }}>Device Problem L1</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "120px" }}>Device Problem L2</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "120px" }}>Device Problem L3</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "100px" }}>Problem IMDRF</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "120px" }}>Clinical Sign L1</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "120px" }}>Clinical Sign L2</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "120px" }}>Clinical Sign L3</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "100px" }}>Sign IMDRF</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "120px" }}>Health Impact L1</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "120px" }}>Health Impact L2</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "120px" }}>Health Impact L3</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "100px" }}>Impact IMDRF</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "100px" }}>Investigation Type</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "120px" }}>Investigation Finding</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "100px" }}>Finding IMDRF</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "90px" }}>Investigation Status</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "100px" }}>Causality</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "90px" }}>Risk Level</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "130px" }}>Regulatory Action</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "110px" }}>1st Assessor Name</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "90px" }}>1st Assessment Date</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "110px" }}>2nd Assessor Name</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, borderRight: "1px solid #34495e", minWidth: "90px" }}>2nd Assessment Date</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, minWidth: "130px" }}>Acknowledgement/Feedback</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    style={{
                      background: idx % 2 === 0 ? "#ffffff" : "#f8fafb",
                    }}
                  >
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec", fontWeight: 500 }}>{row.sn}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.tmda_report_number}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.date_received}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.device_brand_name}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.device_common_name}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.size}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.batch_lot_serial_number}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.device_type}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.manufacturing_date}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.expiry_date}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.manufacturer_name_address}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.manufacturing_country}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.supplier_name}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.event_description}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.date_onset_event}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.date_report}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.event_location}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.region}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.type_of_report}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.reporter_details}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.event_seriousness}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.device_component_level_1}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.device_component_level_2}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.device_component_level_3}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.device_component_codes}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.device_problem_level_1}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.device_problem_level_2}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.device_problem_level_3}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.device_problem_codes}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.clinical_sign_level_1}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.clinical_sign_level_2}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.clinical_sign_level_3}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.clinical_sign_codes}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.health_impact_level_1}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.health_impact_level_2}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.health_impact_level_3}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.health_impact_codes}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.investigation_type_codes}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.investigation_finding_level_1}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.investigation_finding_codes}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.investigation_status}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.causality_assessment}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.risk_assessment}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.regulatory_action}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.assessor_1_name}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.date_assessment_1}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.assessor_2_name}</td>
                    <td style={{ padding: "9px 8px", borderRight: "1px solid #e4e9ec", borderBottom: "1px solid #e4e9ec" }}>{row.date_assessment_2}</td>
                    <td style={{ padding: "9px 8px", borderBottom: "1px solid #e4e9ec" }}>{row.acknowledgement_feedback}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <script>{`
        const search = document.getElementById('search-register');
        if (search) {
          search.addEventListener('input', function() {
            const q = this.value.toLowerCase();
            document.querySelectorAll('tbody tr').forEach(row => {
              row.style.display = row.innerText.toLowerCase().includes(q) ? '' : 'none';
            });
          });
        }
      `}</script>
    </StaffShell>
  );
}
