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
 * The Officer's own filing: a report that arrived by email, keyed in through the staff door.
 *
 * A file of its own rather than more of `staff-reports`, which is already long and is about
 * reading the register. This one is about writing to it — which is also why it is the first suite
 * to drive the public door's submit end to end: both doors now reach `storeReport`, and the whole
 * risk of that change is one door quietly acquiring the other's behaviour.
 */

const STAFF_HOST = "staff.test";
const PUBLIC_HOST = "public.test";
const PASSWORD = "a correct staff password";
const COOKIE = "__Host-ae_session";

type Role = "administrator" | "manager" | "assessor";

let owner: DatabaseHandle;
let app: FastifyInstance;

/**
 * The server under test connects as the restricted role.
 *
 * That is the point of running this suite at all: migration 0006 grants `ereports_app` INSERT on
 * `reports` and `attachments` and the counter upsert, and a missing grant shows up here as a 503
 * over 42501 rather than in the container. The owner connection only seeds and inspects.
 */
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

/** A fresh address per account, so the per-address sign-in limit cannot bite mid-file. */
let seeded = 0;

type Staff = { cookie: string; id: string; name: string };

async function signedInAs(role: Role, name = "Neema Kileo"): Promise<Staff> {
  seeded += 1;
  const email = `newreport${seeded}@tmda.go.tz`;

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
    name,
  };
}

/**
 * A whole orange form, as the last step posts it.
 *
 * Every field the schema makes mandatory across all five steps, not only the fifth: submitting
 * re-checks every step, so a payload complete just at the end would 422 and prove nothing.
 */
function completeForm(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    step: "5",
    action: "submit",
    device_name: "Infusion Pump X",
    incident_date: "2026-08-01",
    incident_type: "Malfunction",
    incident_narrative: "Pump stopped mid-infusion.",
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
    ...overrides,
  };
}

function get(url: string, cookie: string) {
  return app.inject({ url, headers: { host: STAFF_HOST, cookie } });
}

function file(cookie: string, form: Record<string, string>) {
  return app.inject({
    method: "POST",
    url: "/reports/new",
    headers: { host: STAFF_HOST, cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(form).toString(),
  });
}

function fileAtThePublicDoor(form: Record<string, string>) {
  return app.inject({
    method: "POST",
    url: "/orange-form",
    headers: { host: PUBLIC_HOST, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(form).toString(),
  });
}

async function reportCount(): Promise<number> {
  const rows = await owner.db.execute(sql`SELECT count(*)::int AS n FROM reports`);
  return (rows[0] as { n: number }).n;
}

type Row = {
  id: string;
  number: string;
  status: string;
  channel: string;
  entered_by_user_id: string | null;
};

/** The one report the test filed, insisted upon rather than assumed. */
async function onlyReport(): Promise<Row> {
  const rows = await owner.db.execute(sql`
    SELECT id, number, status::text AS status, channel::text AS channel, entered_by_user_id
      FROM reports
  `);

  expect(rows.length).toBe(1);
  return rows[0] as Row;
}

async function submittedActors(): Promise<Array<string | null>> {
  const rows = await owner.db.execute(sql`
    SELECT actor_user_id FROM audit_log WHERE action = 'report.submitted'
  `);

  return rows.map((row) => (row as { actor_user_id: string | null }).actor_user_id);
}

describe.skipIf(!INTEGRATION_ENABLED)("opening the staff form", () => {
  beforeEach(start);

  it("gives an Officer the form, inside the staff shell", async () => {
    const officer = await signedInAs("assessor");

    const res = await get("/reports/new", officer.cookie);

    expect(res.statusCode).toBe(200);
    // Posts to itself, not to the public door's address.
    expect(res.body).toContain('action="/reports/new"');
    expect(res.body).not.toContain('action="/orange-form"');
    // One document, and it is the staff one — the shell's body class and its rail, rather than a
    // public page that replaced the portal.
    expect((res.body.match(/<html/g) ?? []).length).toBe(1);
    expect(res.body).toContain('<body class="staff">');
    expect(res.body).toContain('<aside class="rail');
    expect(res.body).toContain("<h1>New report</h1>");
    // And it is still the orange form: same step tabs, same fields.
    expect(res.body).toContain('class="steps"');
    expect(res.body).toContain('name="device_name"');
  });

  it("marks New report as the page the Officer is on", async () => {
    const officer = await signedInAs("assessor");

    const body = (await get("/reports/new", officer.cookie)).body;

    expect(body).toContain('href="/reports/new" class="on" aria-current="page"');
  });

  it("refuses a manager and an administrator", async () => {
    for (const role of ["manager", "administrator"] as const) {
      const staff = await signedInAs(role);

      expect((await get("/reports/new", staff.cookie)).statusCode, role).toBe(403);
    }
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("filing one", () => {
  beforeEach(start);

  it("refuses a manager and an administrator, and writes nothing", async () => {
    for (const role of ["manager", "administrator"] as const) {
      const staff = await signedInAs(role);

      expect((await file(staff.cookie, completeForm())).statusCode, role).toBe(403);
    }

    // The guard runs before the route, so a refused submission cannot have reached the insert.
    expect(await reportCount()).toBe(0);
  });

  it("answers 422 for an incomplete form and writes nothing", async () => {
    const officer = await signedInAs("assessor");

    // Complete on the step being submitted, missing a field on the first. Submitting re-checks
    // every step, which is what stops a hand-written POST filing half a report.
    const res = await file(officer.cookie, completeForm({ device_name: "" }));

    expect(res.statusCode).toBe(422);
    expect(await reportCount()).toBe(0);
    // Refused inside the portal rather than on a page of its own.
    expect(res.body).toContain('<aside class="rail');
  });

  it("stores the report and sends the Officer to it", async () => {
    const officer = await signedInAs("assessor");

    const res = await file(officer.cookie, completeForm());
    const row = await onlyReport();

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`/reports/${row.id}`);

    // The three facts this slice exists to write.
    expect(row.status).toBe("received");
    expect(row.channel).toBe("email");
    expect(row.entered_by_user_id).toBe(officer.id);
  });

  it("names the Officer who typed it on the report", async () => {
    const officer = await signedInAs("assessor", "Grace Mollel");

    await file(officer.cookie, completeForm());
    const row = await onlyReport();

    const body = (await get(`/reports/${row.id}`, officer.cookie)).body;

    expect(body).toContain("Filled by");
    expect(body).toContain("Grace Mollel");
  });

  it("puts it in the same received pool the public form files into", async () => {
    const officer = await signedInAs("assessor");

    await file(officer.cookie, completeForm());
    const row = await onlyReport();

    // Not a queue of its own: a report an Officer typed waits beside every other one.
    const dashboard = (await get("/dashboard", officer.cookie)).body;

    expect(dashboard).toContain(row.number);
    expect(dashboard).toContain(`href="/reports/${row.id}"`);
    expect(dashboard).toContain('<span class="eyebrow">Received</span><b>1</b>');
  });

  it("names the Officer in the trail rather than nobody", async () => {
    const officer = await signedInAs("assessor");

    await file(officer.cookie, completeForm());

    expect(await submittedActors()).toEqual([officer.id]);
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("who is offered the form", () => {
  beforeEach(start);

  it("offers New report to an Officer and to nobody else", async () => {
    const officer = await signedInAs("assessor");

    expect((await get("/dashboard", officer.cookie)).body).toContain('href="/reports/new"');

    // Each role asked on the page it actually lands on: a manager's dashboard is now a redirect to
    // their own workload page, so asking them for the rail here would hand back an empty body.
    for (const [role, landing] of [
      ["manager", "/workload"],
      ["administrator", "/dashboard"],
    ] as const) {
      const staff = await signedInAs(role);
      const body = (await get(landing, staff.cookie)).body;

      expect(body, role).not.toContain('href="/reports/new"');
      // Still signed in, and still given the rail they are entitled to.
      expect(body, role).toContain('href="/reports"');
    }
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("the public door still files its own", () => {
  beforeEach(start);

  it("stores a public submission as nobody's, through the same function", async () => {
    const res = await fileAtThePublicDoor(completeForm());

    expect(res.statusCode).toBe(200);

    const row = await onlyReport();

    // `storeReport` now takes a filing and the public door passes none. These lines are what says
    // its defaults did not move when the staff door started passing its own.
    expect(row.channel).toBe("online_form");
    expect(row.entered_by_user_id).toBeNull();
    expect(row.status).toBe("received");

    // And the reporter still gets their number, on the public door's own page.
    expect(res.body).toContain(row.number);
  });

  it("shows no Filled by line for a report nobody keyed in", async () => {
    const officer = await signedInAs("assessor");

    await fileAtThePublicDoor(completeForm());
    const row = await onlyReport();

    const body = (await get(`/reports/${row.id}`, officer.cookie)).body;

    // Omitted, not dashed: an empty "Filled by" would be a field the reader has to interpret.
    expect(body).not.toContain("Filled by");
    // The rest of the report is there, so this is an absent line rather than an absent page.
    expect(body).toContain("Muhimbili National Hospital");
  });

  it("leaves the public submission anonymous in the trail", async () => {
    await fileAtThePublicDoor(completeForm());

    expect(await submittedActors()).toEqual([null]);
  });
});
