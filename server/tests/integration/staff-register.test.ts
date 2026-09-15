import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/auth/password.js";
import type { Config } from "../../src/config.js";
import type { DatabaseHandle } from "../../src/db/client.js";
import { F004_VERSION } from "../../src/domain/f004.js";
import { FINAL_DOCUMENT_KIND } from "../../src/domain/final-document.js";
import { COLUMNS } from "../../src/doors/staff/register/pages/register.js";
import { buildServer } from "../../src/server.js";
import { INTEGRATION_ENABLED, openOwner, requireTestDatabase, truncateAll } from "./helpers.js";

const STAFF_HOST = "staff.test";
const PUBLIC_HOST = "public.test";
const PASSWORD = "a correct staff password";
const COOKIE = "__Host-ae_session";

type Role = "administrator" | "manager" | "assessor";

let owner: DatabaseHandle;
let app: FastifyInstance;

function testConfig(): Config {
  return Object.freeze({
    NODE_ENV: "test",
    LOG_LEVEL: "fatal",
    HOST: "127.0.0.1",
    PORT: 3000,
    PUBLIC_HOST,
    STAFF_HOST,
    DATABASE_URL: requireTestDatabase().appUrl,
    STORAGE_DRIVER: "filesystem",
    STORAGE_ROOT: path.join(os.tmpdir(), "e-reports-test-storage"),
    MAX_UPLOAD_MB: 10,
    SESSION_IDLE_MINUTES: 30,
    SESSION_ABSOLUTE_HOURS: 12,
  } satisfies Config);
}

afterAll(async () => {
  await app?.close();
  await owner?.close();
});

async function start(): Promise<void> {
  owner ??= openOwner();
  app ??= await buildServer(testConfig());
  await app.ready();
  await truncateAll(owner.db);
}

let seeded = 0;

async function signedInAs(
  role: Role,
  name = "Grace Mollel",
): Promise<{ cookie: string; id: string }> {
  seeded += 1;
  const email = `register${seeded}@tmda.go.tz`;

  const rows = await owner.db.execute(sql`
    INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
    VALUES (${email}, ${name}, ${role}::user_role, ${await hashPassword(PASSWORD)}, false, true)
    RETURNING id
  `);

  const res = await app.inject({
    method: "POST",
    url: "/login",
    headers: { host: STAFF_HOST, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ email, password: PASSWORD }).toString(),
  });

  return {
    cookie: `${COOKIE}=${res.cookies.find((c) => c.name === COOKIE)?.value}`,
    id: (rows[0] as { id: string }).id,
  };
}

function get(url: string, cookie: string) {
  return app.inject({ url, headers: { host: STAFF_HOST, cookie } });
}

async function seedReport(attrs: {
  number: string;
  channel?: "online_form" | "email" | "hard_copy";
  payload?: Record<string, unknown>;
}): Promise<string> {
  const payload = {
    reporter_name: "A. Mwita",
    phone: "+255700000000",
    incident_narrative: "Pump stopped.",
    incident_date: "2026-08-01",
    report_date: "2026-08-02",
    device_location: "Workshop",
    location: "Dar es Salaam",
    ...attrs.payload,
  };

  const rows = await owner.db.execute(sql`
    INSERT INTO reports (number, channel, severity, status, device_name, form_version, payload)
    VALUES (
      ${attrs.number},
      ${attrs.channel ?? "email"}::report_channel,
      'hospitalization',
      'first_assessment',
      'Infusion Pump X',
      'TMDA/DMD/MDV/F/001 Rev 06',
      ${JSON.stringify(payload)}::jsonb
    )
    RETURNING id
  `);

  return (rows[0] as { id: string }).id;
}

async function seedSubmittedA1(
  reportId: string,
  assessorId: string,
  answers: Record<string, unknown>,
) {
  await owner.db.execute(sql`
    INSERT INTO assessments (report_id, assessor_id, ordinal, form_version, payload, submitted_at)
    VALUES (
      ${reportId}, ${assessorId}, 1, ${F004_VERSION},
      ${JSON.stringify(answers)}::jsonb, now()
    )
  `);
}

describe.skipIf(!INTEGRATION_ENABLED)("staff Register data mapping", () => {
  beforeEach(start);

  it("shows F004 1.19 as Type of Report, not the arrival channel", async () => {
    const officer = await signedInAs("assessor", "Baraka Nyoni");
    const reportId = await seedReport({ number: "AEMD/2026-27/101", channel: "email" });
    await seedSubmittedA1(reportId, officer.id, {
      report_stage: "follow_up",
      imdrf_component_l1: "Battery",
      imdrf_component_code: "E1204",
      causality: "probable",
      risk_level: "high",
      actions: ["monitoring"],
    });

    const page = await get("/register", (await signedInAs("manager")).cookie);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Follow up");
    expect(page.body).not.toContain(">email<");
    expect(page.body).not.toContain(">online_form<");
    expect(page.body).toContain("Battery");
    expect(page.body).toContain("E1204");
    expect(page.body).toContain("Probable");
    expect(page.body).toContain("High");
    expect(page.body).toContain("Enhance monitoring");
    expect(page.body).toContain("Name: A. Mwita · Contact: +255700000000");
  });

  it("does not use a draft A1, and prefers the Final Document when both exist", async () => {
    const officer = await signedInAs("assessor", "Baraka Nyoni");
    const manager = await signedInAs("manager");
    const reportId = await seedReport({
      number: "AEMD/2026-27/102",
      channel: "hard_copy",
      payload: { manufacturing_country: "Kenya" },
    });

    await owner.db.execute(sql`
      INSERT INTO assessments (report_id, assessor_id, ordinal, form_version, payload)
      VALUES (
        ${reportId}, ${officer.id}, 1, ${F004_VERSION},
        ${JSON.stringify({ report_stage: "initial", imdrf_component_l1: "Draft term" })}::jsonb
      )
    `);

    const unassessed = await get("/register", manager.cookie);
    expect(unassessed.body).toContain("Kenya");
    expect(unassessed.body).not.toContain("Draft term");
    expect(unassessed.body).not.toContain(">hard_copy<");

    await owner.db.execute(sql`
      UPDATE assessments
         SET payload = ${JSON.stringify({
           report_stage: "initial",
           imdrf_component_l1: "A1 term",
         })}::jsonb,
             submitted_at = now()
       WHERE report_id = ${reportId} AND ordinal = 1
    `);

    const withA1 = await get("/register", manager.cookie);
    expect(withA1.body).toContain("Initial");
    expect(withA1.body).toContain("A1 term");

    const [decision] = await owner.db.execute(sql`
      INSERT INTO report_decisions (report_id, decided_by_user_id, kind, reviewed_through_ordinal,
                                    work_officer_user_id)
      VALUES (${reportId}, ${manager.id}, 'assign_work_officer', 2, ${officer.id})
      RETURNING id
    `);

    await owner.db.execute(sql`
      INSERT INTO report_final_documents (report_id, decision_id, approved_by_user_id,
                                          resolved_through_ordinal, form_version, payload)
      VALUES (
        ${reportId}, ${(decision as { id: string }).id}, ${manager.id}, 2, ${F004_VERSION},
        ${JSON.stringify({
          kind: FINAL_DOCUMENT_KIND,
          answers: { report_stage: "final", imdrf_component_l1: "Approved term" },
          provenance: {},
          second: {},
        })}::jsonb
      )
    `);

    const withFinal = await get("/register", manager.cookie);
    expect(withFinal.body).toContain("Final");
    expect(withFinal.body).toContain("Approved term");
    expect(withFinal.body).not.toContain("A1 term");
  });

  it("leaves Investigation Status and Acknowledgement blank rather than inventing them", async () => {
    const officer = await signedInAs("assessor");
    const reportId = await seedReport({ number: "AEMD/2026-27/103" });
    await seedSubmittedA1(reportId, officer.id, {
      report_stage: "initial",
      imdrf_investigation_type_l1: "Manufacturer investigation",
      imdrf_investigation_type_code: "A05",
      actions: ["feedback"],
    });

    const page = await get("/register", (await signedInAs("manager")).cookie);
    expect(page.body).toContain("Provide feedback to users");
    expect(page.body).not.toContain(">Done<");
    expect(page.body).not.toContain(">Not Done<");
  });

  it("shows the actual common name, not the combined full name, in its own column", async () => {
    // brand_name and common_name are kept apart on the form; the Register must keep them apart
    // too, rather than printing the derived full name under the common-name heading.
    await seedReport({
      number: "AEMD/2026-27/104",
      payload: { brand_name: "B. Braun Perfusor", common_name: "Infusion Pump" },
    });

    const page = await get("/register", (await signedInAs("manager")).cookie);

    expect(page.body).toContain("B. Braun Perfusor");
    expect(page.body).toContain("Infusion Pump");
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("staff Register access and download", () => {
  beforeEach(start);

  it("lets a manager and an Officer open the Register and download it, and refuses an administrator", async () => {
    await seedReport({ number: "AEMD/2026-27/201" });

    for (const role of ["manager", "assessor"] as const) {
      const { cookie } = await signedInAs(role);
      const page = await get("/register", cookie);
      expect(page.statusCode, role).toBe(200);
      expect(page.body).toContain("Download Register");
      expect(page.body).toContain('href="/register/download/xlsx"');
      expect(page.body).not.toContain('href="/register/download/pdf"');
      expect((await get("/register/download/pdf", cookie)).statusCode, `${role} pdf`).toBe(404);

      const xlsx = await get("/register/download/xlsx", cookie);
      expect(xlsx.statusCode, `${role} xlsx`).toBe(200);
      expect(String(xlsx.headers["content-type"])).toContain(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      expect(String(xlsx.headers["content-disposition"])).toMatch(
        /attachment; filename="AEMD-Register-\d{4}-\d{2}-\d{2}\.xlsx"/,
      );
      expect(xlsx.rawPayload.byteLength).toBeGreaterThan(1000);
    }

    const admin = await signedInAs("administrator");
    expect((await get("/register", admin.cookie)).statusCode).toBe(403);
    expect((await get("/register/download/xlsx", admin.cookie)).statusCode).toBe(403);
    expect((await get("/register/download/pdf", admin.cookie)).statusCode).toBe(404);

    const dashboard = await get("/dashboard", admin.cookie);
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.body).not.toContain('href="/register"');
  });

  it("sends an unauthenticated request to sign in rather than the register or its download", async () => {
    await seedReport({ number: "AEMD/2026-27/203" });

    const page = await get("/register", "");
    expect(page.statusCode).toBe(302);
    expect(page.headers.location).toBe("/");

    const xlsx = await get("/register/download/xlsx", "");
    expect(xlsx.statusCode).toBe(302);
    expect(xlsx.headers.location).toBe("/");
  });

  it("exports the same Register fields the page shows", async () => {
    const officer = await signedInAs("assessor", "Baraka Nyoni");
    const reportId = await seedReport({
      number: "AEMD/2026-27/202",
      payload: {
        manufacturing_country: "Kenya",
        reporter_name: "A. Mwita",
        phone: "+255700000000",
      },
    });
    await seedSubmittedA1(reportId, officer.id, {
      report_stage: "follow_up",
      imdrf_component_l1: "Battery",
      imdrf_component_code: "E1204",
      imdrf_investigation_findings_l1: "Cell fault confirmed",
      causality: "probable",
      actions: ["monitoring"],
    });

    const { cookie } = await signedInAs("manager");
    const page = await get("/register", cookie);
    expect(page.body).toContain("AEMD/2026-27/202");
    expect(page.body).toContain("Follow up");
    expect(page.body).toContain("Battery");

    const xlsx = await get("/register/download/xlsx", cookie);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.rawPayload);
    const sheet = workbook.getWorksheet("Register");
    expect(sheet).toBeDefined();
    if (sheet === undefined) return;

    expect(sheet.columnCount).toBe(COLUMNS.length);
    expect(sheet.getRow(1).getCell(2).value).toBe("TMDA Report Number");
    expect(sheet.getRow(2).getCell(2).value).toBe("AEMD/2026-27/202");
    expect(sheet.getRow(2).getCell(19).value).toBe("Follow up");
    expect(sheet.getRow(2).getCell(20).value).toBe("Name: A. Mwita · Contact: +255700000000");
    expect(sheet.getRow(2).getCell(22).value).toBe("Battery");
    expect(sheet.getRow(2).getCell(25).value).toBe("E1204");
    expect(sheet.getRow(2).getCell(39).value).toBe("Cell fault confirmed");
    expect(sheet.getRow(2).getCell(48).value).toBe("Probable");
    expect(sheet.getRow(2).getCell(50).value).toBe("Enhance monitoring");
  });
});
