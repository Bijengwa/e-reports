import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/auth/password.js";
import type { Config } from "../../src/config.js";
import type { DatabaseHandle } from "../../src/db/client.js";
import { buildServer } from "../../src/server.js";
import {
  INTEGRATION_ENABLED,
  openApp,
  openOwner,
  requireTestDatabase,
  truncateAll,
} from "./helpers.js";
import { type ImdrfFixture, imdrfAssessmentFields, seedImdrfForF004 } from "./imdrf-fixture.js";

/**
 * Naming the second assessor.
 *
 * `staff-assignment` pins who a report goes to at intake and `staff-assessment-write` pins what the
 * first assessor does with it. This is the handover between them: the manager's queue of reports
 * whose first assessment is in, and the one POST that hands one on.
 */

const STAFF_HOST = "staff.test";
const PUBLIC_HOST = "public.test";
const PASSWORD = "a correct staff password";
const COOKIE = "__Host-ae_session";

/** A uuid that is well-formed and names nothing, for the "no such user" case. */
const NOBODY = "00000000-0000-4000-8000-000000000000";

type Role = "administrator" | "manager" | "assessor";
type Staff = { cookie: string; id: string; name: string };

let owner: DatabaseHandle;
let restricted: DatabaseHandle;
let app: FastifyInstance;
let imdrf: ImdrfFixture;

/** The server under test connects as the restricted role, so a missing GRANT fails here. */
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
  await restricted?.close();
  await owner?.close();
});

async function start(): Promise<void> {
  owner ??= openOwner();
  app ??= await buildServer(testConfig());
  await app.ready();
  await truncateAll(owner.db);
  imdrf = await seedImdrfForF004(owner.db);
}

let seeded = 0;

async function signedInAs(role: Role, name?: string): Promise<Staff> {
  seeded += 1;
  const email = `second-${seeded}@tmda.go.tz`;
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

/** On the books, switched off: never a candidate, and never chosen at intake either. */
async function inactiveAssessor(): Promise<string> {
  seeded += 1;
  const rows = await owner.db.execute(sql`
    INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
    VALUES (${`second-${seeded}@tmda.go.tz`}, 'On leave', 'assessor',
            ${await hashPassword(PASSWORD)}, false, false)
    RETURNING id
  `);
  return (rows[0] as { id: string }).id;
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
  assessor2_assigned_at: Date | null;
};

async function reportRow(id: string): Promise<Row> {
  const rows = await owner.db.execute(sql`
    SELECT id, number, status::text AS status, assessor1_user_id, assessor2_user_id,
           assessor2_assigned_at
      FROM reports WHERE id = ${id}
  `);
  expect(rows.length).toBe(1);
  return rows[0] as Row;
}

async function onlyReport(): Promise<Row> {
  const rows = await owner.db.execute(sql`
    SELECT id, number, status::text AS status, assessor1_user_id, assessor2_user_id,
           assessor2_assigned_at
      FROM reports
  `);
  expect(rows.length).toBe(1);
  return rows[0] as Row;
}

/** A report inserted straight to a status, for the queue cases and the no-assessment case. */
async function seedReport(over: {
  number: string;
  status: string;
  receivedAt?: string;
  assessor1?: string;
}): Promise<string> {
  const rows = await owner.db.execute(sql`
    INSERT INTO reports (number, channel, severity, status, device_name, form_version, payload,
                         received_at, assessor1_user_id, assessor1_assigned_at)
    VALUES (${over.number}, 'online_form', 'other', ${over.status}::report_status, 'Seeded device',
            'F001', '{}'::jsonb,
            ${over.receivedAt ?? "2026-08-01T00:00:00Z"}::timestamptz,
            ${over.assessor1 ?? null}, ${over.assessor1 ? sql`now()` : sql`NULL`})
    RETURNING id
  `);
  return (rows[0] as { id: string }).id;
}

type Waiting = { manager: Staff; officer: Staff; other: Staff; report: Row };

/**
 * A report that has genuinely reached the handover: filed at the public door, assigned by intake,
 * and its first assessment submitted through the real route rather than written into the table.
 */
async function waiting(): Promise<Waiting> {
  const manager = await signedInAs("manager", "Mgr");
  const a = await signedInAs("assessor", "Asha Mrema");
  const b = await signedInAs("assessor", "Baraka Nyoni");

  await fileAtThePublicDoor();
  const filed = await onlyReport();

  // Intake no longer names an Officer; standing in for the Manager's manual assignment until that
  // route exists. `a` is the first assessor here and `b` is the only valid second assessor.
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

function assign(report: Row, cookie: string, assessorId: string) {
  return post(`/reports/${report.id}/assign-next-assessor`, cookie, { assessor_id: assessorId });
}

/**
 * Who holds the secondary assessment of a report, read from where it actually lives now: an
 * `assessments` row at ordinal 2 or above, not a column on the report.
 */
async function secondaryAssessorOf(reportId: string): Promise<string | null> {
  const rows = await owner.db.execute(sql`
    SELECT assessor_id FROM assessments
     WHERE report_id = ${reportId} AND ordinal > 1
     ORDER BY ordinal DESC LIMIT 1
  `);
  return rows.length === 0 ? null : (rows[0] as { assessor_id: string }).assessor_id;
}

/** What this slice may move, as one value, so a case can assert it did not. */
async function assignment(row: Row) {
  return { status: (await reportRow(row.id)).status, assessor2: await secondaryAssessorOf(row.id) };
}

/** A bucket's figure on the workload page, asserted as markup so a bare label cannot satisfy it. */
function bucketStat(label: string, count: number): string {
  return `<span>${label}</span> <span class="wl-count">${count}</span>`;
}

/**
 * The state a report sits in once its assessment is in and the manager must act — after A1 and
 * after every An alike. One state, not two: "name the next assessor" and "approve it" are both
 * decisions, and which of them is available depends on rules the report page owns. A tab that
 * guessed at those rules would be a second, quieter copy of them.
 */
const ASSIGN_NEXT = "Decision";
const ASSIGN_NEXT_STAGE = "decision";

describe.skipIf(!INTEGRATION_ENABLED)("the manager's pipeline", () => {
  beforeEach(start);

  it("counts every bucket and lists them all, newest first", async () => {
    const manager = await signedInAs("manager", "Mgr");

    await seedReport({
      number: "MD-AE/2026/8001",
      status: "awaiting_second_assessor",
      receivedAt: "2026-08-01T00:00:00Z",
    });
    await seedReport({
      number: "MD-AE/2026/8002",
      status: "awaiting_second_assessor",
      receivedAt: "2026-08-05T00:00:00Z",
    });
    await seedReport({ number: "MD-AE/2026/8003", status: "received" });
    await seedReport({ number: "MD-AE/2026/8004", status: "first_assessment" });
    await seedReport({ number: "MD-AE/2026/8005", status: "second_assessment" });

    const body = (await get("/workload", manager.cookie)).body;

    // Unfiltered, so every bucket's reports are listed and every bucket's figure is its own.
    for (const number of ["8001", "8002", "8003", "8004", "8005"]) {
      expect(body, number).toContain(`MD-AE/2026/${number}`);
    }
    expect(body).toContain(bucketStat(ASSIGN_NEXT, 2));
    expect(body).toContain(bucketStat("Not started", 1));
    // A1 writing and A2 writing are one figure: an Officer is assessing it, and the row's own
    // Assessment column is where A1/A2/A3 belongs.
    expect(body).toContain(bucketStat("In progress", 2));
    expect(body).toContain(bucketStat("Assigned for work", 0));

    // Newest first: the later arrival is printed above the earlier one.
    expect(body.indexOf("MD-AE/2026/8002")).toBeLessThan(body.indexOf("MD-AE/2026/8001"));
  });

  it("narrows to one bucket when a card is followed", async () => {
    const manager = await signedInAs("manager", "Mgr");

    await seedReport({ number: "MD-AE/2026/8011", status: "awaiting_second_assessor" });
    await seedReport({ number: "MD-AE/2026/8012", status: "received" });

    const body = (await get(`/workload?stage=${ASSIGN_NEXT_STAGE}`, manager.cookie)).body;

    expect(body).toContain("MD-AE/2026/8011");
    expect(body).not.toContain("MD-AE/2026/8012");
    // The figures still count the whole register, so the bucket filtered out keeps its own.
    expect(body).toContain(bucketStat("Not started", 1));
    // The chosen card is marked, and offers the way back out.
    expect(body).toContain('aria-current="true"');
    expect(body).toContain('href="/workload"');
  });

  it("says so plainly when a bucket is empty", async () => {
    const manager = await signedInAs("manager", "Mgr");
    await seedReport({ number: "MD-AE/2026/8010", status: "received" });

    const body = (await get(`/workload?stage=${ASSIGN_NEXT_STAGE}`, manager.cookie)).body;

    expect(body).toContain(bucketStat(ASSIGN_NEXT, 0));
    expect(body).toContain("No reports are in this state right now.");
    // No header over an empty body: that reads as a list that failed to load.
    expect(body).not.toContain("<table");
  });

  it("keeps the pipeline to the manager, and this queue off an Officer's dashboard", async () => {
    const officer = await signedInAs("assessor", "Asha Mrema");
    const admin = await signedInAs("administrator", "Adm");
    await seedReport({ number: "MD-AE/2026/8020", status: "awaiting_second_assessor" });

    // Refused by the scope the route is registered in, exactly as the assign POST is.
    for (const [who, staff] of [
      ["an Officer", officer],
      ["an administrator", admin],
    ] as const) {
      expect((await get("/workload", staff.cookie)).statusCode, who).toBe(403);
    }

    const body = (await get("/dashboard", officer.cookie)).body;
    expect(body).not.toContain("MD-AE/2026/8020");
    // Their own queue is untouched by the pipeline moving off the dashboard.
    expect(body).toContain('<span class="eyebrow">Received</span>');
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("who the picker offers", () => {
  beforeEach(start);

  /** The ids the picker actually offers, read out of the rendered menu. */
  function offered(body: string): string[] {
    const select = body.match(/<select[^>]*name="assessor_id"[^>]*>([\s\S]*?)<\/select>/);
    if (select === null) return [];
    return [...select[1].matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  }

  /** The page's top bar alone, which ends where the report's own document begins. */
  function topBar(body: string): string {
    return body.slice(body.indexOf('<div class="staff-head">'), body.indexOf("report-facts"));
  }

  it("offers the other active Officers", async () => {
    const { manager, other, report } = await waiting();
    const third = await signedInAs("assessor", "Chausiku Njau");

    const options = offered((await get(`/reports/${report.id}`, manager.cookie)).body);

    expect(options).toContain(other.id);
    expect(options).toContain(third.id);
  });

  it("never offers the first assessor of that report", async () => {
    const { manager, officer, other, report } = await waiting();

    const body = (await get(`/reports/${report.id}`, manager.cookie)).body;

    // The one rule this list exists to respect: one report is reviewed by two people. Offering the
    // first assessor would offer an assignment the POST refuses, and a control that can only
    // produce a refusal is worse than no control.
    expect(offered(body)).not.toContain(officer.id);
    expect(offered(body)).toContain(other.id);
    expect(body).not.toContain(`value="${officer.id}"`);
  });

  it("offers nobody who is not an active Officer", async () => {
    const { manager, report } = await waiting();
    const otherManager = await signedInAs("manager", "Second Mgr");
    const admin = await signedInAs("administrator", "Adm");
    const dormant = await inactiveAssessor();

    const options = offered((await get(`/reports/${report.id}`, manager.cookie)).body);

    for (const [who, id] of [
      ["a manager", otherManager.id],
      ["an administrator", admin.id],
      ["a deactivated Officer", dormant],
      ["the manager reading the page", manager.id],
    ] as const) {
      expect(options, who).not.toContain(id);
    }
  });

  it("says so plainly when excluding the first assessor leaves nobody", async () => {
    // The only active Officer on the system is the one who wrote the first assessment, so the
    // exclusion empties the list — and the page says that rather than drawing an empty menu.
    const manager = await signedInAs("manager", "Mgr");
    const officer = await signedInAs("assessor", "Asha Mrema");

    await fileAtThePublicDoor();
    const filed = await onlyReport();
    await owner.db.execute(sql`
      UPDATE reports SET assessor1_user_id = ${officer.id}, assessor1_assigned_at = now()
       WHERE id = ${filed.id}
    `);

    const submitted = await post(
      `/reports/${filed.id}/assessment-1`,
      officer.cookie,
      completeAssessment(),
    );
    expect(submitted.statusCode).toBe(302);

    const body = (await get(`/reports/${filed.id}`, manager.cookie)).body;

    expect(body).toContain("No eligible Officer is free to take the next assessment.");
    expect(body).not.toContain('name="assessor_id"');
  });

  /**
   * The assignment used to sit in the page's top bar. It sits below the first assessment now, and
   * below the manager's review of it, because those are the two things a manager does before
   * deciding who to hand the report to — and a control for the third step read above the first.
   *
   * What has not changed is that it is still a heading and a bar, like the assessment above it,
   * rather than a framed card of its own.
   */
  it("puts the assignment after the assessment and its review, still without a card", async () => {
    const { manager, report } = await waiting();

    const body = (await get(`/reports/${report.id}`, manager.cookie)).body;

    const assessment = body.indexOf("First assessment");
    const review = body.indexOf(`/reports/${report.id}/assessment-1/comment`);
    const assign = body.indexOf(`/reports/${report.id}/assign-next-assessor`);

    expect(assessment).toBeGreaterThan(-1);
    expect(review).toBeGreaterThan(assessment);
    expect(assign).toBeGreaterThan(review);

    // The same plain bar the rest of the door uses for a row of controls.
    expect(body).toContain(
      `<form method="POST" action="/reports/${report.id}/assign-next-assessor" class="card card-b review-form">`,
    );

    // The assessment history strip names who holds each assessment, in the top bar. Nobody holds
    // a secondary one yet, so A1 is the only entry.
    const head = topBar(body);
    expect(head).toContain("assessment-history");
    expect(head).toContain(">A1<");
    expect(head).not.toContain(">A2<");
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("what the assignment hands over", () => {
  beforeEach(start);

  it("puts the report on the second assessor's own work list, and nobody else's", async () => {
    const { manager, officer, other, report } = await waiting();

    // Before: it is the first assessor's submitted work, and nothing of the second's.
    const beforeOther = (await get("/assessments", other.cookie)).body;
    expect(beforeOther).not.toContain(report.number);
    expect(beforeOther).toContain("Nothing is waiting for you to start.");

    await assign(report, manager.cookie, other.id);

    // Theirs now, at the ordinal they were given, and in the same Not started state an A1 would
    // be in — not in a category of its own whose only meaning is “secondary”.
    const afterOther = (await get("/assessments", other.cookie)).body;
    expect(afterOther).toContain(report.number);
    expect(afterOther).toContain("<td>A2</td>");
    expect(afterOther).toContain('<span class="tag muted">Not started</span>');
    expect(afterOther).not.toContain("Nothing is waiting for you to start.");

    // The first assessor still has it, still listed as sent on rather than as theirs to review.
    const afterFirst = (await get("/assessments", officer.cookie)).body;
    expect(afterFirst).toContain(report.number);
    expect(afterFirst).toContain("<td>A1</td>");
    expect(afterFirst).toContain('<span class="tag muted">Submitted</span>');
    // Another Officer's A2 is not theirs, and does not reach their page at all.
    expect(afterFirst).not.toContain("<td>A2</td>");

    // A colleague who was named neither sees nothing of it.
    const stranger = await signedInAs("assessor", "Chausiku Njau");
    expect((await get("/assessments", stranger.cookie)).body).not.toContain(report.number);
  });

  it("does not offer the second assessor the first assessment's page", async () => {
    const { manager, other, report } = await waiting();

    await assign(report, manager.cookie, other.id);

    const body = (await get("/assessments", other.cookie)).body;

    // Their row opens the report, not a form that is not theirs to write — and the route agrees.
    expect(body).toContain(`href="/reports/${report.id}"`);
    expect(body).not.toContain(`href="/reports/${report.id}/assessment-1"`);
    expect((await get(`/reports/${report.id}/assessment-1`, other.cookie)).statusCode).toBe(403);
  });

  it("names both assessors on the report for the manager to read back", async () => {
    const { manager, officer, other, report } = await waiting();

    const before = (await get(`/reports/${report.id}`, manager.cookie)).body;
    expect(before).toContain(officer.name);
    // Nobody holds the second half yet, and the top bar says so rather than leaving it blank.
    expect(before).not.toContain("A2");

    await assign(report, manager.cookie, other.id);

    const after = (await get(`/reports/${report.id}`, manager.cookie)).body;
    // Both now read on the assessment-history strip, each named beside its own ordinal.
    expect(after).toContain(officer.name);
    expect(after).toContain(other.name);
    expect(after).toContain(">A2<");
  });

  it("offers the manager the way in from the state that is waiting on them", async () => {
    const { manager, other, report } = await waiting();

    // The row's own link, matched as the anchor rather than as bare words. It says Decide — the
    // move this state asks for — and which decision, and who may be named, is settled on the
    // report, where those rules are enforced.
    const rowLink = `<a href="/reports/${report.id}">Decide</a>`;

    const waitingState = (await get(`/workload?stage=${ASSIGN_NEXT_STAGE}`, manager.cookie)).body;
    expect(waitingState).toContain(rowLink);
    // The list names the state — that is what a tab and a status cell are for — but carries no way
    // of acting on it. The duplicate control it used to hold is gone: no form, and nobody to pick.
    expect(waitingState).not.toContain("/assign-next-assessor");
    expect(waitingState).not.toContain("<select");
    // The action lives on the report the link points at, and nowhere else.
    expect((await get(`/reports/${report.id}`, manager.cookie)).body).toContain(
      `/reports/${report.id}/assign-next-assessor`,
    );

    await assign(report, manager.cookie, other.id);

    // Once named, the row says which assessment the report is on and who has it, rather than
    // offering a way in again.
    const working = (await get("/workload?stage=in-progress", manager.cookie)).body;
    expect(working).toContain("<td>A2</td>");
    expect(working).toContain(`<td><span>${other.name}</span></td>`);
    expect(working).toContain(`<a href="/reports/${report.id}">Open</a>`);
    expect(working).not.toContain(rowLink);
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("assigning one", () => {
  beforeEach(start);

  it("names a different active Officer and moves the report on", async () => {
    const { manager, officer, other, report } = await waiting();

    const res = await assign(report, manager.cookie, other.id);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`/reports/${report.id}`);

    const after = await reportRow(report.id);
    // The assignment is an `assessments` row now, not a column on the report.
    expect(await secondaryAssessorOf(report.id)).toBe(other.id);
    expect(after.status).toBe("second_assessment");
    // The first assessor is not disturbed by the second being named.
    expect(after.assessor1_user_id).toBe(officer.id);
  });

  it("names both assessors and the manager in the trail", async () => {
    const { manager, officer, other, report } = await waiting();

    await assign(report, manager.cookie, other.id);

    const rows = await owner.db.execute(sql`
      SELECT actor_user_id, entity_type, entity_id, after
        FROM audit_log WHERE action = 'decision.assign_next_assessor'
    `);

    expect(rows.length).toBe(1);
    const entry = rows[0] as {
      actor_user_id: string;
      entity_type: string;
      entity_id: string;
      after: { number: string; assessorUserId: string; ordinal: number };
    };

    expect(entry.actor_user_id).toBe(manager.id);
    expect(entry.entity_type).toBe("report");
    expect(entry.entity_id).toBe(report.id);
    expect(entry.after.number).toBe(report.number);
    // The trail names who was assigned and at which ordinal, rather than a fixed pair of slots.
    expect(entry.after.assessorUserId).toBe(other.id);
    expect(entry.after.ordinal).toBe(2);
    expect(officer.id).not.toBe(other.id);
  });

  it("moves the report to the next bucket and takes the picker off the page", async () => {
    const { manager, other, report } = await waiting();

    const before = await get(`/workload?stage=${ASSIGN_NEXT_STAGE}`, manager.cookie);
    expect(before.body).toContain(report.number);

    await assign(report, manager.cookie, other.id);

    // Out of the bucket it was in, and counted in the one it moved to.
    const waitingBucket = (await get(`/workload?stage=${ASSIGN_NEXT_STAGE}`, manager.cookie)).body;
    expect(waitingBucket).not.toContain(report.number);
    expect(waitingBucket).toContain(bucketStat(ASSIGN_NEXT, 0));

    const secondBucket = (await get("/workload?stage=in-progress", manager.cookie)).body;
    expect(secondBucket).toContain(report.number);
    expect(secondBucket).toContain(bucketStat("In progress", 1));

    // The report is no longer waiting, so there is nothing left to pick.
    const detail = (await get(`/reports/${report.id}`, manager.cookie)).body;
    expect(detail).not.toContain('name="assessor_id"');
    expect(detail).not.toContain("Assign second assessor");
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("what it refuses", () => {
  beforeEach(start);

  it("answers 404 for a malformed id and for one that names no report", async () => {
    const { manager, other } = await waiting();

    for (const id of ["not-a-uuid", NOBODY]) {
      const res = await post(`/reports/${id}/assign-next-assessor`, manager.cookie, {
        assessor_id: other.id,
      });
      expect(res.statusCode, id).toBe(404);
    }
  });

  it("refuses a report that is not waiting for a second assessor", async () => {
    const { manager, other, report } = await waiting();

    for (const status of ["received", "second_assessment"]) {
      await owner.db.execute(sql`
        UPDATE reports SET status = ${status}::report_status WHERE id = ${report.id}
      `);
      const before = await assignment(await reportRow(report.id));

      const res = await assign(report, manager.cookie, other.id);

      expect(res.statusCode, status).toBe(403);
      expect(await assignment(await reportRow(report.id)), status).toEqual(before);
    }
  });

  it("refuses a report waiting on a first assessment that was never submitted", async () => {
    const manager = await signedInAs("manager", "Mgr");
    const officer = await signedInAs("assessor", "Asha Mrema");
    const other = await signedInAs("assessor", "Baraka Nyoni");

    // The status says waiting, and nothing in `assessments` backs it up. The route must ask the
    // assessment itself rather than trust the column.
    const id = await seedReport({
      number: "MD-AE/2026/8100",
      status: "awaiting_second_assessor",
      assessor1: officer.id,
    });
    const report = await reportRow(id);
    const before = await assignment(report);

    const res = await assign(report, manager.cookie, other.id);

    expect(res.statusCode).toBe(403);
    expect(await assignment(await reportRow(id))).toEqual(before);
  });

  it("refuses a second assignment and does not overwrite the first", async () => {
    const { manager, other, report } = await waiting();
    const third = await signedInAs("assessor", "Chausiku Njau");

    await assign(report, manager.cookie, other.id);
    const assigned = await reportRow(report.id);
    expect(await secondaryAssessorOf(report.id)).toBe(other.id);

    const res = await assign(report, manager.cookie, third.id);

    expect(res.statusCode).toBe(403);
    expect(await assignment(await reportRow(report.id))).toEqual(await assignment(assigned));
  });

  it("refuses a body with no assessor, and one that is not a uuid", async () => {
    const { manager, report } = await waiting();
    const before = await assignment(report);

    for (const [name, form] of [
      ["missing", {}],
      ["not a uuid", { assessor_id: "whoever" }],
    ] as const) {
      const res = await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, form);

      expect(res.statusCode, name).toBe(403);
      expect(await assignment(await reportRow(report.id)), name).toEqual(before);
    }
  });

  it("refuses an id that names nobody", async () => {
    const { manager, report } = await waiting();
    const before = await assignment(report);

    const res = await assign(report, manager.cookie, NOBODY);

    expect(res.statusCode).toBe(403);
    expect(await assignment(await reportRow(report.id))).toEqual(before);
  });

  it("refuses a manager and an administrator as the choice", async () => {
    const { manager, report } = await waiting();
    const before = await assignment(report);

    const otherManager = await signedInAs("manager", "Second Mgr");
    const admin = await signedInAs("administrator", "Adm");

    for (const [who, staff] of [
      ["a manager", otherManager],
      ["an administrator", admin],
    ] as const) {
      const res = await assign(report, manager.cookie, staff.id);

      expect(res.statusCode, who).toBe(403);
      expect(await assignment(await reportRow(report.id)), who).toEqual(before);
    }
  });

  it("refuses a deactivated Officer", async () => {
    const { manager, report } = await waiting();
    const before = await assignment(report);
    const dormant = await inactiveAssessor();

    const res = await assign(report, manager.cookie, dormant);

    expect(res.statusCode).toBe(403);
    expect(await assignment(await reportRow(report.id))).toEqual(before);
  });

  it("refuses the first assessor, who may not also be the second", async () => {
    const { manager, officer, report } = await waiting();
    const before = await assignment(report);

    const res = await assign(report, manager.cookie, officer.id);

    expect(res.statusCode).toBe(403);
    expect(await assignment(await reportRow(report.id))).toEqual(before);
  });

  it("refuses the manager naming themselves", async () => {
    const { manager, report } = await waiting();
    const before = await assignment(report);

    const res = await assign(report, manager.cookie, manager.id);

    expect(res.statusCode).toBe(403);
    expect(await assignment(await reportRow(report.id))).toEqual(before);
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("who may reach it at all", () => {
  beforeEach(start);

  it("refuses an Officer and an administrator on a report that would otherwise qualify", async () => {
    const { officer, other, report } = await waiting();
    const admin = await signedInAs("administrator", "Adm");
    const before = await assignment(report);

    for (const [who, staff] of [
      ["an Officer", officer],
      ["an administrator", admin],
    ] as const) {
      const res = await assign(report, staff.cookie, other.id);

      // Refused by the scope the route is registered in, not by anything it checks for itself.
      expect(res.statusCode, who).toBe(403);
      expect(await assignment(await reportRow(report.id)), who).toEqual(before);
    }
  });

  it("still refuses a manager the first assessment page", async () => {
    const { manager, report } = await waiting();

    // Reading the submitted F004 on `/reports/:id` is not the same as opening the Officer's own
    // page, and this slice must not have quietly become the second.
    expect((await get(`/reports/${report.id}/assessment-1`, manager.cookie)).statusCode).toBe(403);
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("what the page offers", () => {
  beforeEach(start);

  /**
   * The whole of what this page lets a manager do, enumerated rather than sampled.
   *
   * Two forms now, where there was one: the review of the first assessment and the handover that
   * follows it. Listing them in order is the cheapest way to catch a third arriving unnoticed —
   * and the order is itself the rule, since a manager reviews before handing on.
   */
  it("posts to the review and the assignment, and to nowhere else", async () => {
    const { manager, report } = await waiting();

    const body = (await get(`/reports/${report.id}`, manager.cookie)).body;

    const posts = (body.match(/action="([^"]*)"/g) ?? []).filter(
      (action) => !action.includes("/logout"),
    );

    // The overall review, the assignment, and one note box per section of the F004 — eight of
    // those, each posting only to its own section, which is what stops a comment written against
    // section 3 landing anywhere else.
    const sections = ["1", "2", "3", "4", "5", "6", "7", "8"].map(
      (no) => `action="/reports/${report.id}/assessment-1/sections/${no}/comments"`,
    );

    expect([...posts].sort()).toEqual(
      [
        `action="/reports/${report.id}/assessment-1/comment"`,
        `action="/reports/${report.id}/assign-next-assessor"`,
        ...sections,
      ].sort(),
    );
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("how wide the grant is", () => {
  beforeEach(start);

  it("lets the app role write the three columns this slice owns, and no others", async () => {
    restricted ??= openApp();

    const officer = await signedInAs("assessor", "Asha Mrema");
    const id = await seedReport({
      number: "MD-AE/2026/8200",
      status: "awaiting_second_assessor",
      assessor1: officer.id,
    });

    // The three the route writes together. A missing GRANT would raise 42501 here rather than in
    // the container, which is the whole reason this suite connects as the restricted role.
    await restricted.db.execute(sql`
      UPDATE reports
         SET assessor2_user_id = ${officer.id},
             assessor2_assigned_at = now(),
             status = 'second_assessment'
       WHERE id = ${id}
    `);

    // Everything else about a report stays the owner's. `status` is granted and these are not, so
    // this is the boundary the column-scoped grant draws rather than a blanket refusal.
    for (const [column, statement] of [
      ["device_name", sql`UPDATE reports SET device_name = 'Rewritten' WHERE id = ${id}`],
      ["number", sql`UPDATE reports SET number = 'MD-AE/2026/9999' WHERE id = ${id}`],
      ["payload", sql`UPDATE reports SET payload = '{"x":1}'::jsonb WHERE id = ${id}`],
      ["severity", sql`UPDATE reports SET severity = 'death' WHERE id = ${id}`],
    ] as const) {
      await expect(restricted.db.execute(statement), column).rejects.toThrow();
    }
  });

  // Assessment 1 is now the Manager's manual assignment rather than an intake-time INSERT, so the
  // app role needs UPDATE on exactly these two columns — the pair the migration above `staff-
  // assignment.test.ts` exercises grants, and no wider than that pair.
  it("also lets the app role write the two columns a Manager's A1 assignment owns", async () => {
    restricted ??= openApp();

    const officer = await signedInAs("assessor", "Asha Mrema");
    const id = await seedReport({ number: "MD-AE/2026/8201", status: "received" });

    await restricted.db.execute(sql`
      UPDATE reports SET assessor1_user_id = ${officer.id}, assessor1_assigned_at = now()
       WHERE id = ${id}
    `);
  });
});
