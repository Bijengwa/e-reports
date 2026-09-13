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
 * Who a report belongs to, and what that entitles them to.
 *
 * Two things that are really one: intake no longer decides whose a report is — a Manager does,
 * later, through a route that does not exist yet — and the assessment page is the first thing that
 * decision buys. Kept out of `staff-new-report`, which is about whether a report can be filed at
 * all.
 *
 * Every filing this suite makes must land unassigned, whatever the office's staffing looks like:
 * one active Officer, several, none, or the person who typed the report in themselves. There is no
 * longer a "who gets it" question for intake to answer.
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

/** A staff account, signed in. `name` is what the workload assertions read back. */
async function signedInAs(role: Role, name?: string): Promise<Staff> {
  seeded += 1;
  const email = `assign${seeded}@tmda.go.tz`;
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

/** An assessor who cannot be given work: on the books, switched off. */
async function inactiveAssessor(): Promise<string> {
  seeded += 1;
  const rows = await owner.db.execute(sql`
    INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
    VALUES (${`assign${seeded}@tmda.go.tz`}, 'On leave', 'assessor',
            ${await hashPassword(PASSWORD)}, false, false)
    RETURNING id
  `);
  return (rows[0] as { id: string }).id;
}

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

/** One filing through the public door — nobody signed in, nobody typing it. */
function fileAtThePublicDoor() {
  return app.inject({
    method: "POST",
    url: "/orange-form",
    headers: { host: PUBLIC_HOST, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(completeForm()).toString(),
  });
}

/** One filing through the staff door, typed by this Officer. */
function fileAsStaff(cookie: string) {
  return app.inject({
    method: "POST",
    url: "/reports/new",
    headers: { host: STAFF_HOST, cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(completeForm()).toString(),
  });
}

type ReportRow = {
  id: string;
  number: string;
  status: string;
  assessor1_user_id: string | null;
  assessor1_assigned_at: Date | null;
  entered_by_user_id: string | null;
};

async function onlyReport(): Promise<ReportRow> {
  const rows = await owner.db.execute(sql`
    SELECT id, number, status::text AS status, assessor1_user_id, assessor1_assigned_at,
           entered_by_user_id
      FROM reports
  `);

  expect(rows.length).toBe(1);
  return rows[0] as ReportRow;
}

/** Assign a report the way a Manager will, once that route exists — never through `storeReport`. */
async function assignManually(reportId: string, officerId: string): Promise<void> {
  await owner.db.execute(sql`
    UPDATE reports SET assessor1_user_id = ${officerId}, assessor1_assigned_at = now()
     WHERE id = ${reportId}
  `);
}

/** Give somebody a report that is already open, so a filing after it does not start the pool cold. */
async function preload(assessorId: string, number: string): Promise<string> {
  const rows = await owner.db.execute(sql`
    INSERT INTO reports (number, channel, severity, status, device_name, form_version, payload,
                         assessor1_user_id, assessor1_assigned_at)
    VALUES (${number}, 'online_form', 'other', 'received', 'Earlier device', 'F001', '{}'::jsonb,
            ${assessorId}, now() - INTERVAL '1 day')
    RETURNING id
  `);
  return (rows[0] as { id: string }).id;
}

describe.skipIf(!INTEGRATION_ENABLED)("who a new report goes to", () => {
  beforeEach(start);

  it("leaves a filing unassigned even with one active Officer available", async () => {
    await signedInAs("assessor", "Asha Mrema");

    const res = await fileAtThePublicDoor();
    const row = await onlyReport();

    expect(res.statusCode).toBe(200);
    expect(row.assessor1_user_id).toBeNull();
    expect(row.assessor1_assigned_at).toBeNull();
  });

  it("leaves a filing unassigned with several active Officers available", async () => {
    await signedInAs("assessor", "Asha Mrema");
    await signedInAs("assessor", "Baraka Nyoni");
    await signedInAs("assessor", "Chausiku Njau");

    await fileAtThePublicDoor();
    const row = await onlyReport();

    expect(row.assessor1_user_id).toBeNull();
    expect(row.assessor1_assigned_at).toBeNull();
  });

  it("leaves a filing unassigned when nobody is active", async () => {
    await signedInAs("manager", "Mgr");
    await signedInAs("administrator", "Adm");
    await inactiveAssessor();

    const res = await fileAtThePublicDoor();
    const row = await onlyReport();

    // The report is the point. An unstaffed office must not be able to lose one.
    expect(res.statusCode).toBe(200);
    expect(row.assessor1_user_id).toBeNull();
    expect(row.status).toBe("received");
  });

  it("does not prefer, or otherwise involve, the Officer who typed it in", async () => {
    const typist = await signedInAs("assessor", "Asha Mrema");

    await fileAsStaff(typist.cookie);
    const row = await onlyReport();

    // Who typed it and who must assess it are different questions, and filing no longer answers
    // the second one at all.
    expect(row.entered_by_user_id).toBe(typist.id);
    expect(row.assessor1_user_id).toBeNull();
  });

  it("ignores existing workload entirely — an idle Officer gets nothing from filing alone", async () => {
    const idle = await signedInAs("assessor", "Asha Mrema");
    const busy = await signedInAs("assessor", "Baraka Nyoni");
    await preload(busy.id, "MD-AE/2026/7001");

    await fileAtThePublicDoor();

    const rows = await owner.db.execute(sql`
      SELECT assessor1_user_id FROM reports WHERE number <> 'MD-AE/2026/7001'
    `);
    const filed = rows[0] as { assessor1_user_id: string | null };

    // The old rule would have handed this to the idle Officer. The new one hands it to nobody.
    expect(filed.assessor1_user_id).toBeNull();
    expect(filed.assessor1_user_id).not.toBe(idle.id);
  });

  it("still allocates a report number and stores the submission", async () => {
    const res = await fileAtThePublicDoor();
    const row = await onlyReport();

    expect(res.statusCode).toBe(200);
    expect(row.status).toBe("received");
    expect(row.number).toMatch(/^AEMD\/\d{4}-\d{2}\/\d{3}$/);
    expect(res.body).toContain(row.number);
  });

  it("does not call the removed auto-pick, and always inserts a null assignment", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../src/domain/reports.ts", import.meta.url), "utf8"),
    );

    // Asserted on the source: `pickFirstAssessor` and the advisory lock that protected its
    // workload count are gone, not merely unused. A future re-introduction of either would fail
    // this before it could reach a database.
    expect(source).not.toContain("pickFirstAssessor");
    expect(source).not.toContain("pg_advisory_xact_lock");
    expect(source).toContain("assessor1UserId: null");
    expect(source).toContain("assessor1AssignedAt: null");
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("what an Officer sees of their own queue", () => {
  beforeEach(start);

  it("shows an Officer their own and the orphans, never a colleague's", async () => {
    const mine = await signedInAs("assessor", "Asha Mrema");
    const theirs = await signedInAs("assessor", "Baraka Nyoni");

    const ownId = await preload(mine.id, "MD-AE/2026/7101");
    await preload(theirs.id, "MD-AE/2026/7102");
    await owner.db.execute(sql`
      INSERT INTO reports (number, channel, severity, status, device_name, form_version, payload)
      VALUES ('MD-AE/2026/7103', 'online_form', 'other', 'received', 'Orphan', 'F001', '{}'::jsonb)
    `);

    const body = (await get("/dashboard", mine.cookie)).body;

    expect(body).toContain("MD-AE/2026/7101");
    expect(body).toContain("MD-AE/2026/7103");
    expect(body).not.toContain("MD-AE/2026/7102");
    // The figure counts what the list draws from, so a colleague's is absent from both.
    expect(body).toContain('<span class="eyebrow">Received</span><b>2</b>');
    // Their own offers the way in; the orphan is nobody's to open yet.
    expect(body).toContain(`href="/reports/${ownId}/assessment-1"`);
    expect(body).toContain("Unassigned");
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("the first assessment doorway", () => {
  beforeEach(start);

  it("opens for the Officer the report was given to", async () => {
    const officer = await signedInAs("assessor", "Asha Mrema");
    await fileAtThePublicDoor();
    const row = await onlyReport();
    await assignManually(row.id, officer.id);

    const res = await get(`/reports/${row.id}/assessment-1`, officer.cookie);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Assessment 1");
    expect(res.body).toContain(row.number);
    // Inside the portal, and showing the report as it was submitted.
    expect(res.body).toContain('<aside class="rail');
    expect(res.body).toContain("Submitted answers");
    expect(res.body).toContain("Muhimbili National Hospital");
  });

  it("refuses another Officer, a manager and an administrator", async () => {
    const holder = await signedInAs("assessor", "Asha Mrema");
    await fileAtThePublicDoor();
    const row = await onlyReport();
    await assignManually(row.id, holder.id);

    const stranger = await signedInAs("assessor", "Baraka Nyoni");
    const manager = await signedInAs("manager", "Mgr");
    const admin = await signedInAs("administrator", "Adm");

    for (const [who, staff] of [
      ["another Officer", stranger],
      ["a manager", manager],
      ["an administrator", admin],
    ] as const) {
      expect((await get(`/reports/${row.id}/assessment-1`, staff.cookie)).statusCode, who).toBe(
        403,
      );
    }

    // They can all still read the report itself: this closes the assessment, not the record.
    expect((await get(`/reports/${row.id}`, manager.cookie)).statusCode).toBe(200);
  });

  it("refuses an orphan to everybody, including an active Officer", async () => {
    const officer = await signedInAs("assessor", "Asha Mrema");
    await fileAtThePublicDoor();
    const row = await onlyReport();

    // Left exactly as filing leaves it — unassigned. Nobody was given it, so nobody may assess it.
    expect(row.assessor1_user_id).toBeNull();
    expect((await get(`/reports/${row.id}/assessment-1`, officer.cookie)).statusCode).toBe(403);
  });

  it("offers the link on the report only to the Officer whose it is", async () => {
    const officer = await signedInAs("assessor", "Asha Mrema");
    await fileAtThePublicDoor();
    const row = await onlyReport();
    await assignManually(row.id, officer.id);

    const stranger = await signedInAs("assessor", "Baraka Nyoni");
    const manager = await signedInAs("manager", "Mgr");

    const href = `href="/reports/${row.id}/assessment-1"`;

    expect((await get(`/reports/${row.id}`, officer.cookie)).body).toContain(href);
    expect((await get(`/reports/${row.id}`, stranger.cookie)).body).not.toContain(href);
    expect((await get(`/reports/${row.id}`, manager.cookie)).body).not.toContain(href);
  });

  it("posts to itself and to nowhere else", async () => {
    const officer = await signedInAs("assessor", "Asha Mrema");
    await fileAtThePublicDoor();
    const row = await onlyReport();
    await assignManually(row.id, officer.id);

    const body = (await get(`/reports/${row.id}/assessment-1`, officer.cookie)).body;

    // The F004 arrived, so this page now has exactly one form: its own. The sweep is narrowed to
    // that and no further — sign-out, the assessment itself, and nothing that could move a report
    // to another status or another person by being clicked.
    const posts = (body.match(/action="([^"]*)"/g) ?? []).filter(
      (action) => !action.includes("/logout"),
    );
    expect(posts).toEqual([`action="/reports/${row.id}/assessment-1"`]);
    // The second assessor's section is not here at all: this page is ordinal 1's, and a report
    // may never have a second assessor. It is drawn on the secondary assessment's own page.
    expect(body).not.toContain("Secondary assessor");
    expect(body).not.toContain('name="conclusion_2"');
    expect(body).not.toContain('id="signature-2"');
    // No stray `disabled` either. It used to be here because 7.2 was the one disabled block on the
    // page; with 7.2 gone, a live first assessment is entirely writable, and a disabled control
    // appearing on it would mean something had started rendering somebody else's half again.
    expect(body).not.toContain("disabled");
  });
});
