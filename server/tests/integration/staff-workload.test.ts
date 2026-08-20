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

/** Every status the column can hold, which is exactly what the filter accepts. */
const EVERY_STATUS = [
  "received",
  "first_assessment",
  "awaiting_second_assessor",
  "second_assessment",
  "awaiting_decision",
  "closed",
] as const;

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
  return (rows[0] as { id: string }).id;
}

/** A bucket's figure, asserted as markup so a bare label elsewhere on the page cannot satisfy it. */
function bucketStat(label: string, count: number): string {
  return `<span class="eyebrow">${label}</span><b>${count}</b>`;
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
    for (const url of ["/workload", "/workload?status=received", "/reports", "/dashboard"]) {
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

describe.skipIf(!INTEGRATION_ENABLED)("the status filter", () => {
  beforeEach(start);

  it("accepts every status the column can hold", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    // One report in each bucket, so a status that filtered wrongly would show the wrong number.
    for (const status of EVERY_STATUS) {
      await seedReport({ number: `MD-AE/2026/${status}`, status });
    }

    for (const status of EVERY_STATUS) {
      const res = await get(`/workload?status=${status}`, manager.cookie);

      expect(res.statusCode, status).toBe(200);
      expect(res.body, status).toContain(`MD-AE/2026/${status}`);
      expect(rowCount(res.body), status).toBe(1);
    }
  });

  it("shows the whole pipeline when no status is asked for", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    await seedReport({ number: "MD-AE/2026/9010", status: "received" });
    await seedReport({ number: "MD-AE/2026/9011", status: "closed" });

    const body = (await get("/workload", manager.cookie)).body;

    expect(body).toContain("All reports");
    expect(body).toContain("MD-AE/2026/9010");
    expect(body).toContain("MD-AE/2026/9011");
    // Nothing to clear, so the page does not offer a control that would go nowhere.
    expect(body).not.toContain("Show all");
  });

  it("ignores a status that is not one, rather than erroring or emptying the page", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    await seedReport({ number: "MD-AE/2026/9020", status: "received" });
    await seedReport({ number: "MD-AE/2026/9021", status: "closed" });

    // A mistyped status, a status-shaped word the enum does not carry, the parameter given twice
    // (which Fastify hands over as an array), and a value that is not a string at all.
    for (const query of [
      "status=nonsense",
      "status=RECEIVED",
      "status=received;closed",
      "status=received&status=closed",
      "status[]=received",
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

  it("treats an empty status as no filter", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    await seedReport({ number: "MD-AE/2026/9030", status: "received" });
    await seedReport({ number: "MD-AE/2026/9031", status: "closed" });

    for (const query of ["status=", "status"]) {
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
    // assertion: the parameter is bound, and is whitelisted against the enum before that.
    for (const hostile of [
      "received' OR '1'='1",
      "received; DROP TABLE reports; --",
      "'; TRUNCATE reports; --",
      "received') UNION SELECT null,null--",
    ]) {
      const res = await get(`/workload?status=${encodeURIComponent(hostile)}`, manager.cookie);

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

  it("counts each bucket, and prints a zero for an empty one", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    await seedReport({ number: "MD-AE/2026/9050", status: "received" });
    await seedReport({ number: "MD-AE/2026/9051", status: "received" });
    await seedReport({ number: "MD-AE/2026/9052", status: "received" });
    await seedReport({ number: "MD-AE/2026/9053", status: "awaiting_second_assessor" });
    await seedReport({ number: "MD-AE/2026/9054", status: "closed" });

    const body = (await get("/workload", manager.cookie)).body;

    expect(body).toContain(bucketStat("Not started", 3));
    expect(body).toContain(bucketStat("Waiting on you — assign A2", 1));
    expect(body).toContain(bucketStat("Closed", 1));
    // A bucket nothing is in is drawn as zero rather than left off the page.
    expect(body).toContain(bucketStat("In progress — first assessment", 0));
    expect(body).toContain(bucketStat("Waiting on you — decision", 0));
  });

  it("keeps the figures whole while the list is filtered", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    await seedReport({ number: "MD-AE/2026/9060", status: "received" });
    await seedReport({ number: "MD-AE/2026/9061", status: "received" });
    await seedReport({ number: "MD-AE/2026/9062", status: "closed" });

    const body = (await get("/workload?status=closed", manager.cookie)).body;

    // The list is one bucket and the figures are the register. A count computed from the filtered
    // rows would tell a manager two reports had gone missing.
    expect(rowCount(body)).toBe(1);
    expect(body).toContain(bucketStat("Not started", 2));
    expect(body).toContain(bucketStat("Closed", 1));
  });

  it("draws six zeroes and an honest sentence over an empty register", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");

    const body = (await get("/workload", manager.cookie)).body;

    for (const label of [
      "Not started",
      "In progress — first assessment",
      "Waiting on you — assign A2",
      "In progress — second assessment",
      "Waiting on you — decision",
      "Closed",
    ]) {
      expect(body, label).toContain(bucketStat(label, 0));
    }

    expect(body).toContain("Nothing has been reported yet.");
    // No header over an empty body: that reads as a list that failed to load.
    expect(body).not.toContain("<table");
  });

  it("says which stage is empty when a bucket is filtered to nothing", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    await seedReport({ number: "MD-AE/2026/9070", status: "received" });

    const body = (await get("/workload?status=closed", manager.cookie)).body;

    expect(body).toContain("No reports are in this stage right now.");
    expect(body).not.toContain("<table");
    // Still the bucket's own heading, so the reader knows which stage is clear.
    expect(body).toContain("Closed");
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("what a row shows", () => {
  beforeEach(start);

  it("prints the number, the date, the device, the severity and the status", async () => {
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
    expect(body).toContain("Awaiting second assessor");
  });

  it("names one assessor, both assessors, or neither", async () => {
    const manager = await signedInAs("manager", "Grace Mollel");
    const first = await signedInAs("assessor", "Asha Mrema");
    const second = await signedInAs("assessor", "Baraka Nyoni");

    await seedReport({ number: "MD-AE/2026/9090", assessor1: first.id });
    await seedReport({
      number: "MD-AE/2026/9091",
      status: "second_assessment",
      assessor1: first.id,
      assessor2: second.id,
    });
    // Filed while no Officer was active, so intake had nobody to give it to.
    await seedReport({ number: "MD-AE/2026/9092" });

    const body = (await get("/workload", manager.cookie)).body;

    expect(body).toContain("A1: Asha Mrema");
    expect(body).toContain("A2: Baraka Nyoni");
    // An orphan says so rather than printing an empty column.
    expect(body).toContain("Unassigned");
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
