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
function completeAssessment(over: Record<string, string> = {}) {
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
    // Section 5 is now required too — locked in the same commit that restyled it away from pill
    // chrome. A fixture built before that commit would otherwise silently describe an incomplete
    // submission and every "complete" case here would 422.
    signal_status: "signal",
    c5: "Second report against this lot within a month.",
    risk_level: "high",
    c6: "Serious outcome with an unresolved cause.",
    actions: "monitoring",
    conclusion: "Recommend risk communication and enhanced monitoring.",
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

  it("shows the assignee their own half of the form, and no trace of a second assessor", async () => {
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
    // Nothing about a secondary assessment appears here at all. This route reads and writes
    // ordinal 1 and nothing else, and a report may never have a second assessor — so 7.2, the
    // second signature row and the masthead's secondary-assessor cells were all empty boxes
    // implying a person who does not exist, on a form the first assessor is trying to fill in.
    // The secondary assessment has a page of its own, which is where all of it lives.
    expect(res.body).not.toContain("Secondary assessor");
    expect(res.body).not.toContain('name="conclusion_2"');
    expect(res.body).not.toContain('name="c7_2"');
    expect(res.body).not.toContain('id="signature-2"');
    // The first assessor's own strip stays, and is the only one.
    expect(res.body).toContain("1st Assessor");
  });

  it("offers jump targets for all eight sections", async () => {
    const { officer, report } = await assigned();

    const body = (await get(`/reports/${report.id}/assessment-1`, officer.cookie)).body;

    for (let n = 1; n <= 8; n += 1) {
      expect(body, `#section-${n}`).toContain(`href="#section-${n}"`);
      expect(body, `id="section-${n}"`).toContain(`id="section-${n}"`);
    }
    // Navigation, not part of the F004's own document: it has to appear before the form starts,
    // or a reader tabbing through the page would meet the assessment before the way around it.
    expect(body.indexOf('class="f4-jump"')).toBeLessThan(body.indexOf("<form"));
  });

  it("cannot post a secondary assessor's fields, because it never draws them", async () => {
    const { officer, report } = await assigned();

    const body = (await get(`/reports/${report.id}/assessment-1`, officer.cookie)).body;

    // This replaces a narrower guarantee. 7.2 used to be drawn here disabled and nameless, and the
    // test swept the block for any `name=` that could carry a value. Not drawing the block at all
    // is the stronger form of the same rule: there is no markup to sweep, so no future edit to
    // 7.2 can give this page a field it did not have.
    expect(body).not.toContain("Secondary assessor concluding remarks");
    for (const field of ["conclusion_2", "actions_2", "signature_2", "c7_2"]) {
      expect(body, field).not.toContain(`name="${field}"`);
    }

    // 7.1 — the half that IS this Officer's — is untouched and still writable.
    expect(body).toContain('name="conclusion"');
    expect(body).toContain('name="actions"');
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

  it("saves with section 5 left blank, and does not submit", async () => {
    const { officer, report } = await assigned();

    // Everything else a submission would need, deliberately with no signal_status: a draft is
    // allowed to be as incomplete as the assessor left it, section 5 included.
    const res = await post(`/reports/${report.id}/assessment-1`, officer.cookie, {
      intent: "save",
      seriousness: "serious",
      c2_6: "Required medical intervention and a 24-hour admission.",
      expectedness: "unexpected",
      c4_1: "Not described in the manufacturer's IFU or risk file.",
      causality: "probable",
      risk_level: "high",
      c6: "Serious outcome with an unresolved cause.",
      conclusion: "Still thinking about this one.",
    });

    expect(res.statusCode).toBe(302);

    const [row] = await assessments();
    expect(row.payload.signal_status ?? "").toBe("");
    expect(row.submitted_at).toBeNull();
    expect((await theReport()).status).toBe("first_assessment");
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("submitting", () => {
  beforeEach(start);

  it("refuses an incomplete one and leaves the record alone", async () => {
    const { officer, report } = await assigned();
    const url = `/reports/${report.id}/assessment-1`;

    await post(url, officer.cookie, { intent: "save", conclusion: "Draft." });

    // Everything but the risk level, which a submission may not go without.
    const res = await post(url, officer.cookie, completeAssessment({ risk_level: "" }));

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("Risk assessment is required");
    // Still a draft, still where it was, and still carrying what was saved before.
    const [row] = await assessments();
    expect(row.submitted_at).toBeNull();
    expect(row.conclusion).toBe("Draft.");
    expect((await theReport()).status).toBe("first_assessment");
  });

  it("refuses a submission missing only section 5, and leaves nothing sent", async () => {
    const { officer, report } = await assigned();

    const res = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      completeAssessment({ signal_status: "" }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("5 Signal detection is required");

    // Nothing was written at all here — this is the first thing this officer has done to the
    // report, so there is no earlier draft to be "still" anything. A row existing at all, or the
    // status having moved even one step, would both be the route acting on a rejected submission.
    expect(await assessmentCount()).toBe(0);
    const after = await theReport();
    expect(after.status).toBe("received");
    expect(after.status).not.toBe("awaiting_second_assessor");
  });

  it("accepts 'potential safety signal' as a complete submission", async () => {
    const { officer, report } = await assigned();

    const res = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      completeAssessment({ signal_status: "signal" }),
    );

    expect(res.statusCode).toBe(302);
    expect((await theReport()).status).toBe("awaiting_second_assessor");

    const [row] = await assessments();
    expect(row.payload.signal_status).toBe("signal");
    expect(row.submitted_at).not.toBeNull();
  });

  it("accepts 'not a signal at this stage' as a complete submission", async () => {
    const { officer, report } = await assigned();

    const res = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      completeAssessment({ signal_status: "not_signal" }),
    );

    expect(res.statusCode).toBe(302);
    expect((await theReport()).status).toBe("awaiting_second_assessor");

    const [row] = await assessments();
    expect(row.payload.signal_status).toBe("not_signal");
    expect(row.submitted_at).not.toBeNull();
  });

  it("refuses to sign with the wrong password", async () => {
    const { officer, report } = await assigned();

    const res = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      completeAssessment({ signing_password: "not the right password" }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("Incorrect password");
    expect(await assessmentCount()).toBe(0);
    expect((await theReport()).status).toBe("received");
  });

  it("refuses to sign with no password at all", async () => {
    const { officer, report } = await assigned();

    const res = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      completeAssessment({ signing_password: "" }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("Enter your password");
    expect(await assessmentCount()).toBe(0);
    expect((await theReport()).status).toBe("received");
  });

  it("sends a complete one on and closes it", async () => {
    const { officer, report } = await assigned();

    const res = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      completeAssessment(),
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

    await post(url, officer.cookie, completeAssessment());
    const first = (await assessments())[0];

    const again = await post(
      url,
      officer.cookie,
      completeAssessment({ conclusion: "Changed my mind." }),
    );

    expect(again.statusCode).toBe(403);
    const [row] = await assessments();
    expect(row.conclusion).toBe(first.conclusion);
    expect(row.submitted_at).toEqual(first.submitted_at);
    expect((await theReport()).status).toBe("awaiting_second_assessor");
  });

  it("names the Officer in the trail", async () => {
    const { officer, report } = await assigned();

    await post(`/reports/${report.id}/assessment-1`, officer.cookie, completeAssessment());

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

    await post(`/reports/${report.id}/assessment-1`, officer.cookie, completeAssessment());

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
