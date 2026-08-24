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

/**
 * The middle of the report's life: what the manager does with a finished first assessment, and
 * what the second Officer does after being handed the report.
 *
 * `staff-second-assessor` pins the handover itself — the queue and the one POST that names the
 * second Officer. This file pins the two steps on either side of it: the manager's review of
 * assessment 1, and assessment 2 being written by the Officer who received it.
 *
 * Every case drives the real routes. A report reaches each state by being filed at the public
 * door and worked through the same requests a person would make, because the point of these cases
 * is the transition, and a row written straight into the table has made no transition at all.
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

/** A fresh address per account: sign-in is rate limited per address and the app outlives truncate. */
let seeded = 0;

async function signedInAs(role: Role, name?: string): Promise<Staff> {
  seeded += 1;
  const email = `review-${seeded}@tmda.go.tz`;
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
function completeAssessment(signature: string) {
  return {
    intent: "submit",
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
    imdrf_component_l1: "Battery",
    imdrf_component_code: "E1204",
    imdrf_device_problem_l1: "Battery depletion",
    imdrf_device_problem_code: "A0501",
    imdrf_health_impact_l1: "No clinical signs",
    imdrf_health_impact_code: "E2301",
    imdrf_clinical_signs_l1: "None observed",
    imdrf_clinical_signs_code: "E0101",
    imdrf_investigation_type_l1: "Manufacturer investigation",
    imdrf_investigation_type_code: "A05",
    imdrf_investigation_findings_l1: "Cell fault confirmed",
    imdrf_investigation_findings_code: "A0702",
    imdrf_investigation_conclusion_l1: "Device to be replaced",
    imdrf_investigation_conclusion_code: "A0803",
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
    signature,
  };
}

/**
 * Everything a second assessment must carry to be submitted: a position on every A1 answer.
 *
 * One of each degree, so a submission exercises all three rules at once — Agree carrying nothing,
 * Disagree carrying a corrected value and a statement, and Required clarification carrying a statement
 * alone. The keys are the A1 field numbers, which is what the payload is keyed by.
 */
function completeSecond(overrides: Record<string, string | string[]> = {}) {
  return {
    intent: "submit",
    "a2_degree_1.3": "agree",
    "a2_degree_1.10": "agree",
    "a2_degree_1.11": "agree",
    "a2_degree_1.19": "agree",
    "a2_degree_2.5": "agree",
    "a2_degree_2.6": "disagree",
    "a2_value_2.6": "non_serious",
    "a2_statement_2.6": "This does not meet the serious criteria.",
    "a2_degree_2.7": "agree",
    "a2_degree_3.1.1": "agree",
    "a2_degree_3.1.2": "agree",
    "a2_degree_3.2.1": "agree",
    "a2_degree_3.2.2": "agree",
    "a2_degree_3.3.1": "agree",
    "a2_degree_3.3.2": "agree",
    "a2_degree_3.3.3": "agree",
    "a2_degree_4.1": "agree",
    "a2_degree_4.2": "agree",
    "a2_degree_4.3": "agree",
    a2_degree_5: "agree",
    a2_degree_6: "agree",
    "a2_degree_7.1_actions": "clarification",
    "a2_statement_7.1_actions": "Clarify the monitoring action before the final decision.",
    "a2_degree_7.1_conclusion": "agree",
    ...overrides,
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

function auditActions(reportId: string): Promise<unknown[]> {
  return owner.db.execute(sql`
    SELECT action, actor_user_id, before, after FROM audit_log
     WHERE entity_type = 'report' AND entity_id = ${reportId} ORDER BY id
  `);
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

  const officer = filed.assessor1_user_id === a.id ? a : b;
  const other = filed.assessor1_user_id === a.id ? b : a;

  const submitted = await post(
    `/reports/${filed.id}/assessment-1`,
    officer.cookie,
    completeAssessment(officer.name),
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

/** The whole of the handover, so the A2 cases start where the manager's work ends. */
async function secondAssessmentAssigned(): Promise<Handover> {
  const handover = await firstAssessmentSubmitted();

  expect((await comment(handover.report, handover.manager.cookie, REVIEW)).statusCode).toBe(302);
  expect(
    (await assign(handover.report, handover.manager.cookie, handover.other.id)).statusCode,
  ).toBe(302);

  const report = await reportRow(handover.report.id);
  expect(report.status).toBe("second_assessment");
  expect(await secondaryAssessorOf(report.id)).toBe(handover.other.id);

  return { ...handover, report };
}

describe.skipIf(!INTEGRATION_ENABLED)("the manager's review of assessment 1", () => {
  beforeEach(start);

  it("saves the comment against assessment 1 and still shows it after a refresh", async () => {
    const { manager, report } = await firstAssessmentSubmitted();

    const saved = await comment(report, manager.cookie, REVIEW);
    expect(saved.statusCode).toBe(302);
    expect(saved.headers.location).toBe(`/reports/${report.id}`);

    // Persisted against ordinal 1, with who wrote it and when.
    const [first] = await assessmentsOf(report.id);
    expect(first?.manager_comment).toBe(REVIEW);
    expect(first?.manager_comment_by).toBe(manager.id);
    expect(first?.manager_comment_at).not.toBeNull();

    // And read back on the page the manager works from, which is the half a refresh proves.
    const page = await get(`/reports/${report.id}`, manager.cookie);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(REVIEW);
    expect(page.body).toContain(manager.name);
  });

  it("offers the comment box to the manager once the first assessment is in", async () => {
    const { manager, report } = await firstAssessmentSubmitted();

    const page = await get(`/reports/${report.id}`, manager.cookie);

    expect(page.body).toContain(`/reports/${report.id}/assessment-1/comment`);
  });

  it("refuses a comment from the Officer who wrote the assessment", async () => {
    const { officer, report } = await firstAssessmentSubmitted();

    const refused = await comment(report, officer.cookie, "Marking my own work.");

    expect(refused.statusCode).toBe(403);
    const [first] = await assessmentsOf(report.id);
    expect(first?.manager_comment).toBeNull();
    expect(first?.manager_comment_at).toBeNull();
  });

  it("draws no comment box for an Officer", async () => {
    const { officer, report } = await firstAssessmentSubmitted();

    const page = await get(`/reports/${report.id}`, officer.cookie);

    expect(page.body).not.toContain(`/reports/${report.id}/assessment-1/comment`);
  });

  it("refuses a comment while the first assessment is still a draft", async () => {
    const manager = await signedInAs("manager", "Mgr Kileo");
    const officer = await signedInAs("assessor", "Asha Mrema");
    await fileAtThePublicDoor();
    const filed = await onlyReport();
    expect(filed.assessor1_user_id).toBe(officer.id);

    await post(`/reports/${filed.id}/assessment-1`, officer.cookie, {
      intent: "save",
      conclusion: "Half written.",
    });

    const refused = await comment(await reportRow(filed.id), manager.cookie, REVIEW);

    expect(refused.statusCode).toBe(403);
    const [first] = await assessmentsOf(filed.id);
    expect(first?.submitted_at).toBeNull();
    expect(first?.manager_comment).toBeNull();
  });

  it("refuses an empty comment rather than storing a review that says nothing", async () => {
    const { manager, report } = await firstAssessmentSubmitted();

    const refused = await comment(report, manager.cookie, "   ");

    expect(refused.statusCode).toBe(422);
    const [first] = await assessmentsOf(report.id);
    expect(first?.manager_comment).toBeNull();
    expect(first?.manager_comment_at).toBeNull();
  });

  it("answers 404 for a report that is not there, and for an id that is not one", async () => {
    const manager = await signedInAs("manager", "Mgr Kileo");

    for (const id of [NOBODY, "not-a-uuid"]) {
      const res = await post(`/reports/${id}/assessment-1/comment`, manager.cookie, {
        comment: REVIEW,
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it("records the manager as the actor, and keeps the replaced text in the trail", async () => {
    const { manager, report } = await firstAssessmentSubmitted();

    await comment(report, manager.cookie, REVIEW);
    await comment(report, manager.cookie, "Second thoughts: the IFU wording is fine.");

    const [first] = await assessmentsOf(report.id);
    expect(first?.manager_comment).toBe("Second thoughts: the IFU wording is fine.");

    const trail = (await auditActions(report.id)) as {
      action: string;
      actor_user_id: string | null;
      before: unknown;
      after: unknown;
    }[];
    const reviews = trail.filter((row) => row.action === "assessment.commented");
    expect(reviews).toHaveLength(2);
    expect(reviews[0]?.actor_user_id).toBe(manager.id);
    // The first save replaced nothing; the second replaced the first, and the trail says so.
    expect(reviews[0]?.before).toBeNull();
    expect(JSON.stringify(reviews[1]?.before)).toContain(REVIEW);
    expect(JSON.stringify(reviews[1]?.after)).toContain("Second thoughts");
  });

  it("does not gate the handover: the manager may still assign without commenting", async () => {
    const { manager, other, report } = await firstAssessmentSubmitted();

    const assigned = await assign(report, manager.cookie, other.id);

    expect(assigned.statusCode).toBe(302);
    expect((await reportRow(report.id)).status).toBe("second_assessment");
  });

  it("lets the manager comment and then hand the report on", async () => {
    const { manager, other, report } = await firstAssessmentSubmitted();

    expect((await comment(report, manager.cookie, REVIEW)).statusCode).toBe(302);
    expect((await assign(report, manager.cookie, other.id)).statusCode).toBe(302);

    const after = await reportRow(report.id);
    expect(after.status).toBe("second_assessment");
    expect(await secondaryAssessorOf(report.id)).toBe(other.id);
    // Commenting did not disturb what the first assessor wrote.
    const [first] = await assessmentsOf(report.id);
    expect(first?.conclusion).toBe("Recommend risk communication and enhanced monitoring.");
    expect(first?.submitted_at).not.toBeNull();
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("the second Officer's assessment", () => {
  beforeEach(start);

  it("opens as assessment 2, not as assessment 1", async () => {
    const { other, report } = await secondAssessmentAssigned();

    const page = await get(`/reports/${report.id}/secondary-assessment`, other.cookie);

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Secondary assessment");
    expect(page.body).toContain("Secondary assessment");
    // Keyed by the A1 answer the decision is about, and drawn inline beside it.
    expect(page.body).toContain('name="a2_degree_2.6"');
    expect(page.body).toContain('name="a2_degree_7.1_conclusion"');
    expect(page.body).not.toContain('name="conclusion_2"');
  });

  it("ignores first-assessment fields smuggled into the body", async () => {
    const { other, report } = await secondAssessmentAssigned();

    // A hand-edited body naming 7.1's own fields. The page never offers them, and the route keeps
    // only what the second assessment owns — so this must leave assessment 1 exactly as it was.
    const submitted = await post(`/reports/${report.id}/secondary-assessment`, other.cookie, {
      ...completeSecond(),
      conclusion: "Overwritten by the second assessor.",
      signature: other.name,
      seriousness: "not_serious",
    });

    expect(submitted.statusCode).toBe(302);

    const [first, second] = await assessmentsOf(report.id);
    expect(first?.conclusion).toBe("Recommend risk communication and enhanced monitoring.");
    expect(first?.payload.seriousness).toBe("serious");
    expect(second?.payload.conclusion).toBeUndefined();
    expect(second?.payload.signature).toBeUndefined();
    expect(second?.payload.kind).toBe("a2_section_review");
  });

  it("carries the manager's review of the first assessment", async () => {
    const { other, report } = await secondAssessmentAssigned();

    const page = await get(`/reports/${report.id}/secondary-assessment`, other.cookie);

    expect(page.body).toContain(REVIEW);
  });

  it("shows what the first assessor concluded, to be read and not rewritten", async () => {
    const { other, report } = await secondAssessmentAssigned();

    const page = await get(`/reports/${report.id}/secondary-assessment`, other.cookie);

    expect(page.body).toContain("Recommend risk communication and enhanced monitoring.");
    expect(page.body).toContain(`/reports/${report.id}/secondary-assessment`);
  });

  it("refuses everyone but the Officer it was assigned to", async () => {
    const { manager, officer, report } = await secondAssessmentAssigned();
    const stranger = await signedInAs("assessor", "Stranger");

    // The first assessor and another Officer: different reasons, one answer.
    for (const who of [officer, stranger]) {
      expect((await get(`/reports/${report.id}/secondary-assessment`, who.cookie)).statusCode).toBe(
        403,
      );
      expect(
        (await post(`/reports/${report.id}/secondary-assessment`, who.cookie, completeSecond()))
          .statusCode,
      ).toBe(403);
    }

    // A manager is not registered in the Officer's scope at all.
    expect(
      (await get(`/reports/${report.id}/secondary-assessment`, manager.cookie)).statusCode,
    ).toBe(403);

    expect(await assessmentsOf(report.id)).toHaveLength(2);
  });

  it("saves a draft without moving the report or touching assessment 1", async () => {
    const { other, report } = await secondAssessmentAssigned();

    const saved = await post(`/reports/${report.id}/secondary-assessment`, other.cookie, {
      intent: "save",
      "a2_degree_2.6": "agree",
      "a2_statement_2.6": "This should be discarded because Agree has no statement.",
    });

    expect(saved.statusCode).toBe(302);
    expect((await reportRow(report.id)).status).toBe("second_assessment");

    const [first, second] = await assessmentsOf(report.id);
    expect(second?.ordinal).toBe(2);
    expect(second?.assessor_id).toBe(other.id);
    expect(second?.submitted_at).toBeNull();
    // Assessment 1 is exactly as its author left it.
    expect(first?.ordinal).toBe(1);
    expect(first?.conclusion).toBe("Recommend risk communication and enhanced monitoring.");
    expect(first?.submitted_at).not.toBeNull();
    // Agree carries nothing, whatever the body said alongside it.
    expect(second?.payload).toMatchObject({
      kind: "a2_section_review",
      responses: { "2.6": { degree: "agree" } },
    });
    expect(second?.payload.responses["2.6"]).not.toHaveProperty("statement");
  });

  it("refuses to submit with any A1 answer left undecided, and writes nothing", async () => {
    const { other, report } = await secondAssessmentAssigned();

    const refused = await post(`/reports/${report.id}/secondary-assessment`, other.cookie, {
      intent: "submit",
      "a2_degree_2.6": "agree",
    });

    expect(refused.statusCode).toBe(422);
    expect(await assessmentsOf(report.id)).toHaveLength(2);
  });

  it("requires a statement for Required clarification and for Disagree", async () => {
    const { other, report } = await secondAssessmentAssigned();

    const withoutClarification = await post(
      `/reports/${report.id}/secondary-assessment`,
      other.cookie,
      completeSecond({ "a2_statement_7.1_actions": "" }),
    );

    expect(withoutClarification.statusCode).toBe(422);

    const withoutDisagreement = await post(
      `/reports/${report.id}/secondary-assessment`,
      other.cookie,
      completeSecond({ "a2_statement_2.6": "" }),
    );

    expect(withoutDisagreement.statusCode).toBe(422);
    expect(await assessmentsOf(report.id)).toHaveLength(2);
  });

  it("requires a corrected value for Disagree, and asks for none under Required clarification", async () => {
    const { other, report } = await secondAssessmentAssigned();

    const refused = await post(
      `/reports/${report.id}/secondary-assessment`,
      other.cookie,
      completeSecond({ "a2_value_2.6": "" }),
    );

    expect(refused.statusCode).toBe(422);
    expect(await assessmentsOf(report.id)).toHaveLength(2);

    // The same review with Required clarification in 2.6's place needs no value at all.
    const accepted = await post(
      `/reports/${report.id}/secondary-assessment`,
      other.cookie,
      completeSecond({ "a2_degree_2.6": "clarification", "a2_value_2.6": "" }),
    );

    expect(accepted.statusCode).toBe(302);
  });

  it("submits as ordinal 2 and sends the report on for a decision", async () => {
    const { other, report } = await secondAssessmentAssigned();

    const submitted = await post(
      `/reports/${report.id}/secondary-assessment`,
      other.cookie,
      completeSecond(),
    );

    expect(submitted.statusCode).toBe(302);
    expect((await reportRow(report.id)).status).toBe("awaiting_decision");

    const [first, second] = await assessmentsOf(report.id);
    expect(second?.ordinal).toBe(2);
    expect(second?.assessor_id).toBe(other.id);
    expect(second?.conclusion).toBeNull();
    expect(second?.payload).toMatchObject({
      kind: "a2_section_review",
      responses: {
        "2.5": { degree: "agree" },
        "2.6": {
          degree: "disagree",
          value: "non_serious",
          statement: "This does not meet the serious criteria.",
        },
        "7.1_actions": {
          degree: "clarification",
          statement: "Clarify the monitoring action before the final decision.",
        },
      },
    });
    // Required clarification asks about A1's answer; it never replaces it.
    expect(second?.payload.responses["7.1_actions"]).not.toHaveProperty("value");
    expect(second?.submitted_at).not.toBeNull();
    // The manager's review belongs to assessment 1 and stays there.
    expect(second?.manager_comment).toBeNull();
    expect(first?.manager_comment).toBe(REVIEW);

    const trail = (await auditActions(report.id)) as { action: string; after: unknown }[];
    const submissions = trail.filter((row) => row.action === "assessment.submitted");
    expect(submissions).toHaveLength(2);
    expect(JSON.stringify(submissions[1]?.after)).toContain('"ordinal":2');
  });

  /**
   * The manager receiving the finished second assessment.
   *
   * Before this existed the report page rendered the first assessor's F004 with 7.2 showing
   * "Pending secondary assessment" — true until the moment it stops being true, and the page
   * had no way to notice. So the finished 7.2 is rendered from what the second assessor wrote,
   * and the placeholder is dropped rather than left contradicting it.
   */
  it("shows the manager the finished second assessment instead of a pending 7.2", async () => {
    const { manager, other, report } = await secondAssessmentAssigned();

    const before = await get(`/reports/${report.id}`, manager.cookie);
    expect(before.body).toContain("Pending secondary assessment");

    await post(`/reports/${report.id}/secondary-assessment`, other.cookie, completeSecond());

    const after = await get(`/reports/${report.id}`, manager.cookie);
    expect(after.body).toContain("Clarify the monitoring action before the final decision.");
    expect(after.body).toContain("Required clarification");
    expect(after.body).toContain(other.name);
    expect(after.body).not.toContain("Pending secondary assessment");
    // A2's decisions render inline inside the same F004 document A1's answers do, rather than as
    // a separate "Second assessment" section beneath it, so the manager's own review of assessment
    // 1 — printed once the whole document closes — now comes after them, not above.
    expect(after.body.indexOf("Required clarification")).toBeLessThan(after.body.indexOf(REVIEW));
  });

  it("keeps an unsubmitted second assessment off the report page", async () => {
    const { manager, other, report } = await secondAssessmentAssigned();

    await post(`/reports/${report.id}/secondary-assessment`, other.cookie, {
      intent: "save",
      "a2_degree_7.1_actions": "clarification",
      "a2_statement_7.1_actions": "A draft nobody else should be reading.",
    });

    const page = await get(`/reports/${report.id}`, manager.cookie);

    expect(page.body).not.toContain("A draft nobody else should be reading.");
    expect(page.body).toContain("Pending secondary assessment");
  });

  it("refuses a second submission of an assessment already sent", async () => {
    const { other, report } = await secondAssessmentAssigned();

    await post(`/reports/${report.id}/secondary-assessment`, other.cookie, completeSecond());
    const again = await post(
      `/reports/${report.id}/secondary-assessment`,
      other.cookie,
      completeSecond(),
    );

    expect(again.statusCode).toBe(403);
    expect((await reportRow(report.id)).status).toBe("awaiting_decision");
  });

  it("links the second assessment from the Officer's own list", async () => {
    const { other, report } = await secondAssessmentAssigned();

    const list = await get("/assessments", other.cookie);

    expect(list.statusCode).toBe(200);
    expect(list.body).toContain(`/reports/${report.id}/secondary-assessment`);
  });

  it("offers the second assessor their way in from the report itself", async () => {
    const { other, report } = await secondAssessmentAssigned();

    const page = await get(`/reports/${report.id}`, other.cookie);

    expect(page.body).toContain(`/reports/${report.id}/secondary-assessment`);
  });
});
