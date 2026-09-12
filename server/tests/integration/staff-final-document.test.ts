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
 * The Final Document, over the wire: written by the approval, and by nothing else.
 *
 * `final-document.test.ts` pins the resolution as a function. This file pins the two things that
 * function cannot answer on its own — that the snapshot is taken at the moment the manager
 * approves and holds exactly what was approved, and that taking it leaves the Orange Report
 * exactly as the reporter filed it.
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
  const email = `final-${seeded}@tmda.go.tz`;
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

/** A1's F004, complete and submittable. 2.6 is `serious`, with a comment box beside it. */
function completeAssessment() {
  return {
    intent: "submit",
    signing_password: PASSWORD,
    device_type: "md",
    registration_number: "",
    device_class: "B",
    report_stage: "initial",
    source_of_event: "malfunction",
    c2_5: "Reported by the facility as a device malfunction.",
    seriousness: "serious",
    c2_6: "Patient required admission.",
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
  };
}

/** A secondary review that agrees with everything, unless an override says otherwise. */
function completeSecondary(overrides: Record<string, string> = {}) {
  return {
    intent: "submit",
    "a2_degree_1.3": "agree",
    "a2_degree_1.11": "agree",
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
    // Section 7 — this assessor's own concluding remarks, actions and signature. Required on
    // submit since the secondary assessment started collecting its own half of the F004.
    actions_2: "monitoring",
    conclusion_2: "Concur with the first assessment subject to the noted correction.",
    signing_password: PASSWORD,
    ...overrides,
  };
}

type Report = { id: string; number: string; assessor1_user_id: string | null };

async function onlyReport(): Promise<Report> {
  const rows = await owner.db.execute(sql`
    SELECT id, number, assessor1_user_id FROM reports
  `);
  expect(rows.length).toBe(1);
  return rows[0] as Report;
}

type Snapshot = {
  payload: {
    kind: string;
    answers: Record<string, string | string[]>;
    provenance: Record<string, { ordinal: number; degree: string; note?: string }>;
  };
  resolved_through_ordinal: number;
  form_version: string;
  approved_by_user_id: string;
};

async function statusOf(reportId: string): Promise<string> {
  const rows = await owner.db.execute(sql`
    SELECT status::text AS status FROM reports WHERE id = ${reportId}
  `);
  return (rows[0] as { status: string }).status;
}

async function snapshotOf(reportId: string): Promise<Snapshot | null> {
  const rows = await owner.db.execute(sql`
    SELECT payload, resolved_through_ordinal, form_version, approved_by_user_id
      FROM report_final_documents WHERE report_id = ${reportId}
  `);
  return rows.length === 0 ? null : (rows[0] as unknown as Snapshot);
}

/** Everything about the Orange Report that must survive the whole workflow, byte for byte. */
async function orangeOf(reportId: string) {
  const rows = await owner.db.execute(sql`
    SELECT payload, received_at, form_version, number FROM reports WHERE id = ${reportId}
  `);
  const row = rows[0] as {
    payload: unknown;
    received_at: Date;
    form_version: string;
    number: string;
  };
  return {
    payload: JSON.stringify(row.payload),
    receivedAt: new Date(row.received_at).toISOString(),
    formVersion: row.form_version,
    number: row.number,
  };
}

/** A report with A1 submitted, plus every Officer this suite might need. */
async function afterFirstAssessment() {
  const manager = await signedInAs("manager", "Grace Mollel");
  const pool = [
    await signedInAs("assessor", "Asha Mrema"),
    await signedInAs("assessor", "Baraka Nyoni"),
    await signedInAs("assessor", "Chausiku Njau"),
    await signedInAs("assessor", "Daudi Kimaro"),
  ];

  await fileAtThePublicDoor();
  const report = await onlyReport();

  const first = pool.find((s) => s.id === report.assessor1_user_id);
  if (first === undefined) throw new Error("intake assigned nobody this suite knows");
  const rest = pool.filter((s) => s.id !== first.id);

  const submitted = await post(
    `/reports/${report.id}/assessment-1`,
    first.cookie,
    completeAssessment(),
  );
  expect(submitted.statusCode).toBe(302);

  return { manager, first, rest, report };
}

/**
 * One whole report taken from filing to approval, with every part of it named.
 *
 * Its own manager and its own four Officers, so two calls produce two reports that share nobody.
 * That is the point for the cross-officer test below: a refusal that only held because the two
 * readers happened to be different people would prove nothing about the rule being asked for.
 */
async function approvedReport(label: string) {
  const manager = await signedInAs("manager", `Manager ${label}`);
  const pool = [
    await signedInAs("assessor", `${label} One`),
    await signedInAs("assessor", `${label} Two`),
    await signedInAs("assessor", `${label} Three`),
    await signedInAs("assessor", `${label} Four`),
  ];

  await fileAtThePublicDoor();

  const rows = await owner.db.execute(sql`
    SELECT id, number, assessor1_user_id FROM reports ORDER BY received_at DESC, number DESC LIMIT 1
  `);
  const report = rows[0] as Report;

  const a1 = pool.find((one) => one.id === report.assessor1_user_id);
  if (a1 === undefined) throw new Error("intake assigned nobody this suite knows");
  const rest = pool.filter((one) => one.id !== a1.id);
  const [secondAssessor, worker] = rest;
  if (secondAssessor === undefined || worker === undefined) throw new Error("need two Officers");

  await post(`/reports/${report.id}/assessment-1`, a1.cookie, completeAssessment());
  await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
    assessor_id: secondAssessor.id,
    comment: "Please review it.",
  });
  await post(
    `/reports/${report.id}/secondary-assessment`,
    secondAssessor.cookie,
    completeSecondary(),
  );
  const approved = await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
    officer_id: worker.id,
  });
  expect(approved.statusCode).toBe(302);

  return {
    manager,
    a1,
    secondAssessor,
    worker,
    id: report.id,
    number: report.number,
    finalDocumentUrl: `/reports/${report.id}/final-document`,
  };
}

describe.skipIf(!INTEGRATION_ENABLED)("the final document", () => {
  beforeEach(start);

  it("does not exist until the manager approves", async () => {
    const { manager, rest, report } = await afterFirstAssessment();
    const [second, worker] = rest;
    if (second === undefined || worker === undefined) throw new Error("need two Officers");

    // A1 is in and the manager has not decided. There is no final document, and the page for one
    // says so rather than resolving the chain on the fly and pretending.
    expect(await snapshotOf(report.id)).toBeNull();
    expect((await get(`/reports/${report.id}/final-document`, manager.cookie)).statusCode).toBe(
      404,
    );

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please review it.",
    });
    await post(`/reports/${report.id}/secondary-assessment`, second.cookie, completeSecondary());

    // A2 is in too. Still nothing: submitting an assessment is not approving one.
    expect(await snapshotOf(report.id)).toBeNull();

    await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
      officer_id: worker.id,
      comment: "Please carry out the recommended monitoring.",
    });

    const snapshot = await snapshotOf(report.id);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.payload.kind).toBe("final_document_v1");
    expect(snapshot?.resolved_through_ordinal).toBe(2);
    expect(snapshot?.form_version).toBe("TMDA/DMD/MDV/F/004 Rev 05");
  });

  it("resolves agree, disagree and clarification field by field, through A1 → A2 → A3", async () => {
    const { manager, rest, report } = await afterFirstAssessment();
    const [second, third, worker] = rest;
    if (second === undefined || third === undefined || worker === undefined) {
      throw new Error("need three Officers");
    }

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please review it.",
    });

    // A2: disagrees on 4.1 and on the risk level, clarifies 2.6, agrees with everything else.
    await post(
      `/reports/${report.id}/secondary-assessment`,
      second.cookie,
      completeSecondary({
        "a2_degree_4.1": "disagree",
        "a2_value_4.1": "expected",
        "a2_statement_4.1": "Listed in the manufacturer's IFU.",
        a2_degree_6: "disagree",
        a2_value_6: "low",
        a2_statement_6: "Isolated incident with a known cause.",
        "a2_degree_2.6": "clarification",
        "a2_statement_2.6": "Patient required admission for monitoring following device failure.",
      }),
    );

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: third.id,
      comment: "One more opinion on the risk, please.",
    });

    // A3: disagrees on the risk level again — superseding A2 — and agrees with the rest, which
    // includes agreeing with A1's own 4.1. Agreement must not undo A2's correction there.
    await post(
      `/reports/${report.id}/secondary-assessment`,
      third.cookie,
      completeSecondary({
        a2_degree_6: "disagree",
        a2_value_6: "medium",
        a2_statement_6: "Cause identified, but the lot is still in the field.",
      }),
    );

    await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
      officer_id: worker.id,
    });

    const snapshot = await snapshotOf(report.id);
    const answers = snapshot?.payload.answers ?? {};

    expect(snapshot?.resolved_through_ordinal).toBe(3);

    // Rule 2, twice over: the LAST resolved assessor's value wins.
    expect(answers.risk_level).toBe("medium");
    expect(answers.c6).toBe("Cause identified, but the lot is still in the field.");
    expect(snapshot?.payload.provenance["6"]).toMatchObject({ ordinal: 3, degree: "disagree" });

    // Rule 1 does not undo rule 2: A3 agreed with 4.1, and what stands there is A2's correction.
    expect(answers.expectedness).toBe("expected");
    expect(snapshot?.payload.provenance["4.1"]).toMatchObject({ ordinal: 2, degree: "disagree" });

    // Rule 3: the radio is still A1's, and only the words beside it changed.
    expect(answers.seriousness).toBe("serious");
    expect(answers.c2_6).toBe(
      "Patient required admission for monitoring following device failure.",
    );
    expect(snapshot?.payload.provenance["2.6"]).toMatchObject({
      ordinal: 2,
      degree: "clarification",
    });

    // Everything agreed with is A1's own, untouched.
    expect(answers.causality).toBe("probable");
    expect(answers.conclusion).toBe("Recommend risk communication and enhanced monitoring.");
    expect(answers.imdrf_component_code).toBe("E1204");

    // And the document carries the answers, never the argument.
    const serialised = JSON.stringify(snapshot?.payload.answers).toLowerCase();
    expect(serialised).not.toContain("disagree");
    expect(serialised).not.toContain("clarification");
  });

  it("leaves the Orange Report exactly as it was filed", async () => {
    const { manager, rest, report } = await afterFirstAssessment();
    const [second, worker] = rest;
    if (second === undefined || worker === undefined) throw new Error("need two Officers");

    const before = await orangeOf(report.id);

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
        "a2_statement_2.6": "Outpatient review only.",
      }),
    );
    await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
      officer_id: worker.id,
    });

    const after = await orangeOf(report.id);

    // The submission snapshot, the received date, the form revision and the number: all four are
    // the reporter's record of what they filed, and approving an assessment of it changes none.
    expect(after).toEqual(before);

    // The resolved answer moved, and it moved in the final document and nowhere else.
    const snapshot = await snapshotOf(report.id);
    expect(snapshot?.payload.answers.seriousness).toBe("non_serious");
  });

  it("keeps every assessment in the database, with its own dates, after approval", async () => {
    const { manager, rest, report } = await afterFirstAssessment();
    const [second, worker] = rest;
    if (second === undefined || worker === undefined) throw new Error("need two Officers");

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please review it.",
    });
    await post(`/reports/${report.id}/secondary-assessment`, second.cookie, completeSecondary());
    await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
      officer_id: worker.id,
    });

    const rows = await owner.db.execute(sql`
      SELECT ordinal, submitted_at FROM assessments WHERE report_id = ${report.id} ORDER BY ordinal
    `);

    // The working history survives approval intact — A1 and A2, each with its own submitted date,
    // neither of which is the report's received date.
    expect(rows.length).toBe(2);
    for (const raw of rows) {
      expect((raw as { submitted_at: Date | null }).submitted_at).not.toBeNull();
    }
  });

  it("shows the manager what they approved, and never re-resolves it", async () => {
    const { manager, first, rest, report } = await afterFirstAssessment();
    const [second, worker] = rest;
    if (second === undefined || worker === undefined) throw new Error("need two Officers");

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please review it.",
    });
    await post(
      `/reports/${report.id}/secondary-assessment`,
      second.cookie,
      completeSecondary({
        a2_degree_6: "disagree",
        a2_value_6: "low",
        a2_statement_6: "Isolated incident with a known cause.",
      }),
    );
    await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
      officer_id: worker.id,
      comment: "Please carry out the recommended monitoring.",
    });

    const page = await get(`/reports/${report.id}/final-document`, manager.cookie);
    expect(page.statusCode).toBe(200);

    // It is an F004 — the real form, read-only, with the F004's own masthead and section bars.
    expect(page.body).toContain("TMDA/DMD/MDV/F/004 Rev 05");
    expect(page.body).toContain("Relationship / causality assessment");
    expect(page.body).toContain("IMDRF category of the adverse incident / event");

    // Read-only means no form element and no posting target at all.
    expect(page.body).not.toContain(`action="/reports/${report.id}/assessment-1"`);
    expect(page.body).not.toContain(`action="/reports/${report.id}/secondary-assessment"`);

    // The Orange Report's identity, as the source document being assessed.
    expect(page.body).toContain("Orange Report · F001");
    expect(page.body).toContain(report.number);

    // The approval itself, named — and it is the only name on the document.
    expect(page.body).toContain("Grace Mollel");
    expect(page.body).toContain("Approved by");
    expect(page.body).toContain("Date of approval");

    // The concluded F004 says it once. The title bar carries "Final F004"; the page does not
    // repeat it, and the sentence that used to explain the document is gone.
    expect(page.body).not.toContain("<h2>Final F004</h2>");
    expect(page.body).not.toContain("resolved to one answer per question");

    // No assessor reaches this page at all — not A1, not the secondary assessor, not their dates,
    // not the strip that names them, and not the secondary assessor's slot or their 7.2.
    expect(page.body).not.toContain("1st Assessor");
    expect(page.body).not.toContain("Secondary assessor");
    expect(page.body).not.toContain(first.name);
    expect(page.body).not.toContain(second.name);
    expect(page.body).not.toContain("concluding remarks");

    // The work officer is the one person named beside the manager, and only in the card above the
    // document — metadata about the report, never a signatory of the F004.
    expect(page.body).toContain(worker.name);
    expect(page.body).toContain("Assigned for work to");
    // How far the chain ran belongs on the Final Reports register, not on the document.
    expect(page.body).not.toContain("Assessments resolved");

    // The way out is named for what it opens, and it opens the Orange Report.
    expect(page.body).toContain("Open Orange Report");
    expect(page.body).not.toContain("Back to the report");

    // The resolved answer is what the form's own control shows as chosen: A2 replaced High with
    // Low, so the Low radio is the checked one and High is not.
    expect(page.body).toContain('name="risk_level" value="low" checked');
    expect(page.body).not.toContain('name="risk_level" value="high" checked');
    // And the statement A2 supplied stands in the comment box beside it.
    expect(page.body).toContain("Isolated incident with a known cause.");

    // Not an assessment history: none of the degree machinery is drawn through the form.
    expect(page.body).not.toContain("Disagree");
    expect(page.body).not.toContain("Required clarification");
    expect(page.body).not.toContain("a2_degree_");
    expect(page.body).not.toContain("Previous assessments");

    // The report page offers the way in, once there is one.
    const reportPage = (await get(`/reports/${report.id}`, manager.cookie)).body;
    expect(reportPage).toContain(`href="/reports/${report.id}/final-document"`);
  });

  it("shows the assigned Officer their own work's final document, and refuses everyone else", async () => {
    const { manager, first, rest, report } = await afterFirstAssessment();
    const [second, worker] = rest;
    if (second === undefined || worker === undefined) throw new Error("need two Officers");

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please review it.",
    });
    await post(`/reports/${report.id}/secondary-assessment`, second.cookie, completeSecondary());
    await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
      officer_id: worker.id,
    });

    // The Officer carrying out the work reads it, and their way back is their own work list.
    const theirs = await get(`/reports/${report.id}/final-document`, worker.cookie);
    expect(theirs.statusCode).toBe(200);
    expect(theirs.body).toContain(`href="/my-work/${report.id}"`);

    // Their work item links to it.
    const item = await get(`/my-work/${report.id}`, worker.cookie);
    expect(item.statusCode).toBe(200);
    expect(item.body).toContain(`href="/reports/${report.id}/final-document"`);
    expect(item.body).toContain("Orange Report · F001");

    // My Work is one Officer's own list and nobody else's. A1 assessed this report and is still
    // refused: assessing it is not being assigned the work that came out of it.
    expect((await get(`/my-work/${report.id}`, first.cookie)).statusCode).toBe(403);
    expect((await get("/my-work", first.cookie)).body).not.toContain(report.number);
    expect((await get("/my-work", worker.cookie)).body).toContain(report.number);

    // Neither page offers the Officer a way into the general workflow, and the work item no
    // longer carries the working record: no assessor named, no decision history, no report page.
    expect(theirs.body).not.toContain(`href="/reports/${report.id}"`);
    expect(item.body).not.toContain(`href="/reports/${report.id}"`);
    expect(item.body).not.toContain("How it was assessed");
    expect(item.body).not.toContain("Open the full report and assessments");
    expect(item.body).not.toContain(second.name);
  });

  /*
   * Changing the uuid in the address is the whole attack, and it is the whole test.
   *
   * Two Officers, two approved reports, and neither may read the other's document. The check is
   * not "is this reader an Officer" and not "does this report have a final document" — it is
   * whether the `assign_work_officer` decision THIS document was written from names this reader,
   * asked of the row that was actually loaded. Nothing about the address is trusted.
   */
  it("refuses one Officer the Final F004 of another Officer's assigned work", async () => {
    const alpha = await approvedReport("Alpha");
    const bravo = await approvedReport("Bravo");

    // Each reads their own.
    expect((await get(alpha.finalDocumentUrl, alpha.worker.cookie)).statusCode).toBe(200);
    expect((await get(bravo.finalDocumentUrl, bravo.worker.cookie)).statusCode).toBe(200);

    // Neither reads the other's, whichever way round the swap is made.
    expect((await get(bravo.finalDocumentUrl, alpha.worker.cookie)).statusCode).toBe(403);
    expect((await get(alpha.finalDocumentUrl, bravo.worker.cookie)).statusCode).toBe(403);

    // Nothing of the refused document leaks into the refusal.
    const refused = await get(bravo.finalDocumentUrl, alpha.worker.cookie);
    expect(refused.body).not.toContain(bravo.number);

    // Having assessed a report is not being assigned the work that came out of it: A1 and the
    // secondary assessor are refused the document too, on the same rule.
    expect((await get(alpha.finalDocumentUrl, alpha.a1.cookie)).statusCode).toBe(403);
    expect((await get(alpha.finalDocumentUrl, alpha.secondAssessor.cookie)).statusCode).toBe(403);

    // A manager reads either one. They approve these documents and hold the register of them.
    expect((await get(alpha.finalDocumentUrl, alpha.manager.cookie)).statusCode).toBe(200);
    expect((await get(bravo.finalDocumentUrl, alpha.manager.cookie)).statusCode).toBe(200);
  });

  /*
   * The register is not an Officer's, and neither is the report page once the case is over.
   *
   * Dropping the rail entry is presentation. This is the part that holds when somebody types the
   * address: `/reports` is refused outright, a report the Officer is not a party to is refused,
   * and their own case is refused once it reaches `assigned_for_work` — which is exactly when the
   * report page starts carrying the settled decision history and every assessor's document.
   */
  it("keeps an Officer out of the register, and out of the report page once the work is assigned", async () => {
    const { manager, first, rest, report } = await afterFirstAssessment();
    const [second, worker, stranger] = rest;
    if (second === undefined || worker === undefined || stranger === undefined) {
      throw new Error("need three Officers");
    }

    // The register itself: never, at any stage.
    expect((await get("/reports", first.cookie)).statusCode).toBe(403);
    expect((await get("/reports", worker.cookie)).statusCode).toBe(403);
    expect((await get("/reports", manager.cookie)).statusCode).toBe(200);

    // Their own case, while it is live: A1 may open it, an unrelated Officer may not.
    expect((await get(`/reports/${report.id}`, first.cookie)).statusCode).toBe(200);
    expect((await get(`/reports/${report.id}`, stranger.cookie)).statusCode).toBe(403);

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please review it.",
    });
    await post(`/reports/${report.id}/secondary-assessment`, second.cookie, completeSecondary());
    await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
      officer_id: worker.id,
    });

    // Approved. The workflow is over for every Officer on it — the two who assessed it and the
    // one carrying out the work alike.
    expect(await statusOf(report.id)).toBe("assigned_for_work");
    for (const who of [first, second, worker]) {
      expect((await get(`/reports/${report.id}`, who.cookie)).statusCode).toBe(403);
    }

    // The manager keeps it, because the record of how it was decided is theirs.
    expect((await get(`/reports/${report.id}`, manager.cookie)).statusCode).toBe(200);

    // And My assessments stops offering a link it knows would be refused.
    const queue = await get("/assessments", first.cookie);
    expect(queue.statusCode).toBe(200);
    expect(queue.body).toContain(report.number);
    expect(queue.body).not.toContain(`href="/reports/${report.id}"`);
  });

  /*
   * A snapshot resolved from A1 alone is history, not a concluded Final F004.
   *
   * The live approval cannot write one — `assign-work-officer` refuses. `backfill-final-documents`
   * could, before it was taught the same rule, and the rows it wrote are still in the table. They
   * stay there: what this pins is the read side, which is that such a row is neither listed as a
   * Final Report nor served as a Final F004, to anybody.
   */
  it("does not expose an A1-only legacy snapshot as a Final Report", async () => {
    const { manager, first, rest, report } = await afterFirstAssessment();
    const [second, worker] = rest;
    if (second === undefined || worker === undefined) throw new Error("need two Officers");

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please review it.",
    });
    await post(`/reports/${report.id}/secondary-assessment`, second.cookie, completeSecondary());
    await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
      officer_id: worker.id,
    });

    // A real, valid document first, so the only difference below is the ordinal.
    expect((await get("/final-reports", manager.cookie)).body).toContain(report.number);
    expect((await get(`/reports/${report.id}/final-document`, manager.cookie)).statusCode).toBe(
      200,
    );

    // Now make the row look like what the old backfill wrote: resolved through A1 alone. It is
    // otherwise untouched — same payload, same decision, same approver.
    await owner.db.execute(sql`
      UPDATE report_final_documents SET resolved_through_ordinal = 1
       WHERE report_id = ${report.id}
    `);

    // Gone from the register, and the document itself answers 404 rather than presenting an
    // unreviewed first assessment as the office's settled position.
    const listed = await get("/final-reports", manager.cookie);
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain(report.number);
    expect(listed.body).toContain("No final report yet");

    expect((await get(`/reports/${report.id}/final-document`, manager.cookie)).statusCode).toBe(
      404,
    );
    // Not served to the assigned Officer either: it is not a permissions question for them.
    expect((await get(`/reports/${report.id}/final-document`, worker.cookie)).statusCode).toBe(404);
    // An Officer who is not the work officer is still refused before the ordinal is even reached.
    expect((await get(`/reports/${report.id}/final-document`, first.cookie)).statusCode).toBe(403);

    // And the row is still there. Nothing deleted it and nothing rewrote its payload.
    const snapshot = await snapshotOf(report.id);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.payload.kind).toBe("final_document_v1");
  });

  /*
   * A1 is never approved on its own.
   *
   * The office's rule is that a first assessment is always read by a second assessor before
   * anything is decided, so the shortest legitimate path is A1 → assign A2 → A2 submits → approve.
   * Nothing about the status alone said so: `awaiting_decision` was reachable only through a
   * secondary submission in practice, and the route trusted that rather than checking it.
   */
  it("refuses to approve off A1 alone, and allows it once a secondary assessment is in", async () => {
    const { manager, rest, report } = await afterFirstAssessment();
    const [second, worker] = rest;
    if (second === undefined || worker === undefined) throw new Error("need two Officers");

    // A1 is submitted and the report is with the manager — but there is nothing to approve yet.
    expect(await statusOf(report.id)).toBe("awaiting_second_assessor");
    const early = await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
      officer_id: worker.id,
    });
    expect(early.statusCode).toBe(403);
    expect(await snapshotOf(report.id)).toBeNull();
    expect(await statusOf(report.id)).toBe("awaiting_second_assessor");

    // The page does not offer it either, so the refusal is never a surprise.
    const beforePage = await get(`/reports/${report.id}`, manager.cookie);
    expect(beforePage.body).not.toContain(`action="/reports/${report.id}/assign-work-officer"`);
    expect(beforePage.body).toContain(`action="/reports/${report.id}/assign-next-assessor"`);

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please take the second assessment.",
    });

    // Assigned but not yet submitted: still nothing to approve, because an open assessment is not
    // a finding and a document frozen over one would omit work already commissioned.
    const midway = await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
      officer_id: worker.id,
    });
    expect(midway.statusCode).toBe(403);
    expect(await snapshotOf(report.id)).toBeNull();

    await post(`/reports/${report.id}/secondary-assessment`, second.cookie, completeSecondary());
    expect(await statusOf(report.id)).toBe("awaiting_decision");

    // Now it is approvable, and the document is written.
    const approved = await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
      officer_id: worker.id,
    });
    expect(approved.statusCode).toBe(302);
    expect(await statusOf(report.id)).toBe("assigned_for_work");
    expect(await snapshotOf(report.id)).not.toBeNull();
  });

  it("indexes the approved document for the manager, and refuses the list to an Officer", async () => {
    const { manager, first, rest, report } = await afterFirstAssessment();
    const [second, worker] = rest;
    if (second === undefined || worker === undefined) throw new Error("need two Officers");

    // Empty before any approval, and saying so rather than drawing a header over nothing.
    const before = await get("/final-reports", manager.cookie);
    expect(before.statusCode).toBe(200);
    expect(before.body).toContain("No final report yet");
    expect(before.body).not.toContain(report.number);

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please review it.",
    });
    await post(`/reports/${report.id}/secondary-assessment`, second.cookie, completeSecondary());
    await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
      officer_id: worker.id,
    });

    const listed = await get("/final-reports", manager.cookie);
    expect(listed.statusCode).toBe(200);
    expect(listed.body).toContain(report.number);
    // Both ways in: the document itself, and the Orange Report it was assessed from.
    expect(listed.body).toContain(`href="/reports/${report.id}/final-document"`);
    expect(listed.body).toContain(`href="/reports/${report.id}"`);
    expect(listed.body).toContain("Orange Report");
    // Who approved it, who is carrying it out, and how far the chain ran.
    expect(listed.body).toContain("Grace Mollel");
    expect(listed.body).toContain(worker.name);
    expect(listed.body).toContain("A1 – A2");
    expect(listed.body).toContain("Assigned for work");

    // The list is the manager's. An Officer is refused it rather than shown the register's.
    expect((await get("/final-reports", worker.cookie)).statusCode).toBe(403);
    expect((await get("/final-reports", first.cookie)).statusCode).toBe(403);
  });

  it("puts Workload, Reports and Final Reports in the manager's rail alone", async () => {
    const { manager, first } = await afterFirstAssessment();

    // A manager's dashboard renders for them now instead of redirecting to the workload, and the
    // rail carries both — the summary and the queue answer different questions.
    const dashboard = await get("/dashboard", manager.cookie);
    expect(dashboard.statusCode).toBe(200);
    for (const href of ["/dashboard", "/workload", "/reports", "/final-reports"]) {
      expect(dashboard.body, href).toContain(`href="${href}"`);
    }
    // The four states, under the words the workload page already uses for them, and never a
    // database status.
    for (const label of ["Not started", "In progress", "Decision", "Assigned for work"]) {
      expect(dashboard.body, label).toContain(label);
    }
    expect(dashboard.body).not.toContain("awaiting_second_assessor");
    expect(dashboard.body).not.toContain("assigned_for_work");

    // The Officer's rail carries their own lists and nothing else. The register is gone from it:
    // it lists every report in the office, and `reportsRoutes` refuses it to them anyway.
    const officer = await get("/dashboard", first.cookie);
    expect(officer.statusCode).toBe(200);
    for (const href of ["/dashboard", "/assessments", "/my-work", "/reports/new"]) {
      expect(officer.body, href).toContain(`href="${href}"`);
    }
    expect(officer.body).not.toContain('href="/reports"');
    expect(officer.body).not.toContain('href="/final-reports"');
    expect(officer.body).not.toContain('href="/workload"');
  });

  it("is never served from the browser cache, signed in or out", async () => {
    const { manager, rest, report } = await afterFirstAssessment();
    const [second, worker] = rest;
    if (second === undefined || worker === undefined) throw new Error("need two Officers");

    await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please review it.",
    });
    await post(`/reports/${report.id}/secondary-assessment`, second.cookie, completeSecondary());
    await post(`/reports/${report.id}/assign-work-officer`, manager.cookie, {
      officer_id: worker.id,
    });

    // Every protected page, not only this one. The header is stamped on the scope, so a page added
    // to it next year is uncacheable because of where it was registered.
    for (const url of [
      `/reports/${report.id}/final-document`,
      `/reports/${report.id}`,
      "/workload",
      "/reports",
    ]) {
      const res = await get(url, manager.cookie);
      expect(res.headers["cache-control"], url).toContain("no-store");
    }

    // And after signing out, the same address is a redirect to the sign-in page — also no-store,
    // so a Back button cannot redraw the last page from the history cache instead of asking us.
    const out = await app.inject({
      method: "POST",
      url: "/logout",
      headers: {
        host: STAFF_HOST,
        cookie: manager.cookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: "",
    });
    expect(out.statusCode).toBe(303);

    const after = await get(`/reports/${report.id}/final-document`, manager.cookie);
    expect(after.statusCode).toBe(302);
    expect(after.headers.location).toBe("/");
    expect(after.headers["cache-control"]).toContain("no-store");
  });
});
