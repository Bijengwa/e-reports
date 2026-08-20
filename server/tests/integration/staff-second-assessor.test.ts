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
function completeAssessment(signature: string) {
  return {
    intent: "submit",
    seriousness: "serious",
    expectedness: "unexpected",
    causality: "probable",
    signal_status: "signal",
    risk_level: "high",
    conclusion: "Recommend risk communication and enhanced monitoring.",
    signature,
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

  // Intake chose one of the two; the other is the only valid second assessor here.
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

function assign(report: Row, cookie: string, assessorId: string) {
  return post(`/reports/${report.id}/assign-assessor-2`, cookie, { assessor_id: assessorId });
}

/** The three columns this slice may touch, as one value, so a case can assert they did not move. */
function assignment(row: Row) {
  return {
    status: row.status,
    assessor2: row.assessor2_user_id,
    assignedAt: row.assessor2_assigned_at,
  };
}

/** A bucket's figure on the workload page, asserted as markup so a bare label cannot satisfy it. */
function bucketStat(label: string, count: number): string {
  return `<span class="eyebrow">${label}</span><b>${count}</b>`;
}

const ASSIGN_A2 = "Waiting on you — assign A2";

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
    expect(body).toContain(bucketStat(ASSIGN_A2, 2));
    expect(body).toContain(bucketStat("Not started", 1));
    expect(body).toContain(bucketStat("Closed", 0));

    // Newest first: the later arrival is printed above the earlier one.
    expect(body.indexOf("MD-AE/2026/8002")).toBeLessThan(body.indexOf("MD-AE/2026/8001"));
  });

  it("narrows to one bucket when a card is followed", async () => {
    const manager = await signedInAs("manager", "Mgr");

    await seedReport({ number: "MD-AE/2026/8011", status: "awaiting_second_assessor" });
    await seedReport({ number: "MD-AE/2026/8012", status: "received" });

    const body = (await get("/workload?status=awaiting_second_assessor", manager.cookie)).body;

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

    const body = (await get("/workload?status=awaiting_second_assessor", manager.cookie)).body;

    expect(body).toContain(bucketStat(ASSIGN_A2, 0));
    expect(body).toContain("No reports are in this stage right now.");
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

describe.skipIf(!INTEGRATION_ENABLED)("assigning one", () => {
  beforeEach(start);

  it("names a different active Officer and moves the report on", async () => {
    const { manager, officer, other, report } = await waiting();

    const res = await assign(report, manager.cookie, other.id);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`/reports/${report.id}`);

    const after = await reportRow(report.id);
    expect(after.assessor2_user_id).toBe(other.id);
    expect(after.assessor2_assigned_at).not.toBeNull();
    expect(after.status).toBe("second_assessment");
    // The first assessor is not disturbed by the second being named.
    expect(after.assessor1_user_id).toBe(officer.id);
  });

  it("names both assessors and the manager in the trail", async () => {
    const { manager, officer, other, report } = await waiting();

    await assign(report, manager.cookie, other.id);

    const rows = await owner.db.execute(sql`
      SELECT actor_user_id, entity_type, entity_id, after
        FROM audit_log WHERE action = 'assessor2.assigned'
    `);

    expect(rows.length).toBe(1);
    const entry = rows[0] as {
      actor_user_id: string;
      entity_type: string;
      entity_id: string;
      after: { number: string; assessor1UserId: string; assessor2UserId: string };
    };

    expect(entry.actor_user_id).toBe(manager.id);
    expect(entry.entity_type).toBe("report");
    expect(entry.entity_id).toBe(report.id);
    expect(entry.after.number).toBe(report.number);
    expect(entry.after.assessor1UserId).toBe(officer.id);
    expect(entry.after.assessor2UserId).toBe(other.id);
  });

  it("moves the report to the next bucket and takes the picker off the page", async () => {
    const { manager, other, report } = await waiting();

    const before = await get("/workload?status=awaiting_second_assessor", manager.cookie);
    expect(before.body).toContain(report.number);

    await assign(report, manager.cookie, other.id);

    // Out of the bucket it was in, and counted in the one it moved to.
    const waitingBucket = (await get("/workload?status=awaiting_second_assessor", manager.cookie))
      .body;
    expect(waitingBucket).not.toContain(report.number);
    expect(waitingBucket).toContain(bucketStat(ASSIGN_A2, 0));

    const secondBucket = (await get("/workload?status=second_assessment", manager.cookie)).body;
    expect(secondBucket).toContain(report.number);
    expect(secondBucket).toContain(bucketStat("In progress — second assessment", 1));

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
      const res = await post(`/reports/${id}/assign-assessor-2`, manager.cookie, {
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
      const before = assignment(await reportRow(report.id));

      const res = await assign(report, manager.cookie, other.id);

      expect(res.statusCode, status).toBe(403);
      expect(assignment(await reportRow(report.id)), status).toEqual(before);
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
    const before = assignment(report);

    const res = await assign(report, manager.cookie, other.id);

    expect(res.statusCode).toBe(403);
    expect(assignment(await reportRow(id))).toEqual(before);
  });

  it("refuses a second assignment and does not overwrite the first", async () => {
    const { manager, other, report } = await waiting();
    const third = await signedInAs("assessor", "Chausiku Njau");

    await assign(report, manager.cookie, other.id);
    const assigned = await reportRow(report.id);
    expect(assigned.assessor2_user_id).toBe(other.id);

    const res = await assign(report, manager.cookie, third.id);

    expect(res.statusCode).toBe(403);
    expect(assignment(await reportRow(report.id))).toEqual(assignment(assigned));
  });

  it("refuses a body with no assessor, and one that is not a uuid", async () => {
    const { manager, report } = await waiting();
    const before = assignment(report);

    for (const [name, form] of [
      ["missing", {}],
      ["not a uuid", { assessor_id: "whoever" }],
    ] as const) {
      const res = await post(`/reports/${report.id}/assign-assessor-2`, manager.cookie, form);

      expect(res.statusCode, name).toBe(403);
      expect(assignment(await reportRow(report.id)), name).toEqual(before);
    }
  });

  it("refuses an id that names nobody", async () => {
    const { manager, report } = await waiting();
    const before = assignment(report);

    const res = await assign(report, manager.cookie, NOBODY);

    expect(res.statusCode).toBe(403);
    expect(assignment(await reportRow(report.id))).toEqual(before);
  });

  it("refuses a manager and an administrator as the choice", async () => {
    const { manager, report } = await waiting();
    const before = assignment(report);

    const otherManager = await signedInAs("manager", "Second Mgr");
    const admin = await signedInAs("administrator", "Adm");

    for (const [who, staff] of [
      ["a manager", otherManager],
      ["an administrator", admin],
    ] as const) {
      const res = await assign(report, manager.cookie, staff.id);

      expect(res.statusCode, who).toBe(403);
      expect(assignment(await reportRow(report.id)), who).toEqual(before);
    }
  });

  it("refuses a deactivated Officer", async () => {
    const { manager, report } = await waiting();
    const before = assignment(report);
    const dormant = await inactiveAssessor();

    const res = await assign(report, manager.cookie, dormant);

    expect(res.statusCode).toBe(403);
    expect(assignment(await reportRow(report.id))).toEqual(before);
  });

  it("refuses the first assessor, who may not also be the second", async () => {
    const { manager, officer, report } = await waiting();
    const before = assignment(report);

    const res = await assign(report, manager.cookie, officer.id);

    expect(res.statusCode).toBe(403);
    expect(assignment(await reportRow(report.id))).toEqual(before);
  });

  it("refuses the manager naming themselves", async () => {
    const { manager, report } = await waiting();
    const before = assignment(report);

    const res = await assign(report, manager.cookie, manager.id);

    expect(res.statusCode).toBe(403);
    expect(assignment(await reportRow(report.id))).toEqual(before);
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("who may reach it at all", () => {
  beforeEach(start);

  it("refuses an Officer and an administrator on a report that would otherwise qualify", async () => {
    const { officer, other, report } = await waiting();
    const admin = await signedInAs("administrator", "Adm");
    const before = assignment(report);

    for (const [who, staff] of [
      ["an Officer", officer],
      ["an administrator", admin],
    ] as const) {
      const res = await assign(report, staff.cookie, other.id);

      // Refused by the scope the route is registered in, not by anything it checks for itself.
      expect(res.statusCode, who).toBe(403);
      expect(assignment(await reportRow(report.id)), who).toEqual(before);
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

  it("posts to the assignment route and to nowhere else", async () => {
    const { manager, report } = await waiting();

    const body = (await get(`/reports/${report.id}`, manager.cookie)).body;

    const posts = (body.match(/action="([^"]*)"/g) ?? []).filter(
      (action) => !action.includes("/logout"),
    );
    expect(posts).toEqual([`action="/reports/${report.id}/assign-assessor-2"`]);
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
      [
        "assessor1_user_id",
        sql`UPDATE reports SET assessor1_user_id = ${officer.id} WHERE id = ${id}`,
      ],
    ] as const) {
      await expect(restricted.db.execute(statement), column).rejects.toThrow();
    }
  });
});
