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
 * The manager's pipeline page: who may open it, what it may be asked for, and what it draws.
 *
 * `staff-second-assessor` pins the one write that moves a report between these buckets. This suite
 * is about the page itself — the boundary around it and the shape of what it renders — so that a
 * write workflow added later has something to be measured against.
 *
 * The server under test connects as the restricted role, as every suite here does: a missing GRANT
 * has to fail in this file rather than in the container.
 */

const STAFF_HOST = "staff.test";
const PUBLIC_HOST = "public.test";
const PASSWORD = "a correct staff password";
const COOKIE = "__Host-ae_session";

/**
 * Every status the column can hold.
 *
 * `closed` is among them deliberately. No state on the bar claims it, and this suite has to be
 * able to prove the page keeps it out — of the tabs, of the figures, of the filtered lists and of
 * the unfiltered one — which a fixture that never seeded one could not.
 */
const EVERY_STATUS = [
  "received",
  "first_assessment",
  "awaiting_second_assessor",
  "second_assessment",
  "awaiting_decision",
  "assigned_for_work",
  "closed",
] as const;

/**
 * The four states the bar draws, and the statuses each one folds together.
 *
 * Written out here rather than imported from the view. The mapping is the whole point of this
 * page — that `first_assessment` and `second_assessment` are one thing to a manager, and that
 * `awaiting_second_assessor` and `awaiting_decision` are another — so a bucket quietly re-pointed
 * at a different status must fail this suite rather than agree with it.
 */
const STAGES = [
  { id: "not-started", label: "Not started", statuses: ["received"] },
  {
    id: "in-progress",
    label: "In progress",
    statuses: ["first_assessment", "second_assessment"],
  },
  {
    id: "decision",
    label: "Decision",
    statuses: ["awaiting_second_assessor", "awaiting_decision"],
  },
  { id: "assigned-for-work", label: "Assigned for work", statuses: ["assigned_for_work"] },
] as const;

/** The one status no state claims, and the one this page must keep out of every view of itself. */
const UNBUCKETED_STATUS = "closed";

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

/** A real account and a real session cookie: the authorization cases must not mock either. */
async function signedInAs(role: Role, name?: string): Promise<Staff> {
  seeded += 1;
  const email = `workload-${seeded}@tmda.go.tz`;
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

/** The same request with no cookie at all, for the authentication boundary. */
function getAnonymous(url: string) {
  return app.inject({ url, headers: { host: STAFF_HOST } });
}

async function seedReport(over: {
  number: string;
  status?: string;
  receivedAt?: string;
  deviceName?: string;
  severity?: string;
  assessor1?: string;
  assessor2?: string;
}): Promise<string> {
  const rows = await owner.db.execute(sql`
    INSERT INTO reports (number, channel, severity, status, device_name, form_version, payload,
                         received_at, assessor1_user_id, assessor2_user_id, assessor2_assigned_at)
    VALUES (${over.number}, 'online_form', ${over.severity ?? "other"}::report_severity,
            ${over.status ?? "received"}::report_status, ${over.deviceName ?? "Seeded device"},
            'F001', '{}'::jsonb,
            ${over.receivedAt ?? "2026-08-01T00:00:00Z"}::timestamptz,
            ${over.assessor1 ?? null}, ${over.assessor2 ?? null},
            ${over.assessor2 ? sql`now()` : sql`NULL`})
    RETURNING id
  `);
  const id = (rows[0] as { id: string }).id;

  // A secondary assessor is an `assessments` row now, not a column on the report. The legacy
  // columns are still written above so a fixture keeps exercising them, but this is what the
  // page actually reads.
  if (over.assessor2 !== undefined) {
    await owner.db.execute(sql`
      INSERT INTO assessments (report_id, assessor_id, ordinal, form_version, payload)
      VALUES (${id}, ${over.assessor2}, 2, 'F004', '{}'::jsonb)
    `);
  }

  return id;
}

/** A bucket's figure, asserted as markup so a bare label elsewhere on the page cannot satisfy it. */
function bucketStat(label: string, count: number): string {
  return `<span>${label}</span> <span class="wl-count">${count}</span>`;
}

/** Body rows of the one table on the page, the header row discounted. */
function rowCount(body: string): number {
  return (body.match(/<tr[ >]/g) ?? []).length - 1;
}

describe.skipIf(!INTEGRATION_ENABLED)("who may open the pipeline", () => {
  beforeEach(start);

  it("turns an anonymous request away at the session guard", async () => {
    // The staff door's own convention, shared with every other page behind it: the sign-in page is
    // `/`, so that is where the guard sends someone who has no session. Asserted here as well as
    // on `/reports` because a page added to the wrong scope would answer 200 to a stranger.
    for (const url of ["/workload", "/workload?stage=not-started", "/reports", "/dashboard"]) {
      const res = await getAnonymous(url);

      expect(res.statusCode, url).toBe(302);
      expect(res.headers.location, url).toBe("/");
      // Nothing of the register may be rendered on the way out.
      expect(res.body, url).not.toContain("MD-AE/");
    }
  });

  it("opens for a manager and is refused to every other role", async () => {
    await seedReport({ number: "MD-AE/2026/9001" });

    const manager = await signedInAs("manager", "Grace Mollel");
    expect((await get("/workload", manager.cookie)).statusCode).toBe(200);

    // Refused by the scope the route is registered in — the rail hiding the link is presentation,
    // and this is the server saying no to a reader who typed the address anyway.
    for (const role of ["assessor", "administrator"] as const) {
      const staff = await signedInAs(role);
      const res = await get("/workload", staff.cookie);

      expect(res.statusCode, role).toBe(403);
      // A refusal that still printed the register would have leaked exactly what it refused.
      expect(res.body, role).not.toContain("MD-AE/2026/9001");
      expect(res.body, role).not.toContain("Not started");
    }
  });

  it("refuses the filtered address to the other roles too", async () => {
    await seedReport({ number: "MD-AE/2026/9002", status: "closed" });

    for (const role of ["assessor", "administrator"] as const) {
      const staff = await signedInAs(role);
      const res = await get("/workload?status=closed", staff.cookie);

      expect(res.statusCode, role).toBe(403);
      expect(res.body, role).not.toContain("MD-AE/2026/9002");
    }
  });
});

/**
 * One assessment on a report, at whatever ordinal.
 *
 * This is the row the page reads "which assessment, and who with" from, so a fixture that wants a
 * report to be with A3 has to write one — the manager's page deliberately no longer infers a
 * secondary assessor from `reports.assessor2_user_id`, which migration 0013 emptied of meaning.
 */
async function seedAssessment(
  reportId: string,
  assessorId: string,
  ordinal: number,
  over: { submitted?: boolean } = {},
): Promise<void> {
  await owner.db.execute(sql`
    INSERT INTO assessments (report_id, assessor_id, ordinal, form_version, payload, submitted_at)
    VALUES (${reportId}, ${assessorId}, ${ordinal}, 'F004', '{"7.1":"seeded"}'::jsonb,
            ${over.submitted ? sql`now()` : sql`NULL`})
  `);
}

describe.skipIf(!INTEGRATION_ENABLED)("the state filter", () => {
  beforeEach(start);

  it("lists exactly the statuses each state folds together", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    // One report in each status, so a state that filtered wrongly would show the wrong number.
    for (const status of EVERY_STATUS) {
      await seedReport({ number: `MD-AE/2026/${status}`, status });
    }

    for (const stage of STAGES) {
      const res = await get(`/workload?stage=${stage.id}`, manager.cookie);

      expect(res.statusCode, stage.id).toBe(200);
      expect(rowCount(res.body), stage.id).toBe(stage.statuses.length);

      for (const status of stage.statuses) {
        expect(res.body, `${stage.id}/${status}`).toContain(`MD-AE/2026/${status}`);
      }

      // Nothing from another state leaks in, and least of all the status no state claims.
      expect(res.body, stage.id).not.toContain(`MD-AE/2026/${UNBUCKETED_STATUS}`);
    }
  });

  it("shows every state at once when none is asked for", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    await seedReport({ number: "MD-AE/2026/9010", status: "received" });
    await seedReport({ number: "MD-AE/2026/9011", status: "second_assessment" });
    await seedReport({ number: "MD-AE/2026/9012", status: "assigned_for_work" });

    const body = (await get("/workload", manager.cookie)).body;

    expect(body).toContain("All reports");
    expect(body).toContain("MD-AE/2026/9010");
    expect(body).toContain("MD-AE/2026/9011");
    expect(body).toContain("MD-AE/2026/9012");
    // Nothing to clear, so the page does not offer a control that would go nowhere.
    expect(body).not.toContain("Show all");
  });

  it("never shows a report in a state the bar has no tab for", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    await seedReport({ number: "MD-AE/2026/9013", status: "received" });
    await seedReport({ number: "MD-AE/2026/9014", status: UNBUCKETED_STATUS });

    // "All reports" means every state the reader can navigate back to, not every row in the
    // table. Listing a report here that no tab would list is showing them a stage that does not
    // exist for them — and there is no closing workflow in this MVP for it to belong to.
    const all = (await get("/workload", manager.cookie)).body;
    expect(all).toContain("MD-AE/2026/9013");
    expect(all).not.toContain("MD-AE/2026/9014");

    // Nor by hand-editing the address: the filter is whitelisted against the bar, not the enum.
    for (const query of ["stage=closed", "stage=Closed", "status=closed"]) {
      const res = await get(`/workload?${query}`, manager.cookie);

      expect(res.statusCode, query).toBe(200);
      expect(res.body, query).not.toContain("MD-AE/2026/9014");
    }
  });

  it("ignores a state that is not one, rather than erroring or emptying the page", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    await seedReport({ number: "MD-AE/2026/9020", status: "received" });
    await seedReport({ number: "MD-AE/2026/9021", status: "awaiting_decision" });

    // A mistyped state, a state-shaped word the bar does not carry, a stored status rather than a
    // state, the parameter given twice (which Fastify hands over as an array), and a value that is
    // not a string at all.
    for (const query of [
      "stage=nonsense",
      "stage=NOT-STARTED",
      "stage=received",
      "stage=not-started;decision",
      "stage=not-started&stage=decision",
      "stage[]=not-started",
    ]) {
      const res = await get(`/workload?${query}`, manager.cookie);

      // The same answer a stale link gets from the register: the honest whole view, not a 500 and
      // not an empty table implying the pipeline is clear.
      expect(res.statusCode, query).toBe(200);
      expect(res.body, query).toContain("All reports");
      expect(res.body, query).toContain("MD-AE/2026/9020");
      expect(res.body, query).toContain("MD-AE/2026/9021");
    }
  });

  it("treats an empty state as no filter", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    await seedReport({ number: "MD-AE/2026/9030", status: "received" });
    await seedReport({ number: "MD-AE/2026/9031", status: "assigned_for_work" });

    for (const query of ["stage=", "stage"]) {
      const res = await get(`/workload?${query}`, manager.cookie);

      expect(res.statusCode, query).toBe(200);
      expect(res.body, query).toContain("All reports");
      expect(res.body, query).toContain("MD-AE/2026/9030");
      expect(res.body, query).toContain("MD-AE/2026/9031");
    }
  });

  it("never lets a query parameter reach the database as anything but a bound value", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    await seedReport({ number: "MD-AE/2026/9040", status: "received" });

    // If any of these were concatenated into the statement the request would 500 on a syntax
    // error, or in the worst case take the table with it. The report surviving each one is the
    // assertion: the parameter is whitelisted against the bar before it is used at all, and the
    // statuses it selects are bound one by one after that.
    for (const hostile of [
      "not-started' OR '1'='1",
      "not-started; DROP TABLE reports; --",
      "'; TRUNCATE reports; --",
      "not-started') UNION SELECT null,null--",
    ]) {
      const res = await get(`/workload?stage=${encodeURIComponent(hostile)}`, manager.cookie);

      expect(res.statusCode, hostile).toBe(200);
      expect(res.body, hostile).toContain("All reports");
      // Never echoed back onto the page, whatever it was.
      expect(res.body, hostile).not.toContain("DROP TABLE");
      expect(res.body, hostile).not.toContain("OR '1'='1");
    }

    const left = await owner.db.execute(sql`SELECT count(*)::int AS n FROM reports`);
    expect((left[0] as { n: number }).n).toBe(1);
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("the figures", () => {
  beforeEach(start);

  it("counts each state, and prints a zero for an empty one", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    await seedReport({ number: "MD-AE/2026/9050", status: "received" });
    await seedReport({ number: "MD-AE/2026/9051", status: "received" });
    // Two statuses, one figure. This is the count that used to be split across two tabs.
    await seedReport({ number: "MD-AE/2026/9052", status: "first_assessment" });
    await seedReport({ number: "MD-AE/2026/9053", status: "second_assessment" });
    await seedReport({ number: "MD-AE/2026/9054", status: "awaiting_second_assessor" });

    const body = (await get("/workload", manager.cookie)).body;

    expect(body).toContain(bucketStat("Not started", 2));
    expect(body).toContain(bucketStat("In progress", 2));
    expect(body).toContain(bucketStat("Decision", 1));
    // A state nothing is in is drawn as zero rather than left off the page.
    expect(body).toContain(bucketStat("Assigned for work", 0));
  });

  it("counts both waiting-on-the-manager statuses into the one Decision figure", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    // The two ways a report arrives at the manager's queue: straight after A1, and after any
    // secondary assessment since. One figure, because it is one job.
    await seedReport({ number: "MD-AE/2026/9055", status: "awaiting_second_assessor" });
    await seedReport({ number: "MD-AE/2026/9056", status: "awaiting_decision" });

    const body = (await get("/workload", manager.cookie)).body;

    expect(body).toContain(bucketStat("Decision", 2));
    expect(rowCount(body)).toBe(2);
  });

  it("keeps the figures whole while the list is filtered", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    await seedReport({ number: "MD-AE/2026/9060", status: "received" });
    await seedReport({ number: "MD-AE/2026/9061", status: "received" });
    await seedReport({ number: "MD-AE/2026/9062", status: "assigned_for_work" });

    const body = (await get("/workload?stage=assigned-for-work", manager.cookie)).body;

    // The list is one state and the figures are the register. A count computed from the filtered
    // rows would tell a manager two reports had gone missing.
    expect(rowCount(body)).toBe(1);
    expect(body).toContain(bucketStat("Not started", 2));
    expect(body).toContain(bucketStat("Assigned for work", 1));
  });

  it("counts no report into a state the bar does not draw", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    await seedReport({ number: "MD-AE/2026/9063", status: "received" });
    await seedReport({ number: "MD-AE/2026/9064", status: UNBUCKETED_STATUS });
    await seedReport({ number: "MD-AE/2026/9065", status: UNBUCKETED_STATUS });

    const body = (await get("/workload", manager.cookie)).body;

    // A figure that counted a report no tab would list is the worst of both: it tells the reader
    // something is there and then refuses to show it to them.
    expect(body).toContain(bucketStat("Not started", 1));
    expect(rowCount(body)).toBe(1);
    for (const stage of STAGES) {
      expect(body, stage.id).not.toContain(bucketStat(stage.label, 3));
    }
  });

  it("draws four zeroes and an honest sentence over an empty register", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    const body = (await get("/workload", manager.cookie)).body;

    for (const stage of STAGES) {
      expect(body, stage.label).toContain(bucketStat(stage.label, 0));
    }

    expect(body).toContain("Nothing has been reported yet.");
    // No header over an empty body: that reads as a list that failed to load.
    expect(body).not.toContain("<table");
  });

  it("says which state is empty when one is filtered to nothing", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    await seedReport({ number: "MD-AE/2026/9070", status: "received" });

    const body = (await get("/workload?stage=assigned-for-work", manager.cookie)).body;

    expect(body).toContain("No reports are in this state right now.");
    expect(body).not.toContain("<table");
    // Still the state's own heading, so the reader knows which one is clear.
    expect(body).toContain("Assigned for work");
    expect(body).toContain("Show all");
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("what the bar offers", () => {
  beforeEach(start);

  it("draws these four states and no others", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    const body = (await get("/workload", manager.cookie)).body;

    for (const stage of STAGES) {
      expect(body, stage.id).toContain(`href="/workload?stage=${stage.id}"`);
    }

    // The workflow-shaped tabs are gone. They asked a manager to know what "first" and "secondary"
    // meant — the A1/A2 architecture — before they could find their own queue, and the ordinal is
    // a column now instead.
    expect(body).not.toContain("First assessment");
    expect(body).not.toContain("Secondary assessment");
    // Not in this MVP: nothing writes `closed`, so a tab for it is a stage that does not run.
    expect(body).not.toContain(">Closed<");
    expect(body).not.toContain("stage=closed");
    // And the filter is a filter. The action that used to sit in a row lives on the report.
    expect(body).not.toContain("Assign next assessor");
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("what a row shows", () => {
  beforeEach(start);

  it("prints the number, the date, the device, the severity and the state", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    const id = await seedReport({
      number: "MD-AE/2026/9080",
      status: "awaiting_second_assessor",
      receivedAt: "2026-08-19T09:00:00Z",
      deviceName: "Philips IntelliVue MX450",
      severity: "hospitalization",
    });

    const body = (await get("/workload", manager.cookie)).body;

    expect(body).toContain("MD-AE/2026/9080");
    expect(body).toContain(`href="/reports/${id}"`);
    // `19 Aug 2026`, the written form this page uses rather than the register's ISO date.
    expect(body).toContain("19 Aug 2026");
    expect(body).toContain("Philips IntelliVue MX450");
    // The enum's caption, not the stored value.
    expect(body).toContain("Hospitalization");
    // The state's word, not the status'. `awaiting_second_assessor` used to print "Awaiting next
    // assessor", which named a step of the machine rather than what the reader has to do.
    expect(body).toContain("Awaiting decision");
    expect(body).not.toContain("Awaiting next assessor");
  });

  it("names the assessment and the assessor a report is actually with, at every ordinal", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const first = await signedInAs("assessor", "Asha Mrema");
    const second = await signedInAs("assessor", "Baraka Nyoni");
    const third = await signedInAs("assessor", "Chausiku Njau");

    // With A1, before anybody has opened it.
    await seedReport({ number: "MD-AE/2026/9090", assessor1: first.id });

    // With A2: the fixture writes the `assessments` row, which is what the page reads.
    await seedReport({
      number: "MD-AE/2026/9091",
      status: "second_assessment",
      assessor1: first.id,
      assessor2: second.id,
    });

    // With A3, which no tab ever named and which the row must state plainly.
    const deep = await seedReport({
      number: "MD-AE/2026/9092",
      status: "second_assessment",
      assessor1: first.id,
    });
    await seedAssessment(deep, first.id, 1, { submitted: true });
    await seedAssessment(deep, second.id, 2, { submitted: true });
    await seedAssessment(deep, third.id, 3);

    const body = (await get("/workload", manager.cookie)).body;

    // The ordinal is a column now, so each row says which assessment it is on and who has it.
    expect(body).toContain("<td>A1</td>");
    expect(body).toContain("<td>A2</td>");
    expect(body).toContain("<td>A3</td>");
    expect(body).toContain("<td><span>Asha Mrema</span></td>");
    expect(body).toContain("<td><span>Baraka Nyoni</span></td>");
    expect(body).toContain("<td><span>Chausiku Njau</span></td>");

    // The old stacked cell named A1 and the latest secondary assessor together, which is how a
    // reader ended up thinking a report was with two people at once.
    expect(body).not.toContain("A1: Asha Mrema");
    expect(body).not.toContain("A2: Baraka Nyoni");
  });

  it("says so when intake found nobody to give a report to", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    // Filed while no Officer was active, so intake had nobody to give it to. An orphan says so
    // rather than printing an empty column.
    await seedReport({ number: "MD-AE/2026/9093" });

    expect((await get("/workload", manager.cookie)).body).toContain("Unassigned");
  });

  it("offers Review where the manager is being waited on, and Open everywhere else", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    await seedReport({ number: "MD-AE/2026/9094", status: "awaiting_decision" });
    const waiting = (await get("/workload?stage=decision", manager.cookie)).body;
    expect(waiting).toContain(">Review</a>");
    expect(waiting).not.toContain(">Open</a>");

    await seedReport({ number: "MD-AE/2026/9095", status: "received" });
    const resting = (await get("/workload?stage=not-started", manager.cookie)).body;
    expect(resting).toContain(">Open</a>");
    expect(resting).not.toContain(">Review</a>");
  });

  it("escapes a hostile device name rather than rendering it", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    await seedReport({
      number: "MD-AE/2026/9100",
      deviceName: "<script>alert(1)</script>",
    });

    const body = (await get("/workload", manager.cookie)).body;

    // The register already escapes this text; the pipeline reads the same column and must too.
    expect(body).toContain("&lt;script");
    expect(body).not.toContain("<script>alert(1)</script>");
  });

  it("escapes a hostile assessor name rather than rendering it", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const hostile = await signedInAs("assessor", "<script>alert(2)</script>");

    await seedReport({ number: "MD-AE/2026/9101", assessor1: hostile.id });

    const body = (await get("/workload", manager.cookie)).body;

    // A column this page did not print before it named the current assessor directly.
    expect(body).toContain("&lt;script");
    expect(body).not.toContain("<script>alert(2)</script>");
  });

  it("carries no control that writes", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    await seedReport({ number: "MD-AE/2026/9110", status: "awaiting_second_assessor" });

    const body = (await get("/workload", manager.cookie)).body;

    // Read-only, and asserted as the absence of any form but the shell's own sign-out. A control
    // added here later has to be a deliberate change to this line, not an accident.
    const posts = (body.match(/action="([^"]*)"/g) ?? []).filter(
      (action) => !action.includes("/logout"),
    );
    expect(posts).toEqual([]);
  });

  it("scrolls the table inside its own box rather than widening the page", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    await seedReport({ number: "MD-AE/2026/9111", status: "received" });

    const body = (await get("/workload", manager.cookie)).body;

    // Eight columns is wider than a narrow window. The box owns the overflow so the page itself
    // never scrolls sideways — see `.tscroll` in the stylesheet.
    expect(body).toContain('<div class="tscroll"><table class="utable">');
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("what each state holds", () => {
  beforeEach(start);

  it("holds a report nobody has begun assessing under Not started", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const officer = await signedInAs("assessor", "Asha Mrema");

    await seedReport({ number: "MD-AE/2026/9120", status: "received", assessor1: officer.id });
    await seedReport({ number: "MD-AE/2026/9121", status: "first_assessment" });

    const body = (await get("/workload?stage=not-started", manager.cookie)).body;

    expect(body).toContain("MD-AE/2026/9120");
    expect(body).not.toContain("MD-AE/2026/9121");
    expect(rowCount(body)).toBe(1);
  });

  it("holds every active assessment under In progress, whatever the ordinal", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const first = await signedInAs("assessor", "Asha Mrema");
    const second = await signedInAs("assessor", "Baraka Nyoni");
    const third = await signedInAs("assessor", "Chausiku Njau");
    const fourth = await signedInAs("assessor", "Deo Mushi");

    // A1 writing.
    await seedReport({
      number: "MD-AE/2026/9130",
      status: "first_assessment",
      assessor1: first.id,
    });

    // A2 writing.
    await seedReport({
      number: "MD-AE/2026/9131",
      status: "second_assessment",
      assessor1: first.id,
      assessor2: second.id,
    });

    // A3 writing, and A4 writing. Neither had a tab of its own before, and neither needs one:
    // somebody is writing an assessment, which is the only fact the state carries.
    for (const [number, holder, ordinal] of [
      ["MD-AE/2026/9132", third, 3],
      ["MD-AE/2026/9133", fourth, 4],
    ] as const) {
      const id = await seedReport({
        number,
        status: "second_assessment",
        assessor1: first.id,
      });
      await seedAssessment(id, first.id, 1, { submitted: true });
      for (let n = 2; n < ordinal; n += 1) {
        await seedAssessment(id, second.id, n, { submitted: true });
      }
      await seedAssessment(id, holder.id, ordinal);
    }

    const body = (await get("/workload?stage=in-progress", manager.cookie)).body;

    expect(rowCount(body)).toBe(4);
    for (const number of [
      "MD-AE/2026/9130",
      "MD-AE/2026/9131",
      "MD-AE/2026/9132",
      "MD-AE/2026/9133",
    ]) {
      expect(body, number).toContain(number);
    }

    // One word for all four, and the ordinal beside it to say which is which.
    expect(body).toContain("<td>A1</td>");
    expect(body).toContain("<td>A4</td>");
    expect(body).toContain(bucketStat("In progress", 4));
  });

  it("holds a report waiting on the manager under Decision, after A1 and after An alike", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const first = await signedInAs("assessor", "Asha Mrema");
    const second = await signedInAs("assessor", "Baraka Nyoni");

    // A1 in, nothing else yet.
    const afterFirst = await seedReport({
      number: "MD-AE/2026/9140",
      status: "awaiting_second_assessor",
      assessor1: first.id,
    });
    await seedAssessment(afterFirst, first.id, 1, { submitted: true });

    // A2 in, on top of A1.
    const afterSecond = await seedReport({
      number: "MD-AE/2026/9141",
      status: "awaiting_decision",
      assessor1: first.id,
    });
    await seedAssessment(afterSecond, first.id, 1, { submitted: true });
    await seedAssessment(afterSecond, second.id, 2, { submitted: true });

    const body = (await get("/workload?stage=decision", manager.cookie)).body;

    expect(rowCount(body)).toBe(2);
    expect(body).toContain("MD-AE/2026/9140");
    expect(body).toContain("MD-AE/2026/9141");
    // The latest assessment on each, which is what the manager is being asked to respond to.
    expect(body).toContain("<td>A1</td>");
    expect(body).toContain("<td>A2</td>");
  });

  it("holds what the manager has approved under Assigned for work", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    await seedReport({ number: "MD-AE/2026/9150", status: "assigned_for_work" });
    await seedReport({ number: "MD-AE/2026/9151", status: "awaiting_decision" });

    const body = (await get("/workload?stage=assigned-for-work", manager.cookie)).body;

    expect(body).toContain("MD-AE/2026/9150");
    expect(body).not.toContain("MD-AE/2026/9151");
    expect(rowCount(body)).toBe(1);
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("how much it will draw", () => {
  beforeEach(start);

  it("orders by arrival, newest first, and breaks a tie on a unique column", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    await seedReport({ number: "MD-AE/2026/9200", receivedAt: "2026-08-01T00:00:00Z" });
    await seedReport({ number: "MD-AE/2026/9202", receivedAt: "2026-08-09T00:00:00Z" });
    // Same instant as 9202, so only the tie-break can separate them — and `number` is unique, so
    // the order is total rather than merely usually-stable.
    await seedReport({ number: "MD-AE/2026/9201", receivedAt: "2026-08-09T00:00:00Z" });

    const body = (await get("/workload", manager.cookie)).body;

    expect(body.indexOf("MD-AE/2026/9202")).toBeLessThan(body.indexOf("MD-AE/2026/9201"));
    expect(body.indexOf("MD-AE/2026/9201")).toBeLessThan(body.indexOf("MD-AE/2026/9200"));
  });

  it("draws the same order twice for the same data", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    for (let n = 0; n < 12; n += 1) {
      // Every row sharing one timestamp, which is the case an unstable sort would betray.
      await seedReport({ number: `MD-AE/2026/93${String(n).padStart(2, "0")}` });
    }

    const first = (await get("/workload", manager.cookie)).body;
    const second = (await get("/workload", manager.cookie)).body;

    const numbers = (body: string) => body.match(/MD-AE\/2026\/93\d\d/g) ?? [];
    expect(numbers(first)).toEqual(numbers(second));
    expect(numbers(first)).toHaveLength(12);
  });

  it("stops at the register's own limit rather than drawing everything", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    // Two past the 200 the register and the activity trail both stop at. Seeded in one statement
    // because two hundred round trips is a slow way to make the same point.
    await owner.db.execute(sql`
      INSERT INTO reports (number, channel, severity, status, device_name, form_version, payload,
                           received_at)
      SELECT 'MD-AE/2026/L' || lpad(n::text, 4, '0'), 'online_form', 'other', 'received',
             'Bulk device', 'F001', '{}'::jsonb,
             timestamptz '2026-08-01 00:00:00Z' + make_interval(mins => n)
        FROM generate_series(1, 202) AS n
    `);

    const body = (await get("/workload", manager.cookie)).body;

    expect(rowCount(body)).toBe(200);
    // The figures still count every one of them, so the cap is on the list and not on the truth.
    expect(body).toContain(bucketStat("Not started", 202));
    // Newest kept, oldest dropped.
    expect(body).toContain("MD-AE/2026/L0202");
    expect(body).not.toContain("MD-AE/2026/L0001");
  });
});
