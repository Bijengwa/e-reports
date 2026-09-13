import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Database } from "../../../../db/client.js";
import {
  f004AnswersForRegister,
  formatReporterDetails,
  mapF004ToRegisterCells,
} from "../../../../domain/register.js";
import { buildRegisterXlsx, registerExportFilename } from "../../register-export.js";
import { currentSession } from "../../session-guard.js";
import { RegisterPage, type RegisterRow } from "../pages/register.js";

type RegisterQueryRow = {
  report_id: string;
  tmda_report_number: string | null;
  date_received: string | null;
  device_brand_name: string | null;
  device_name: string | null;
  size: string | null;
  batch_lot_serial_number: string | null;
  device_type: string | null;
  manufacturing_date: string | null;
  expiry_date: string | null;
  manufacturer_name_address: string | null;
  manufacturing_country: string | null;
  supplier_name: string | null;
  event_description: string | null;
  date_onset_event: string | null;
  date_report: string | null;
  event_location: string | null;
  region: string | null;
  reporter_name: string | null;
  reporter_phone: string | null;
  event_seriousness: string | null;
  final_payload: unknown;
  a1_payload: unknown;
  assessor_1_name: string | null;
  date_assessment_1: string | null;
  assessor_2_name: string | null;
  date_assessment_2: string | null;
};

function cell(value: string | null | undefined): string {
  return value ?? "";
}

async function loadRegisterRows(db: Database): Promise<ReadonlyArray<RegisterRow>> {
  const rows = await db.execute(sql`
    SELECT
      r.id as report_id,
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
      (r.payload->>'reporter_name')::text as reporter_name,
      (r.payload->>'phone')::text as reporter_phone,
      CASE WHEN r.severity != 'other' THEN 'Yes' ELSE 'No' END as event_seriousness,
      f.payload as final_payload,
      CASE WHEN a1.submitted_at IS NOT NULL THEN a1.payload ELSE NULL END as a1_payload,
      COALESCE(u1.full_name, '')::text as assessor_1_name,
      TO_CHAR(a1.submitted_at, 'DD/MM/YYYY') as date_assessment_1,
      COALESCE(u2.full_name, '')::text as assessor_2_name,
      TO_CHAR(a2.submitted_at, 'DD/MM/YYYY') as date_assessment_2
    FROM reports r
    LEFT JOIN report_final_documents f ON f.report_id = r.id
    LEFT JOIN assessments a1 ON a1.report_id = r.id AND a1.ordinal = 1
    LEFT JOIN users u1 ON u1.id = a1.assessor_id
    LEFT JOIN assessments a2 ON a2.report_id = r.id AND a2.ordinal = 2
    LEFT JOIN users u2 ON u2.id = a2.assessor_id
    ORDER BY r.received_at DESC, r.number DESC
    LIMIT 500
  `);

  return rows.map((raw, idx) => {
    const row = raw as RegisterQueryRow;
    const f004 = mapF004ToRegisterCells(f004AnswersForRegister(row.final_payload, row.a1_payload));

    return {
      reportId: row.report_id,
      sn: idx + 1,
      tmda_report_number: cell(row.tmda_report_number),
      date_received: cell(row.date_received),
      device_brand_name: cell(row.device_brand_name),
      device_common_name: cell(row.device_name),
      size: cell(row.size),
      batch_lot_serial_number: cell(row.batch_lot_serial_number),
      device_type: cell(row.device_type),
      manufacturing_date: cell(row.manufacturing_date),
      expiry_date: cell(row.expiry_date),
      manufacturer_name_address: cell(row.manufacturer_name_address),
      manufacturing_country: cell(row.manufacturing_country),
      supplier_name: cell(row.supplier_name),
      event_description: cell(row.event_description),
      date_onset_event: cell(row.date_onset_event),
      date_report: cell(row.date_report),
      event_location: cell(row.event_location),
      region: cell(row.region),
      reporter_details: formatReporterDetails(cell(row.reporter_name), cell(row.reporter_phone)),
      event_seriousness: cell(row.event_seriousness),
      assessor_1_name: cell(row.assessor_1_name),
      date_assessment_1: cell(row.date_assessment_1),
      assessor_2_name: cell(row.assessor_2_name),
      date_assessment_2: cell(row.date_assessment_2),
      ...f004,
    };
  });
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/register", async (request, reply) => {
    const session = currentSession(request);
    const rows = await loadRegisterRows(app.db);

    return reply.html(
      <RegisterPage rows={rows} viewerRole={session.role} viewerName={session.fullName} />,
    );
  });

  app.get("/register/download/xlsx", async (_request, reply) => {
    const rows = await loadRegisterRows(app.db);
    const body = await buildRegisterXlsx(rows);
    const filename = registerExportFilename();
    return reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(body);
  });
}



