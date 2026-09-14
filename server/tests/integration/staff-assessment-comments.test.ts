import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/auth/password.js";
import type { Config } from "../../src/config.js";
import type { DatabaseHandle } from "../../src/db/client.js";
import { buildServer } from "../../src/server.js";
import { INTEGRATION_ENABLED, openOwner, requireTestDatabase, truncateAll } from "./helpers.js";
import { type ImdrfFixture, imdrfAssessmentFields, seedImdrfForF004 } from "./imdrf-fixture.js";

/**
 * The manager's notes against individual sections of a submitted first assessment.
 *
 * Beside , which pins the one overall verdict on the whole assessment.
 * Its own file rather than more cases in that one: the public door is rate limited to thirty
 * filings a minute and every case here files a report, so the two suites need a server instance
 * each to stay under it.
 *
 * Every case drives the real routes -- a comment row written straight into the table would have
 * proved nothing about the route that is supposed to refuse most of them.
 */

const STAFF_HOST = "staff.test";
const PUBLIC_HOST = "public.test";
const PASSWORD = "a correct staff password";
const COOKIE = "__Host-ae_session";

/** Well-formed and names nothing. */
const NOBODY = "00000000-0000-4000-8000-000000000000";

const REVIEW = "Agreed on causality. Please check the IFU wording before the second assessment.";

type Role = "administrator" | "manager" | "assessor";
type Staff = { cookie: string; id: string; name: string };

let owner: DatabaseHandle;
let app: FastifyInstance;
let imdrf: ImdrfFixture;

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
  imdrf = await seedImdrfForF004(owner.db);
}

/** A fresh address per account: sign-in is rate limited per address and the app outlives truncate. */
let seeded = 0;

async function signedInAs(role: Role, name?: string): Promise<Staff> {
  seeded += 1;
  const email = `notes-${seeded}@tmda.go.tz`;
  const fullName = name ?? `Officer ${seeded}`;

  const rows = await owner.db.execute(sql`
    INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
    VALUES (${email}, ${fullName}, ${role}::user_role, ${await hashPassword(PASSWORD)}, false, true)
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
    name: fullName,
  };
}

function get(url: string, cookie: string) {
  return app.inject({ url, headers: { host: STAFF_HOST, cookie } });
}

function post(url: string, cookie: string, form: Record<string, string>) {
  return app.inject({
    method: "POST",
    url,
    headers: { host: STAFF_HOST, cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(form).toString(),
  });
}

function fileAtThePublicDoor() {
  return app.inject({
    method: "POST",
    url: "/orange-form",
    headers: { host: PUBLIC_HOST, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({
      step: "5",
      action: "submit",
      device_name: "Philips IntelliVue MX450",
      common_name: "Patient Monitor",
      incident_date: "2026-08-01",
      incident_type: "Malfunction",
      incident_narrative: "Monitor stopped displaying vitals.",
      event_type: "Hospitalization",
      event_narrative: "Patient kept overnight for observation.",
      measures_taken: "Taken out of service.",
      informed_supplier: "No",
      reporter_name: "A. Mwita",
      facility_address: "Muhimbili National Hospital",
      location: "Dar es Salaam",
      phone: "+255 700 000 000",
      report_date: "2026-08-02",
      device_location: "Sealed in the biomedical workshop",
    }).toString(),
  });
}

/** Everything a first assessment must carry to be submitted rather than merely saved. */
function completeAssessment() {
  return {
    intent: "submit",
    signing_password: PASSWORD,
    device_type: "md",
    registration_number: "TMDA-REG-0001",
    device_class: "B",
    report_stage: "initial",
    source_of_event: "malfunction",
    c2_5: "Reported by the facility as a device malfunction.",
    seriousness: "serious",
    c2_6: "Required medical intervention and a 24-hour admission.",
    public_health: "no",
    c2_7: "One device at one facility; no wider exposure identified.",
    ...imdrfAssessmentFields(imdrf),
    expectedness: "unexpected",
    c4_1: "Not described in the manufacturer's IFU or risk file.",
    causality: "probable",
    c4_3: "Temporal relationship with device use; no other cause identified.",
    signal_status: "signal",
    c5: "Second report against this lot within a month.",
    risk_level: "high",
    c6: "Serious outcome with an unresolved cause.",
    actions: "monitoring",
    conclusion: "Recommend risk communication and enhanced monitoring.",
  };
}

type Row = {
  id: string;
  number: string;
  status: string;
  assessor1_user_id: string | null;
  assessor2_user_id: string | null;
};

async function onlyReport(): Promise<Row> {
  const rows = await owner.db.execute(sql`
    SELECT id, number, status::text AS status, assessor1_user_id, assessor2_user_id FROM reports
  `);
  expect(rows.length).toBe(1);
  return rows[0] as Row;
}

/** Who holds the secondary assessment: an `assessments` row, not a column on the report. */
async function secondaryAssessorOf(reportId: string): Promise<string | null> {
  const rows = await owner.db.execute(sql`
    SELECT assessor_id FROM assessments
     WHERE report_id = ${reportId} AND ordinal > 1
     ORDER BY ordinal DESC LIMIT 1
  `);
  return rows.length === 0 ? null : (rows[0] as { assessor_id: string }).assessor_id;
}

async function reportRow(id: string): Promise<Row> {
  const rows = await owner.db.execute(sql`
    SELECT id, number, status::text AS status, assessor1_user_id, assessor2_user_id
      FROM reports WHERE id = ${id}
  `);
  expect(rows.length).toBe(1);
  return rows[0] as Row;
}

type AssessmentRow = {
  ordinal: number;
  assessor_id: string;
  payload: Record<string, unknown>;
  conclusion: string | null;
  submitted_at: Date | null;
  manager_comment: string | null;
  manager_comment_by: string | null;
  manager_comment_at: Date | null;
};

/** One report's assessments, lowest ordinal first, so a case can assert the two never blur. */
async function assessmentsOf(reportId: string): Promise<AssessmentRow[]> {
  const rows = await owner.db.execute(sql`
    SELECT ordinal, assessor_id, payload, conclusion, submitted_at,
           manager_comment, manager_comment_by, manager_comment_at
      FROM assessments WHERE report_id = ${reportId} ORDER BY ordinal
  `);
  return rows as unknown as AssessmentRow[];
}

type Handover = { manager: Staff; officer: Staff; other: Staff; report: Row };

/**
 * A report whose first assessment is genuinely in: filed at the public door, assigned by intake,
 * and submitted through the real route by the Officer it was given to.
 */
async function firstAssessmentSubmitted(): Promise<Handover> {
  const manager = await signedInAs("manager", "Mgr Kileo");
  const a = await signedInAs("assessor", "Asha Mrema");
  const b = await signedInAs("assessor", "Baraka Nyoni");

  await fileAtThePublicDoor();
  const filed = await onlyReport();

  // Intake no longer names an Officer; standing in for the Manager's manual assignment until that
  // route exists.
  await owner.db.execute(sql`
    UPDATE reports SET assessor1_user_id = ${a.id}, assessor1_assigned_at = now()
     WHERE id = ${filed.id}
  `);
  const officer = a;
  const other = b;

  const submitted = await post(
    `/reports/${filed.id}/assessment-1`,
    officer.cookie,
    completeAssessment(),
  );
  expect(submitted.statusCode).toBe(302);

  const report = await reportRow(filed.id);
  expect(report.status).toBe("awaiting_second_assessor");

  return { manager, officer, other, report };
}

function comment(report: Row, cookie: string, text: string) {
  return post(`/reports/${report.id}/assessment-1/comment`, cookie, { comment: text });
}

function assign(report: Row, cookie: string, assessorId: string) {
  return post(`/reports/${report.id}/assign-next-assessor`, cookie, {
    assessor_id: assessorId,
    comment: "Please take the next assessment.",
  });
}

/** One note against one section of the first assessment. */
function note(report: Row, cookie: string, section: string, text: string) {
  return post(`/reports/${report.id}/assessment-1/sections/${section}/comments`, cookie, {
    body: text,
  });
}

/** Every section note actually stored for a report's first assessment, oldest first. */
async function notesOf(reportId: string): Promise<{ section: string; body: string }[]> {
  const rows = await owner.db.execute(sql`
    SELECT c.section, c.body
      FROM assessment_comments c
      JOIN assessments a ON a.id = c.assessment_id
     WHERE a.report_id = ${reportId} AND a.ordinal = 1
     ORDER BY c.section, c.created_at
  `);
  return rows as { section: string; body: string }[];
}

describe.skipIf(!INTEGRATION_ENABLED)("the manager's notes on a section", () => {
  beforeEach(start);

  it("stores one against the section it was written on", async () => {
    const { manager, report } = await firstAssessmentSubmitted();

    const res = await note(report, manager.cookie, "4", "Causality needs a second look.");

    expect(res.statusCode).toBe(302);
    // Back to the section itself, not the top of an eight-section document.
    expect(res.headers.location).toBe(`/reports/${report.id}#section-4`);
    expect(await notesOf(report.id)).toEqual([
      { section: "4", body: "Causality needs a second look." },
    ]);
  });

  it("keeps several sections apart, and orders one section's thread oldest first", async () => {
    const { manager, report } = await firstAssessmentSubmitted();

    await note(report, manager.cookie, "7", "First on seven.");
    await note(report, manager.cookie, "2", "One on two.");
    await note(report, manager.cookie, "7", "Second on seven.");

    expect(await notesOf(report.id)).toEqual([
      { section: "2", body: "One on two." },
      { section: "7", body: "First on seven." },
      { section: "7", body: "Second on seven." },
    ]);
  });

  it("shows the count and the thread on the manager's own read of the report", async () => {
    const { manager, report } = await firstAssessmentSubmitted();

    const before = (await get(`/reports/${report.id}`, manager.cookie)).body;
    // Eight sections, every one offering the box and none of them claiming a comment.
    expect((before.match(/0 comments/g) ?? []).length).toBe(8);
    expect(before).not.toContain("<fieldset disabled");
    expect(before).toContain(`action="/reports/${report.id}/assessment-1/sections/3/comments"`);

    await note(report, manager.cookie, "6", "Risk grading looks high.");

    const after = (await get(`/reports/${report.id}`, manager.cookie)).body;
    expect(after).toContain("1 comment");
    expect(after).toContain("Risk grading looks high.");
    expect(after).toContain(manager.name);
    expect((after.match(/0 comments/g) ?? []).length).toBe(7);
  });

  it("escapes what the manager typed rather than rendering it", async () => {
    const { manager, report } = await firstAssessmentSubmitted();

    await note(report, manager.cookie, "3", "<script>alert(1)</script>");

    const body = (await get(`/reports/${report.id}`, manager.cookie)).body;

    expect(body).toContain("&lt;script");
    expect(body).not.toContain("<script>alert(1)</script>");
  });

  it("refuses a section the form does not have, and writes nothing", async () => {
    const { manager, report } = await firstAssessmentSubmitted();

    for (const section of ["9", "0", "7.1", "not-a-section", "1%3B%20DROP"]) {
      const res = await note(report, manager.cookie, section, "Should not land.");

      expect(res.statusCode, section).toBe(403);
      expect(await notesOf(report.id), section).toEqual([]);
    }
  });

  it("refuses an empty comment without touching the record", async () => {
    const { manager, report } = await firstAssessmentSubmitted();

    for (const text of ["", "   "]) {
      const res = await note(report, manager.cookie, "5", text);

      // 422, not 403: the manager may write this one, the attempt just said nothing.
      expect(res.statusCode, JSON.stringify(text)).toBe(422);
      expect(res.body, JSON.stringify(text)).toContain("Write a comment before sending it.");
      expect(await notesOf(report.id)).toEqual([]);
    }
  });

  it("refuses an Officer and an administrator, the first assessor included", async () => {
    const { officer, other, report } = await firstAssessmentSubmitted();
    const admin = await signedInAs("administrator", "Adm");

    for (const [who, staff] of [
      ["the first assessor", officer],
      ["another Officer", other],
      ["an administrator", admin],
    ] as const) {
      const res = await note(report, staff.cookie, "4", "Not mine to write.");

      // Refused by the scope the route is registered in, not by anything it checks for itself.
      expect(res.statusCode, who).toBe(403);
      expect(await notesOf(report.id), who).toEqual([]);
    }
  });

  it("refuses a first assessment that has not been submitted", async () => {
    const manager = await signedInAs("manager", "Mgr Kileo");
    await signedInAs("assessor", "Asha Mrema");

    await fileAtThePublicDoor();
    const filed = await onlyReport();

    // Nothing submitted: there is no assessment to comment on, whatever the status column says.
    const res = await note(filed, manager.cookie, "1", "Too early.");

    expect(res.statusCode).toBe(403);
    expect(await notesOf(filed.id)).toEqual([]);
  });

  it("refuses a report that does not exist", async () => {
    const { manager } = await firstAssessmentSubmitted();

    for (const id of [NOBODY, "not-a-uuid"]) {
      const res = await post(`/reports/${id}/assessment-1/sections/1/comments`, manager.cookie, {
        body: "Nowhere.",
      });

      expect(res.statusCode, id).toBe(404);
    }
  });

  it("leaves the overall review, the assessment and the assignment untouched", async () => {
    const { manager, other, report } = await firstAssessmentSubmitted();

    await comment(report, manager.cookie, REVIEW);
    await note(report, manager.cookie, "7", "One note beside the verdict.");

    // Both records exist and neither replaced the other.
    const [first] = await assessmentsOf(report.id);
    expect(first.manager_comment).toBe(REVIEW);
    expect(await notesOf(report.id)).toEqual([
      { section: "7", body: "One note beside the verdict." },
    ]);

    // And the handover still works afterwards, which is the step the notes come before.
    expect((await assign(report, manager.cookie, other.id)).statusCode).toBe(302);
    const after = await reportRow(report.id);
    expect(await secondaryAssessorOf(report.id)).toBe(other.id);
    expect(after.status).toBe("second_assessment");
    // The first assessment itself is unchanged by any of it.
    expect(first.submitted_at).not.toBeNull();
  });

  it("stops taking notes once the report has moved on, without losing the ones already there", async () => {
    const { manager, other, report } = await firstAssessmentSubmitted();

    await note(report, manager.cookie, "7", "One note beside the verdict.");
    expect((await assign(report, manager.cookie, other.id)).statusCode).toBe(302);

    // The margin notes are the same kind of writing as the review they sit beside, so they close
    // at the same moment. What was written stays readable; the box to add to it is gone.
    const page = await get(`/reports/${report.id}`, manager.cookie);
    expect(page.body).toContain("One note beside the verdict.");
    expect(page.body).not.toContain("/assessment-1/sections/7/comments");
    expect(page.body).not.toContain("Write a comment…");

    // The route makes the same test, so a stale tab cannot post one either.
    const refused = await note(report, manager.cookie, "7", "Added after the handover.");
    expect(refused.statusCode).toBe(403);
    expect(await notesOf(report.id)).toEqual([
      { section: "7", body: "One note beside the verdict." },
    ]);
  });

  it("records the section in the trail without repeating the words", async () => {
    const { manager, report } = await firstAssessmentSubmitted();

    await note(report, manager.cookie, "6", "A sentence that must not reach the trail.");

    const rows = await owner.db.execute(sql`
      SELECT actor_user_id, after FROM audit_log WHERE action = 'assessment.section_commented'
    `);
    expect(rows.length).toBe(1);

    const entry = rows[0] as { actor_user_id: string; after: { section: string; ordinal: number } };
    expect(entry.actor_user_id).toBe(manager.id);
    expect(entry.after.section).toBe("6");
    expect(entry.after.ordinal).toBe(1);
    expect(JSON.stringify(entry.after)).not.toContain("must not reach the trail");
  });
});
