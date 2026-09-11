import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { currentSession } from "../session-guard.js";
import { RegisterPage, type RegisterRow } from "../views/register.js";

async function getRegisterData(app: FastifyInstance): Promise<ReadonlyArray<RegisterRow>> {
  const rows = await app.db.execute(sql`
    SELECT
      r.id as report_id,
      ROW_NUMBER() OVER (ORDER BY r.received_at DESC, r.number DESC) as sn,
      r.number as tmda_report_number,
      TO_CHAR(r.received_at, 'YYYY-MM-DD') as date_received,
      (r.payload->>'brand_name')::text as device_brand_name,
      r.device_name,
      (r.payload->>'size')::text as size,
      COALESCE((r.payload->>'batch_number'), (r.payload->>'serial_number'), '')::text as batch_lot_serial_number,
      (r.payload->>'device_type')::text as device_type,
      (r.payload->>'manufacturing_date')::text as manufacturing_date,
      (r.payload->>'expiry_date')::text as expiry_date,
      CONCAT(COALESCE((r.payload->>'manufacturer'), ''), ' ', COALESCE((r.payload->>'manufacturer_address'), ''))::text as manufacturer_name_address,
      (r.payload->>'manufacturing_country')::text as manufacturing_country,
      (r.payload->>'supplier')::text as supplier_name,
      (r.payload->>'incident_narrative')::text as event_description,
      (r.payload->>'incident_date')::text as date_onset_event,
      (r.payload->>'report_date')::text as date_report,
      (r.payload->>'device_location')::text as event_location,
      (r.payload->>'location')::text as region,
      r.channel as type_of_report,
      CONCAT(COALESCE((r.payload->>'reporter_name'), ''), ' ', COALESCE((r.payload->>'phone'), ''))::text as reporter_details,
      CASE WHEN r.severity != 'other' THEN 'Yes' ELSE 'No' END as event_seriousness,
      COALESCE(f.payload->'answers'->>'causality', '')::text as causality_assessment,
      COALESCE(f.payload->'answers'->>'risk_level', '')::text as risk_assessment,
      COALESCE(f.payload->'answers'->>'regulatory_action', '')::text as regulatory_action,
      COALESCE(u1.full_name, '')::text as assessor_1_name,
      TO_CHAR(a1.submitted_at, 'DD/MM/YYYY') as date_assessment_1,
      COALESCE(u2.full_name, '')::text as assessor_2_name,
      TO_CHAR(a2.submitted_at, 'DD/MM/YYYY') as date_assessment_2,
      ''::text as acknowledgement_feedback
    FROM reports r
    LEFT JOIN report_final_documents f ON f.report_id = r.id
    LEFT JOIN assessments a1 ON a1.report_id = r.id AND a1.ordinal = 1
    LEFT JOIN users u1 ON u1.id = a1.assessor_id
    LEFT JOIN assessments a2 ON a2.report_id = r.id AND a2.ordinal = 2
    LEFT JOIN users u2 ON u2.id = a2.assessor_id
    ORDER BY r.received_at DESC, r.number DESC
    LIMIT 500
  `);

  return rows.map((row: any, idx) => ({
    reportId: row.report_id,
    sn: idx + 1,
    tmda_report_number: row.tmda_report_number || "",
    date_received: row.date_received || "",
    device_brand_name: row.device_brand_name || "",
    device_common_name: row.device_name || "",
    size: row.size || "",
    batch_lot_serial_number: row.batch_lot_serial_number || "",
    device_type: row.device_type || "",
    manufacturing_date: row.manufacturing_date || "",
    expiry_date: row.expiry_date || "",
    manufacturer_name_address: row.manufacturer_name_address || "",
    manufacturing_country: row.manufacturing_country || "",
    supplier_name: row.supplier_name || "",
    event_description: row.event_description || "",
    date_onset_event: row.date_onset_event || "",
    date_report: row.date_report || "",
    event_location: row.event_location || "",
    region: row.region || "",
    type_of_report: row.type_of_report || "",
    reporter_details: row.reporter_details || "",
    event_seriousness: row.event_seriousness || "",
    device_component_level_1: "",
    device_component_level_2: "",
    device_component_level_3: "",
    device_component_codes: "",
    device_problem_level_1: "",
    device_problem_level_2: "",
    device_problem_level_3: "",
    device_problem_codes: "",
    clinical_sign_level_1: "",
    clinical_sign_level_2: "",
    clinical_sign_level_3: "",
    clinical_sign_codes: "",
    health_impact_level_1: "",
    health_impact_level_2: "",
    health_impact_level_3: "",
    health_impact_codes: "",
    investigation_type_codes: "",
    investigation_finding_level_1: "",
    investigation_finding_codes: "",
    investigation_status: "",
    causality_assessment: row.causality_assessment || "",
    risk_assessment: row.risk_assessment || "",
    regulatory_action: row.regulatory_action || "",
    assessor_1_name: row.assessor_1_name || "",
    date_assessment_1: row.date_assessment_1 || "",
    assessor_2_name: row.assessor_2_name || "",
    date_assessment_2: row.date_assessment_2 || "",
    acknowledgement_feedback: row.acknowledgement_feedback || "",
  }));
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/register", async (request, reply) => {
    const session = currentSession(request);
    const rows = await getRegisterData(app);

    return reply.html(
      <RegisterPage rows={rows} viewerRole={session.role} viewerName={session.fullName} />,
    );
  });
}
