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
 * Two things that are really one: intake decides whose a report is, and the assessment page is the
 * first thing that answer buys. Kept out of `staff-new-report`, which is about whether a report can
 * be filed at all.
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

/** How many reports each person holds, by name, with the unassigned counted as ORPHAN. */
async function workload(): Promise<Record<string, number>> {
  const rows = await owner.db.execute(sql`
    SELECT coalesce(u.full_name, 'ORPHAN') AS who, count(*)::int AS held
      FROM reports r
      LEFT JOIN users u ON u.id = r.assessor1_user_id
     GROUP BY 1
  `);

  return Object.fromEntries(
    rows.map((row) => [(row as { who: string }).who, (row as { held: number }).held]),
  );
}

type ReportRow = { id: string; number: string; status: string; assessor1_user_id: string | null };

async function onlyReport(): Promise<ReportRow> {
  const rows = await owner.db.execute(sql`
    SELECT id, number, status::text AS status, assessor1_user_id FROM reports
  `);

  expect(rows.length).toBe(1);
  return rows[0] as ReportRow;
}

/** Give somebody a report that is already open, so they start the next filing heavier. */
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

  it("shares three filings between two Officers without leaving one idle", async () => {
    const first = await signedInAs("assessor", "Asha Mrema");
    const second = await signedInAs("assessor", "Baraka Nyoni");

    await fileAtThePublicDoor();
    await fileAsStaff(first.cookie);
    await fileAtThePublicDoor();

    const held = await workload();

    // Two and one in some order, never three and none. Which of them holds two is settled by the
    // next case; this one is about the rule refusing to let anybody idle while another stacks up.
    expect(Object.values(held).sort()).toEqual([1, 2]);
    expect(held.ORPHAN).toBeUndefined();
    expect(Object.keys(held).sort()).toEqual([first.name, second.name].sort());
  });

  it("names the exact Officer when the load is level", async () => {
    const first = await signedInAs("assessor", "Asha Mrema");
    const second = await signedInAs("assessor", "Baraka Nyoni");

    // Nobody holds anything and nobody has ever been assigned, so the tie falls to the lower id.
    const lower = first.id < second.id ? first : second;
    const higher = first.id < second.id ? second : first;

    await fileAtThePublicDoor();
    expect((await onlyReport()).assessor1_user_id).toBe(lower.id);

    // Now load breaks the tie instead of the id, so the next goes the other way. A rule that
    // sorted by id first would hand this one to `lower` again.
    await fileAtThePublicDoor();
    expect((await workload())[higher.name]).toBe(1);
  });

  it("does not prefer the Officer who typed it in", async () => {
    const typist = await signedInAs("assessor", "Asha Mrema");
    const other = await signedInAs("assessor", "Baraka Nyoni");

    // The typist starts heavier, so the report they key in must go to their colleague.
    await preload(typist.id, "MD-AE/2026/7001");

    await fileAsStaff(typist.cookie);

    const rows = await owner.db.execute(sql`
      SELECT assessor1_user_id, entered_by_user_id FROM reports WHERE number <> 'MD-AE/2026/7001'
    `);
    const filed = rows[0] as { assessor1_user_id: string; entered_by_user_id: string };

    // Who typed it and who must assess it are different questions, and this is both answers.
    expect(filed.entered_by_user_id).toBe(typist.id);
    expect(filed.assessor1_user_id).toBe(other.id);
  });

  it("never chooses a deactivated assessor", async () => {
    const active = await signedInAs("assessor", "Asha Mrema");
    const dormant = await inactiveAssessor();

    // Two filings, so even a rule that merely alternated would have to touch the dormant account.
    await fileAtThePublicDoor();
    await fileAtThePublicDoor();

    expect(await workload()).toEqual({ [active.name]: 2 });

    const theirs = await owner.db.execute(sql`
      SELECT count(*)::int AS n FROM reports WHERE assessor1_user_id = ${dormant}
    `);
    expect((theirs[0] as { n: number }).n).toBe(0);
  });

  it("never chooses a manager or an administrator", async () => {
    await signedInAs("manager", "Mgr");
    await signedInAs("administrator", "Adm");
    const officer = await signedInAs("assessor", "Asha Mrema");

    await fileAtThePublicDoor();

    expect(await workload()).toEqual({ [officer.name]: 1 });
    expect((await onlyReport()).assessor1_user_id).toBe(officer.id);
  });

  it("files an orphan rather than refusing when nobody can take it", async () => {
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

  it("keeps serial filings even, which a stale load count could not", async () => {
    const a = await signedInAs("assessor", "Asha Mrema");
    const b = await signedInAs("assessor", "Baraka Nyoni");

    // Each filing is its own transaction and takes the advisory lock before counting, so no two
    // can act on the same count. Two injected requests cannot truly overlap inside one worker, so
    // this asserts the arithmetic rather than the lock; the lock itself is asserted below, on the
    // code that takes it.
    for (let i = 0; i < 4; i += 1) await fileAtThePublicDoor();

    expect(await workload()).toEqual({ [a.name]: 2, [b.name]: 2 });
  });

  it("takes the lock before it counts, not after", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../src/domain/reports.ts", import.meta.url), "utf8"),
    );

    // A lock taken after the count would exclude nothing: both filings would already have read
    // the same numbers. Asserted on the source because the ordering is the whole guarantee and no
    // single-threaded test can observe it.
    const lock = source.indexOf("pg_advisory_xact_lock");
    const pick = source.indexOf("await pickFirstAssessor(tx)");
    const insert = source.indexOf(".insert(reports)");

    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(pick);
    expect(pick).toBeLessThan(insert);
  });

  it("still files a public report as nobody's, but not as nobody's problem", async () => {
    const officer = await signedInAs("assessor", "Asha Mrema");

    await fileAtThePublicDoor();

    const rows = await owner.db.execute(sql`
      SELECT channel::text AS channel, entered_by_user_id, assessor1_user_id, assessor1_assigned_at
        FROM reports
    `);
    const row = rows[0] as {
      channel: string;
      entered_by_user_id: string | null;
      assessor1_user_id: string | null;
      assessor1_assigned_at: Date | null;
    };

    expect(row.channel).toBe("online_form");
    expect(row.entered_by_user_id).toBeNull();
    expect(row.assessor1_user_id).toBe(officer.id);
    expect(row.assessor1_assigned_at).not.toBeNull();
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
    expect(row.assessor1_user_id).toBe(holder.id);

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

  it("refuses an orphan to everybody", async () => {
    const officer = await signedInAs("assessor", "Asha Mrema");
    await owner.db.execute(sql`
      INSERT INTO reports (number, channel, severity, status, device_name, form_version, payload)
      VALUES ('MD-AE/2026/7201', 'online_form', 'other', 'received', 'Orphan', 'F001', '{}'::jsonb)
    `);
    const row = await onlyReport();

    // Nobody was given it, so nobody may assess it. Handing out an orphan is a route that does not
    // exist yet, and this page must not become it by first-come-first-served.
    expect((await get(`/reports/${row.id}/assessment-1`, officer.cookie)).statusCode).toBe(403);
  });

  it("offers the link on the report only to the Officer whose it is", async () => {
    const officer = await signedInAs("assessor", "Asha Mrema");
    await fileAtThePublicDoor();
    const row = await onlyReport();

    const stranger = await signedInAs("assessor", "Baraka Nyoni");
    const manager = await signedInAs("manager", "Mgr");

    const href = `href="/reports/${row.id}/assessment-1"`;

    expect((await get(`/reports/${row.id}`, officer.cookie)).body).toContain(href);
    expect((await get(`/reports/${row.id}`, stranger.cookie)).body).not.toContain(href);
    expect((await get(`/reports/${row.id}`, manager.cookie)).body).not.toContain(href);
  });

  it("is a page to read, with nothing on it that submits", async () => {
    const officer = await signedInAs("assessor", "Asha Mrema");
    await fileAtThePublicDoor();
    const row = await onlyReport();

    const body = (await get(`/reports/${row.id}/assessment-1`, officer.cookie)).body;

    // The same sweep the register is held to: sign-out is the only thing that posts. No F004
    // write path, no status change, nothing that could move a report by being clicked.
    const posts = (body.match(/action="([^"]*)"/g) ?? []).filter(
      (action) => !action.includes("/logout"),
    );
    expect(posts).toEqual([]);
    // And the second assessor's section is not here at all.
    expect(body).not.toContain("Assessment 2");
    expect(body).not.toContain("7.2");
  });
});
