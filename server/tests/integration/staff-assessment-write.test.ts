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
 * Writing the first assessment.
 *
 * `staff-assignment` pins who may open the page. This is what happens when they use it: what lands
 * in `assessments`, what a status may become, and why a second submit is refused.
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
  const email = `f004-${seeded}@tmda.go.tz`;
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

/** A report filed through the public door, so intake assigns it the way it really does. */
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

/** Everything a submission must carry, so a case can leave one out on purpose. */
function completeAssessment(signature: string, over: Record<string, string> = {}) {
  return {
    intent: "submit",
    seriousness: "serious",
    expectedness: "unexpected",
    causality: "probable",
    // Section 5 is now required too — locked in the same commit that restyled it away from pill
    // chrome. A fixture built before that commit would otherwise silently describe an incomplete
    // submission and every "complete" case here would 422.
    signal_status: "signal",
    risk_level: "high",
    conclusion: "Recommend risk communication and enhanced monitoring.",
    signature,
    ...over,
  };
}

type Report = { id: string; number: string; status: string; assessor1_user_id: string | null };

async function theReport(): Promise<Report> {
  const rows = await owner.db.execute(sql`
    SELECT id, number, status::text AS status, assessor1_user_id FROM reports
  `);
  expect(rows.length).toBe(1);
  return rows[0] as Report;
}

type Assessment = {
  assessor_id: string;
  ordinal: number;
  form_version: string;
  payload: Record<string, unknown>;
  conclusion: string | null;
  submitted_at: Date | null;
};

async function assessments(): Promise<Assessment[]> {
  const rows = await owner.db.execute(sql`
    SELECT assessor_id, ordinal, form_version, payload, conclusion, submitted_at
      FROM assessments ORDER BY ordinal
  `);
  return rows as unknown as Assessment[];
}

async function assessmentCount(): Promise<number> {
  const rows = await owner.db.execute(sql`SELECT count(*)::int AS n FROM assessments`);
  return (rows[0] as { n: number }).n;
}

/** The Officer the report was actually given to, plus the report itself. */
async function assigned(): Promise<{ officer: Staff; report: Report }> {
  const officer = await signedInAs("assessor", "Asha Mrema");
  await fileAtThePublicDoor();
  const report = await theReport();
  expect(report.assessor1_user_id).toBe(officer.id);
  return { officer, report };
}

describe.skipIf(!INTEGRATION_ENABLED)("opening the F004", () => {
  beforeEach(start);

  it("shows the assignee the whole form and the report, without a 7.2 editor", async () => {
    const { officer, report } = await assigned();

    const res = await get(`/reports/${report.id}/assessment-1`, officer.cookie);

    expect(res.statusCode).toBe(200);
    // Sections A through 7.1, by their own headings.
    expect(res.body).toContain("Administrative information");
    expect(res.body).toContain("Event / incident assessment");
    expect(res.body).toContain("IMDRF category");
    expect(res.body).toContain("Relationship / causality assessment");
    expect(res.body).toContain("Signal detection");
    expect(res.body).toContain("Risk assessment");
    expect(res.body).toContain("Conclusion of assessment");
    // The official choices, not a bare dropdown.
    expect(res.body).toContain("Unrelated");
    expect(res.body).toContain("Certain");
    expect(res.body).toContain("Critical Risk");
    expect(res.body).toContain('name="conclusion"');
    // The orange report is on the same page.
    expect(res.body).toContain("Submitted answers");
    expect(res.body).toContain("Muhimbili National Hospital");
    // 7.2 is named as the second assessor's and carries nothing to type into.
    expect(res.body).toContain("Second assessor concluding remarks");
    expect(res.body).not.toContain('name="conclusion_2"');
    expect(res.body).not.toContain('name="c7_2"');
  });

  it("prefills 1.1 from the reporter's full name when no brand was given", async () => {
    const { officer, report } = await assigned();

    const body = (await get(`/reports/${report.id}/assessment-1`, officer.cookie)).body;

    // The bug the form shipped with: a device that had a name printed "Not supplied".
    expect(body).toContain("Philips IntelliVue MX450");
    expect(body).toContain("Patient Monitor");
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("who may write one", () => {
  beforeEach(start);

  it("refuses everyone but the assignee, and writes nothing for them", async () => {
    const { report } = await assigned();

    const stranger = await signedInAs("assessor", "Baraka Nyoni");
    const manager = await signedInAs("manager", "Mgr");
    const admin = await signedInAs("administrator", "Adm");

    for (const [who, staff] of [
      ["another Officer", stranger],
      ["a manager", manager],
      ["an administrator", admin],
    ] as const) {
      const url = `/reports/${report.id}/assessment-1`;
      expect((await get(url, staff.cookie)).statusCode, `GET ${who}`).toBe(403);
      expect((await post(url, staff.cookie, { intent: "save" })).statusCode, `POST ${who}`).toBe(
        403,
      );
    }

    expect(await assessmentCount()).toBe(0);
    expect((await theReport()).status).toBe("received");
  });

  it("refuses an orphan and writes nothing", async () => {
    const officer = await signedInAs("assessor", "Asha Mrema");
    await owner.db.execute(sql`
      INSERT INTO reports (number, channel, severity, status, device_name, form_version, payload)
      VALUES ('MD-AE/2026/7300', 'online_form', 'other', 'received', 'Orphan', 'F001', '{}'::jsonb)
    `);
    const report = await theReport();

    const url = `/reports/${report.id}/assessment-1`;
    expect((await get(url, officer.cookie)).statusCode).toBe(403);
    expect((await post(url, officer.cookie, { intent: "save" })).statusCode).toBe(403);

    expect(await assessmentCount()).toBe(0);
    expect((await theReport()).status).toBe("received");
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("saving a draft", () => {
  beforeEach(start);

  it("stores it against the assignee and starts the assessment", async () => {
    const { officer, report } = await assigned();

    const res = await post(`/reports/${report.id}/assessment-1`, officer.cookie, {
      intent: "save",
      causality: "possible",
      c4_3: "Temporal association is weak.",
    });

    expect(res.statusCode).toBe(302);

    const [row] = await assessments();
    expect(row.ordinal).toBe(1);
    // Never a fresh pick: the assessment names whoever the report was assigned to.
    expect(row.assessor_id).toBe(report.assessor1_user_id);
    expect(row.form_version).toBe("TMDA/DMD/MDV/F/004 Rev 05");
    expect(row.submitted_at).toBeNull();
    expect((await theReport()).status).toBe("first_assessment");
  });

  it("gives the answers back on the next visit", async () => {
    const { officer, report } = await assigned();

    await post(`/reports/${report.id}/assessment-1`, officer.cookie, {
      intent: "save",
      causality: "possible",
      conclusion: "Awaiting the manufacturer response.",
    });

    const body = (await get(`/reports/${report.id}/assessment-1`, officer.cookie)).body;

    expect(body).toContain("Awaiting the manufacturer response.");
    expect(body).toContain('value="possible" checked');
  });

  it("updates the one row rather than adding another", async () => {
    const { officer, report } = await assigned();
    const url = `/reports/${report.id}/assessment-1`;

    await post(url, officer.cookie, { intent: "save", conclusion: "First thoughts." });
    await post(url, officer.cookie, { intent: "save", conclusion: "Second thoughts." });

    expect(await assessmentCount()).toBe(1);
    expect((await assessments())[0].conclusion).toBe("Second thoughts.");
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("submitting", () => {
  beforeEach(start);

  it("refuses an incomplete one and leaves the record alone", async () => {
    const { officer, report } = await assigned();
    const url = `/reports/${report.id}/assessment-1`;

    await post(url, officer.cookie, { intent: "save", conclusion: "Draft." });

    // Everything but the risk level, which a submission may not go without.
    const res = await post(
      url,
      officer.cookie,
      completeAssessment(officer.name, { risk_level: "" }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("Risk assessment is required");
    // Still a draft, still where it was, and still carrying what was saved before.
    const [row] = await assessments();
    expect(row.submitted_at).toBeNull();
    expect(row.conclusion).toBe("Draft.");
    expect((await theReport()).status).toBe("first_assessment");
  });

  it("refuses a signature that is not the assessor's own name", async () => {
    const { officer, report } = await assigned();

    const res = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      completeAssessment("Somebody Else"),
    );

    expect(res.statusCode).toBe(422);
    expect(await assessmentCount()).toBe(0);
    expect((await theReport()).status).toBe("received");
  });

  it("sends a complete one on and closes it", async () => {
    const { officer, report } = await assigned();

    const res = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      completeAssessment(officer.name),
    );

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`/reports/${report.id}`);

    const [row] = await assessments();
    expect(row.submitted_at).not.toBeNull();
    expect(row.conclusion).toBe("Recommend risk communication and enhanced monitoring.");
    expect(row.payload.risk_level).toBe("high");
    expect(row.payload.causality).toBe("probable");
    expect((await theReport()).status).toBe("awaiting_second_assessor");
  });

  it("refuses a second submit and changes nothing", async () => {
    const { officer, report } = await assigned();
    const url = `/reports/${report.id}/assessment-1`;

    await post(url, officer.cookie, completeAssessment(officer.name));
    const first = (await assessments())[0];

    const again = await post(
      url,
      officer.cookie,
      completeAssessment(officer.name, { conclusion: "Changed my mind." }),
    );

    expect(again.statusCode).toBe(403);
    const [row] = await assessments();
    expect(row.conclusion).toBe(first.conclusion);
    expect(row.submitted_at).toEqual(first.submitted_at);
    expect((await theReport()).status).toBe("awaiting_second_assessor");
  });

  it("names the Officer in the trail", async () => {
    const { officer, report } = await assigned();

    await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      completeAssessment(officer.name),
    );

    const rows = await owner.db.execute(sql`
      SELECT actor_user_id FROM audit_log WHERE action = 'assessment.submitted'
    `);

    expect(rows.length).toBe(1);
    expect((rows[0] as { actor_user_id: string }).actor_user_id).toBe(officer.id);
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("what the Officer sees afterwards", () => {
  beforeEach(start);

  it("stops calling a submitted report work that is waiting", async () => {
    const { officer, report } = await assigned();

    expect((await get("/dashboard", officer.cookie)).body).toContain(report.number);

    await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      completeAssessment(officer.name),
    );

    const dashboard = (await get("/dashboard", officer.cookie)).body;

    // The received queue is what has arrived and not been assessed. This one has been.
    expect(dashboard).not.toContain(report.number);
    expect(dashboard).toContain('<span class="eyebrow">Received</span><b>0</b>');

    // It is still their work, listed as sent on.
    const mine = (await get("/assessments", officer.cookie)).body;
    expect(mine).toContain(report.number);
    expect(mine).toContain("Submitted");
  });

  it("offers an Officer only sign-out, and this assessment's own POST", async () => {
    const { officer, report } = await assigned();

    for (const url of ["/dashboard", "/assessments", "/reports", `/reports/${report.id}`]) {
      const body = (await get(url, officer.cookie)).body;
      const posts = (body.match(/action="([^"]*)"/g) ?? []).filter(
        (action) => !action.includes("/logout"),
      );
      expect(posts, url).toEqual([]);
    }

    // The assessment page is the one exception, and it posts to itself.
    const body = (await get(`/reports/${report.id}/assessment-1`, officer.cookie)).body;
    const posts = (body.match(/action="([^"]*)"/g) ?? []).filter(
      (action) => !action.includes("/logout"),
    );
    expect(posts).toEqual([`action="/reports/${report.id}/assessment-1"`]);
  });
});
