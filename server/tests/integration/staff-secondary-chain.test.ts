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
 * The secondary-assessment chain, past the second assessor: A1 → A2 → A3 → A4 → A5, and the two
 * decisions a manager may take at every stop along it.
 *
 * `staff-second-assessor` pins the first handover and `staff-manager-review` pins what one
 * secondary assessor writes. This file pins the thing neither could: that there is no second slot
 * and no ceiling — every secondary assessment is a row of its own, every one judges A1 rather than
 * the assessor before it, and every earlier one stays exactly as its author left it.
 */

const STAFF_HOST = "staff.test";
const PUBLIC_HOST = "public.test";
const PASSWORD = "a correct staff password";
const COOKIE = "__Host-ae_session";

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

let seeded = 0;

async function signedInAs(role: Role, name?: string): Promise<Staff> {
  seeded += 1;
  const email = `chain-${seeded}@tmda.go.tz`;
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

/**
 * A first assessment that leaves 1.10 and 1.11 blank on purpose.
 *
 * Both are "(If applicable)" on the paper, so A1 may leave them empty and a secondary assessor is
 * offered `supplied` rather than the three judgement degrees for them. That is the fourth case the
 * whole model turns on, and it has to survive being generalized past A2.
 */
function completeAssessment(signature: string) {
  return {
    intent: "submit",
    device_type: "md",
    registration_number: "",
    device_class: "",
    report_stage: "initial",
    source_of_event: "malfunction",
    seriousness: "serious",
    public_health: "no",
    imdrf_component_l1: "Battery",
    imdrf_device_problem_l1: "Battery depletion",
    imdrf_health_impact_l1: "No clinical signs",
    imdrf_clinical_signs_l1: "None observed",
    imdrf_investigation_type_l1: "Manufacturer investigation",
    imdrf_investigation_findings_l1: "Cell fault confirmed",
    imdrf_investigation_conclusion_l1: "Device to be replaced",
    expectedness: "unexpected",
    causality: "probable",
    c4_3: "Temporal relationship with device use; no other cause identified.",
    signal_status: "signal",
    risk_level: "high",
    actions: "monitoring",
    conclusion: "Recommend risk communication and enhanced monitoring.",
    signature,
  };
}

/**
 * A complete secondary review of A1: a position on every reviewable item.
 *
 * 1.10 and 1.11 carry no degree at all — A1 left them blank, so they are `supplied` items and the
 * page never offers the three degrees for them. `validateSecondaryReviewForSubmit` must not ask
 * for one either, whichever ordinal is writing.
 */
function completeSecondary(overrides: Record<string, string> = {}) {
  return {
    intent: "submit",
    "a2_degree_1.3": "agree",
    "a2_degree_1.19": "agree",
    "a2_degree_2.5": "agree",
    "a2_degree_2.6": "agree",
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
    "a2_degree_7.1_actions": "agree",
    "a2_degree_7.1_conclusion": "agree",
    ...overrides,
  };
}

type Row = { id: string; number: string; status: string; assessor1_user_id: string | null };

async function onlyReport(): Promise<Row> {
  const rows = await owner.db.execute(sql`
    SELECT id, number, status::text AS status, assessor1_user_id FROM reports
  `);
  expect(rows.length).toBe(1);
  return rows[0] as Row;
}

async function statusOf(id: string): Promise<string> {
  const rows = await owner.db.execute(sql`
    SELECT status::text AS status FROM reports WHERE id = ${id}
  `);
  return (rows[0] as { status: string }).status;
}

type AssessmentRow = {
  ordinal: number;
  assessor_id: string;
  payload: { responses?: Record<string, { degree?: string; value?: unknown; statement?: string }> };
  submitted_at: Date | null;
};

async function assessmentsOf(reportId: string): Promise<AssessmentRow[]> {
  const rows = await owner.db.execute(sql`
    SELECT ordinal, assessor_id, payload, submitted_at
      FROM assessments WHERE report_id = ${reportId} ORDER BY ordinal
  `);
  return rows as unknown as AssessmentRow[];
}

type DecisionRow = {
  kind: string;
  comment: string | null;
  reviewed_through_ordinal: number;
  next_assessor_user_id: string | null;
  next_ordinal: number | null;
  work_officer_user_id: string | null;
};

async function decisionsOf(reportId: string): Promise<DecisionRow[]> {
  const rows = await owner.db.execute(sql`
    SELECT kind::text AS kind, comment, reviewed_through_ordinal, next_assessor_user_id,
           next_ordinal, work_officer_user_id
      FROM report_decisions WHERE report_id = ${reportId} ORDER BY decided_at
  `);
  return rows as unknown as DecisionRow[];
}

/** A report whose A1 is genuinely submitted, driven through the real routes. */
async function afterFirstAssessment() {
  const manager = await signedInAs("manager", "Grace Mollel");
  const a = await signedInAs("assessor", "Asha Mrema");
  const b = await signedInAs("assessor", "Baraka Nyoni");
  const c = await signedInAs("assessor", "Chausiku Njau");
  const d = await signedInAs("assessor", "Daudi Kimaro");
  const e = await signedInAs("assessor", "Editha Swai");

  await fileAtThePublicDoor();
  const filed = await onlyReport();

  const everyone = [a, b, c, d, e];
  const first = everyone.find((s) => s.id === filed.assessor1_user_id);
  if (first === undefined) throw new Error("intake assigned nobody this suite knows");
  const rest = everyone.filter((s) => s.id !== first.id);

  const submitted = await post(
    `/reports/${filed.id}/assessment-1`,
    first.cookie,
    completeAssessment(first.name),
  );
  expect(submitted.statusCode).toBe(302);
  expect(await statusOf(filed.id)).toBe("awaiting_second_assessor");

  return { manager, first, rest, report: filed };
}

describe.skipIf(!INTEGRATION_ENABLED)("the secondary-assessment chain", () => {
  beforeEach(start);

  it("runs A1 → A2 → A3 → A4 → A5 with no ceiling, every one judging A1", async () => {
    const { manager, first, rest, report } = await afterFirstAssessment();

    // Four secondary assessments in a row, each assigned by the manager and submitted by a
    // different Officer. Nothing in the loop names an ordinal: the route works it out.
    for (const [index, officer] of rest.entries()) {
      const ordinal = index + 2;

      const assigned = await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
        assessor_id: officer.id,
        comment: `Please take assessment ${ordinal}.`,
      });
      expect(assigned.statusCode, `assigning A${ordinal}`).toBe(302);
      expect(await statusOf(report.id)).toBe("second_assessment");

      // The assignment IS the assessment row — nothing else creates it.
      const rows = await assessmentsOf(report.id);
      const mine = rows.find((r) => r.ordinal === ordinal);
      expect(mine, `A${ordinal} row exists`).toBeDefined();
      expect(mine?.assessor_id).toBe(officer.id);
      expect(mine?.submitted_at, `A${ordinal} starts unsubmitted`).toBeNull();

      // Their own page opens at one stable address, whatever ordinal they hold.
      const page = await get(`/reports/${report.id}/secondary-assessment`, officer.cookie);
      expect(page.statusCode, `A${ordinal} may open their page`).toBe(200);
      expect(page.body).toContain(`Secondary assessment (A${ordinal})`);
      // The manager's instruction for THIS assignment, prominently.
      expect(page.body).toContain(`Please take assessment ${ordinal}.`);

      const sent = await post(
        `/reports/${report.id}/secondary-assessment`,
        officer.cookie,
        completeSecondary({
          "a2_degree_2.6": "disagree",
          "a2_value_2.6": "non_serious",
          "a2_statement_2.6": `A${ordinal} disagrees with the first assessor on 2.6.`,
        }),
      );
      expect(sent.statusCode, `A${ordinal} may submit`).toBe(302);
      expect(await statusOf(report.id)).toBe("awaiting_decision");
    }

    // Five assessments: the primary and four secondary ones, each its own immutable row.
    const rows = await assessmentsOf(report.id);
    expect(rows.map((r) => r.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.every((r) => r.submitted_at !== null)).toBe(true);

    // Every secondary assessor is a different person, and none of them is A1.
    const secondaryAssessors = rows.filter((r) => r.ordinal > 1).map((r) => r.assessor_id);
    expect(new Set(secondaryAssessors).size).toBe(4);
    expect(secondaryAssessors).not.toContain(first.id);

    // Each secondary row is a judgement of A1 — keyed by A1's own field numbers, carrying that
    // assessor's own statement, and none of them referring to the assessor before them.
    for (const row of rows.filter((r) => r.ordinal > 1)) {
      expect(row.payload.responses?.["2.6"]).toMatchObject({
        degree: "disagree",
        value: "non_serious",
        statement: `A${row.ordinal} disagrees with the first assessor on 2.6.`,
      });
    }
  });

  it("shows a later assessor every earlier review, read-only, and keeps them immutable", async () => {
    const { manager, rest, report } = await afterFirstAssessment();
    const [second, third] = rest;
    if (second === undefined || third === undefined) throw new Error("need two Officers");

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "First secondary review, please.",
    });
    await post(
      `/reports/${report.id}/secondary-assessment`,
      second.cookie,
      completeSecondary({
        "a2_degree_2.5": "disagree",
        "a2_value_2.5": "labelling",
        "a2_statement_2.5": "The labelling is the likelier source.",
      }),
    );

    const beforeA3 = await assessmentsOf(report.id);

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: third.id,
      comment: "Second opinion on the source, please.",
    });

    // A3 sees A2's finished work as context, named and dated, without it being their own.
    const page = await get(`/reports/${report.id}/secondary-assessment`, third.cookie);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Previous assessments (1)");
    expect(page.body).toContain(second.name);
    expect(page.body).toContain("The labelling is the likelier source.");

    // A3 may disagree with A1 where A2 agreed, and agree where A2 disagreed — their judgement is
    // of A1, not of A2.
    const sent = await post(
      `/reports/${report.id}/secondary-assessment`,
      third.cookie,
      completeSecondary({
        "a2_degree_2.5": "agree",
        "a2_degree_2.7": "disagree",
        "a2_value_2.7": "yes",
        "a2_statement_2.7": "This is a public health concern after all.",
      }),
    );
    expect(sent.statusCode).toBe(302);

    const afterA3 = await assessmentsOf(report.id);

    // A2's row is untouched by anything A3 did.
    const a2Before = beforeA3.find((r) => r.ordinal === 2);
    const a2After = afterA3.find((r) => r.ordinal === 2);
    expect(a2After).toEqual(a2Before);

    // And the two rows genuinely disagree with each other about 2.5, both as judgements of A1.
    expect(a2After?.payload.responses?.["2.5"]).toMatchObject({ degree: "disagree" });
    expect(afterA3.find((r) => r.ordinal === 3)?.payload.responses?.["2.5"]).toMatchObject({
      degree: "agree",
    });
  });

  it("lets each secondary assessor supply their own answer where A1 left one blank", async () => {
    const { manager, rest, report } = await afterFirstAssessment();
    const [second, third] = rest;
    if (second === undefined || third === undefined) throw new Error("need two Officers");

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please fill in what you can.",
    });
    await post(
      `/reports/${report.id}/secondary-assessment`,
      second.cookie,
      completeSecondary({ "a2_value_1.11": "Class B" }),
    );

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: third.id,
      comment: "Please check the class.",
    });
    await post(
      `/reports/${report.id}/secondary-assessment`,
      third.cookie,
      completeSecondary({ "a2_value_1.11": "Class C" }),
    );

    const rows = await assessmentsOf(report.id);

    // A1 stays blank, and each secondary assessor's own supplied answer stands beside it. Nothing
    // promotes one of them into A1's document.
    const a1 = rows.find((r) => r.ordinal === 1);
    if (a1 === undefined) throw new Error("the primary assessment is missing");
    expect((a1.payload as unknown as Record<string, string>).device_class).toBe("");

    expect(rows.find((r) => r.ordinal === 2)?.payload.responses?.["1.11"]).toEqual({
      degree: "supplied",
      value: "Class B",
    });
    expect(rows.find((r) => r.ordinal === 3)?.payload.responses?.["1.11"]).toEqual({
      degree: "supplied",
      value: "Class C",
    });
  });

  it("records every manager decision in order, with who was assigned next", async () => {
    const { manager, rest, report } = await afterFirstAssessment();
    const [second, third] = rest;
    if (second === undefined || third === undefined) throw new Error("need two Officers");

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please review the first assessment.",
    });
    await post(`/reports/${report.id}/secondary-assessment`, second.cookie, completeSecondary());

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: third.id,
      comment: "Not satisfied - one more opinion, please.",
    });
    await post(`/reports/${report.id}/secondary-assessment`, third.cookie, completeSecondary());

    const decisions = await decisionsOf(report.id);
    expect(decisions).toHaveLength(2);

    expect(decisions[0]).toMatchObject({
      kind: "assign_next_assessor",
      comment: "Please review the first assessment.",
      reviewed_through_ordinal: 1,
      next_assessor_user_id: second.id,
      next_ordinal: 2,
      work_officer_user_id: null,
    });

    expect(decisions[1]).toMatchObject({
      kind: "assign_next_assessor",
      comment: "Not satisfied - one more opinion, please.",
      reviewed_through_ordinal: 2,
      next_assessor_user_id: third.id,
      next_ordinal: 3,
    });

    // The history is on the manager's own page, in the order it happened.
    const body = (await get(`/reports/${report.id}`, manager.cookie)).body;
    expect(body).toContain("Manager decision history");
    expect(body).toContain("Please review the first assessment.");
    expect(body).toContain("Not satisfied - one more opinion, please.");
    expect(body.indexOf("Please review the first assessment.")).toBeLessThan(
      body.indexOf("Not satisfied - one more opinion, please."),
    );
  });

  it("ends the workflow by assigning a work officer, not by closing the report", async () => {
    const { manager, rest, report } = await afterFirstAssessment();
    const [second, worker] = rest;
    if (second === undefined || worker === undefined) throw new Error("need two Officers");

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please review it.",
    });
    await post(`/reports/${report.id}/secondary-assessment`, second.cookie, completeSecondary());
    expect(await statusOf(report.id)).toBe("awaiting_decision");

    const assigned = await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
      officer_id: worker.id,
      comment: "Please carry out the recommended monitoring.",
    });

    expect(assigned.statusCode).toBe(302);
    // The MVP's terminus, and deliberately not `closed`.
    expect(await statusOf(report.id)).toBe("assigned_for_work");

    const decisions = await decisionsOf(report.id);
    expect(decisions.at(-1)).toMatchObject({
      kind: "assign_work_officer",
      comment: "Please carry out the recommended monitoring.",
      work_officer_user_id: worker.id,
      next_assessor_user_id: null,
      next_ordinal: null,
    });

    // The work assignment creates no assessment: the officer is executing the work, not
    // assessing the report.
    expect((await assessmentsOf(report.id)).map((r) => r.ordinal)).toEqual([1, 2]);
  });

  it("refuses a second assessment to an Officer who already holds one on the report", async () => {
    const { manager, first, rest, report } = await afterFirstAssessment();
    const [second] = rest;
    if (second === undefined) throw new Error("need an Officer");

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please review it.",
    });
    await post(`/reports/${report.id}/secondary-assessment`, second.cookie, completeSecondary());

    // The same Officer again, and the first assessor: both already hold an assessment here.
    for (const who of [second, first]) {
      const refused = await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
        assessor_id: who.id,
        comment: "One more look, please.",
      });
      expect(refused.statusCode, who.name).toBe(403);
    }

    expect((await assessmentsOf(report.id)).map((r) => r.ordinal)).toEqual([1, 2]);
    expect(await statusOf(report.id)).toBe("awaiting_decision");
  });

  it("requires a reason when the manager asks for another assessment", async () => {
    const { manager, rest, report } = await afterFirstAssessment();
    const [second, third] = rest;
    if (second === undefined || third === undefined) throw new Error("need two Officers");

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please review it.",
    });
    await post(`/reports/${report.id}/secondary-assessment`, second.cookie, completeSecondary());

    // A report already reviewed once: another round has to say why, so the next assessor knows
    // what they are being asked to look at.
    const refused = await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: third.id,
      comment: "   ",
    });

    expect(refused.statusCode).toBe(422);
    expect(refused.body).toContain("Say why another assessment is needed");
    expect((await assessmentsOf(report.id)).map((r) => r.ordinal)).toEqual([1, 2]);
    expect(await decisionsOf(report.id)).toHaveLength(1);
  });

  it("refuses both decisions to everyone but a manager, and writes nothing", async () => {
    const { manager, first, rest, report } = await afterFirstAssessment();
    const [second] = rest;
    if (second === undefined) throw new Error("need an Officer");

    const administrator = await signedInAs("administrator", "Admin");

    for (const who of [first, second, administrator]) {
      const next = await post(`/reports/${report.id}/assign-next-assessor`, who.cookie, {
        assessor_id: second.id,
        comment: "Let me assign this.",
      });
      expect(next.statusCode, `${who.name} assigning an assessor`).toBe(403);

      const work = await post(`/reports/${report.id}/assign-work-officer`, who.cookie, {
        officer_id: second.id,
      });
      expect(work.statusCode, `${who.name} assigning work`).toBe(403);
    }

    expect(await decisionsOf(report.id)).toHaveLength(0);
    expect((await assessmentsOf(report.id)).map((r) => r.ordinal)).toEqual([1]);
    expect(await statusOf(report.id)).toBe("awaiting_second_assessor");
    // And the manager still can, which is what makes the refusals above about the role.
    expect(
      (
        await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
          assessor_id: second.id,
          comment: "Please review it.",
        })
      ).statusCode,
    ).toBe(302);
  });

  it("refuses a work officer before the report is waiting on a decision", async () => {
    const { manager, rest, report } = await afterFirstAssessment();
    const [second, worker] = rest;
    if (second === undefined || worker === undefined) throw new Error("need two Officers");

    // Still awaiting the next assessor: there is nothing finished to be satisfied with yet.
    const early = await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
      officer_id: worker.id,
    });
    expect(early.statusCode).toBe(403);

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please review it.",
    });

    // And still refused while that assessment is open rather than submitted.
    const midway = await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
      officer_id: worker.id,
    });
    expect(midway.statusCode).toBe(403);

    expect(await decisionsOf(report.id)).toHaveLength(1);
    expect(await statusOf(report.id)).toBe("second_assessment");
  });

  it("refuses a submitted secondary assessment a second submission", async () => {
    const { manager, rest, report } = await afterFirstAssessment();
    const [second] = rest;
    if (second === undefined) throw new Error("need an Officer");

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please review it.",
    });
    await post(`/reports/${report.id}/secondary-assessment`, second.cookie, completeSecondary());

    const before = await assessmentsOf(report.id);

    const again = await post(
      `/reports/${report.id}/secondary-assessment`,
      second.cookie,
      completeSecondary({ "a2_degree_2.5": "disagree", "a2_value_2.5": "labelling" }),
    );

    expect(again.statusCode).toBe(403);
    expect(await assessmentsOf(report.id)).toEqual(before);
  });

  it("gives the manager one document carrying every assessor's position on the same item", async () => {
    const { manager, rest, report } = await afterFirstAssessment();
    const [second, third] = rest;
    if (second === undefined || third === undefined) throw new Error("need two Officers");

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please review it.",
    });
    await post(
      `/reports/${report.id}/secondary-assessment`,
      second.cookie,
      completeSecondary({
        "a2_degree_2.6": "disagree",
        "a2_value_2.6": "non_serious",
        "a2_statement_2.6": "Not serious on these facts.",
      }),
    );

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: third.id,
      comment: "One more opinion, please.",
    });
    await post(
      `/reports/${report.id}/secondary-assessment`,
      third.cookie,
      completeSecondary({
        "a2_degree_2.6": "clarification",
        "a2_statement_2.6": "Please confirm the intervention that was required.",
      }),
    );

    const body = (await get(`/reports/${report.id}`, manager.cookie)).body;

    // One F004, not three: the document is rendered once and each assessor's position is folded
    // in beside the item it is about.
    expect(body.match(/Adverse events \/ incidents of medical devices/g) ?? []).toHaveLength(1);

    // Both findings are on the page, each attributable to its own assessor.
    expect(body).toContain("Not serious on these facts.");
    expect(body).toContain("Please confirm the intervention that was required.");
    expect(body).toContain(second.name);
    expect(body).toContain(third.name);

    // The assessment history names all three, in order.
    expect(body).toContain("assessment-history");
    expect(body).toContain(">A2<");
    expect(body).toContain(">A3<");
  });
});
