import { StaffShell } from "./shell.js";

export type RegisterRow = {
  reportId: string;
  sn: number; // Row sequence
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
 * The institutional Medical Device and In Vitro Diagnostic Adverse Events/Incidents Register.
 *
 * Read-only view. Data is automatically populated from the existing Orange Report → Assessment → Manager Decision workflow.
 * This page structure preserves the authoritative Excel Register columns.
 */
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
      <div style={{ padding: "24px" }}>
        <div style={{ marginBottom: "24px" }}>
          <h1
            style={{
              margin: "0 0 8px 0",
              fontSize: "24px",
              fontWeight: 700,
            }}
          >
            MEDICAL DEVICE AND IN VITRO DIAGNOSTIC ADVERSE EVENTS/INCIDENTS REGISTER
          </h1>
          <p
            style={{
              margin: "0 0 16px 0",
              fontSize: "13px",
              color: "#64727d",
            }}
          >
            TMDA/DMD/MDV/R/002 Rev #: 01
          </p>
          <p
            style={{
              margin: "0",
              fontSize: "12px",
              color: "#999",
              fontStyle: "italic",
            }}
          >
            ⚠️ Mock data for UI demonstration — not production records
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: "12px",
            marginBottom: "16px",
            alignItems: "center",
          }}
        >
          <input
            type="text"
            placeholder="Search: TMDA Report Number, Device, Manufacturer..."
            style={{
              flex: "1",
              padding: "9px 11px",
              border: "1px solid #cbd5db",
              borderRadius: "7px",
              fontSize: "13px",
              fontFamily: "Segoe UI, Arial, sans-serif",
            }}
            id="search-register"
          />
          <span
            style={{
              marginLeft: "auto",
              fontSize: "12px",
              color: "#65737d",
            }}
          >
            {rows.length} records
          </span>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #dbe2e6",
            borderRadius: "12px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              overflowX: "auto",
              maxHeight: "75vh",
              overflowY: "auto",
            }}
          >
            <table
              style={{
                borderCollapse: "collapse",
                width: "100%",
                minWidth: "2400px",
                fontSize: "12px",
                fontFamily: "Segoe UI, Arial, sans-serif",
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "#eaf1f3",
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
                  }}
                >
                  <th
                    style={{
                      padding: "9px 10px",
                      textAlign: "left",
                      fontWeight: 700,
                      color: "#263640",
                      borderRight: "1px solid #e2e8eb",
                      borderBottom: "1px solid #e2e8eb",
                      position: "sticky",
                      left: 0,
                      background: "#e2ecef",
                      zIndex: 3,
                      minWidth: "40px",
                    }}
                  >
                    S/N
                  </th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "120px" }}>TMDA Report Number</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "100px" }}>Date Received</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "120px" }}>Device Brand Name</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "120px" }}>Device Common Name</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "80px" }}>Size</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "100px" }}>Batch/Lot/Serial</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "100px" }}>Device Type</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "100px" }}>Manufacturing Date</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "100px" }}>Expiry Date</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "150px" }}>Manufacturer</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "120px" }}>Country</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "120px" }}>Supplier</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "200px" }}>Event Description</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "100px" }}>Date of Onset</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "100px" }}>Date of Report</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "120px" }}>Location</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "100px" }}>Region</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "100px" }}>Type of Report</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "150px" }}>Reporter Details</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "120px" }}>Seriousness</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "100px" }}>Causality</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "100px" }}>Risk</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "150px" }}>Regulatory Action</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "120px" }}>1st Assessor</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "100px" }}>Date Assessed</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "120px" }}>2nd Assessor</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "100px" }}>Date Assessed</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#263640", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb", minWidth: "150px" }}>Acknowledgement/Feedback</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    style={{
                      background: "#fff",
                    }}
                  >
                    <td
                      style={{
                        padding: "9px 10px",
                        borderRight: "1px solid #e2e8eb",
                        borderBottom: "1px solid #e2e8eb",
                        fontWeight: 600,
                        position: "sticky",
                        left: 0,
                        background: "#fff",
                        zIndex: 1,
                      }}
                    >
                      {row.sn}
                    </td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.tmda_report_number}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.date_received}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.device_brand_name}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.device_common_name}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.size}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.batch_lot_serial_number}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.device_type}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.manufacturing_date}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.expiry_date}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.manufacturer_name_address}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.manufacturing_country}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.supplier_name}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.event_description}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.date_onset_event}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.date_report}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.event_location}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.region}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.type_of_report}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.reporter_details}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.event_seriousness}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.causality_assessment}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.risk_assessment}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.regulatory_action}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.assessor_1_name}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.date_assessment_1}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.assessor_2_name}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.date_assessment_2}</td>
                    <td style={{ padding: "9px 10px", borderRight: "1px solid #e2e8eb", borderBottom: "1px solid #e2e8eb" }}>{row.acknowledgement_feedback}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div
          style={{
            padding: "11px 15px",
            color: "#687681",
            fontSize: "12px",
            marginTop: "12px",
          }}
        >
          Horizontal scrolling supports the complete institutional Register columns. All data is read-only.
        </div>
      </div>

      <script>{`
        document.getElementById('search-register').addEventListener('input', function(){
          const q = this.value.toLowerCase();
          document.querySelectorAll('tbody tr').forEach(r => {
            r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none';
          });
        });
      `}</script>
    </StaffShell>
  );
}
