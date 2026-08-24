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
 * The Officer's own assigned work — the read side of "Approve & assign work".
 *
 * Two things to pin, and the second matters more than the first. That the Officer named in a
 * decision can find the report at all: before this page the decision was written, the report moved
 * to `assigned_for_work`, and the only person it obliged was told nothing. And that nobody else
 * can — not by reading the list, and not by editing the id in the address, which is how an
 * ownership check that runs after the load rather than before it gets found out.
 *
 * Everything here is driven through the real routes: filed at the public door, assessed, handed on
 * and decided. A `report_decisions` row written straight into the table would test this page
 * against a fixture rather than against the workflow that produces it.
 */

const STAFF_HOST = "staff.test";
const PUBLIC_HOST = "public.test";
const PASSWORD = "a correct staff password";
const COOKIE = "__Host-ae_session";

/** A well-formed uuid that names nothing, for the "not a report at all" case. */
const NOBODY = "00000000-0000-4000-8000-000000000000";

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
  const email = `mywork-${seeded}@tmda.go.tz`;
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

function fileAtThePublicDoor(deviceName: string) {
  return app.inject({
    method: "POST",
    url: "/orange-form",
    headers: { host: PUBLIC_HOST, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({
      step: "5",
      action: "submit",
      device_name: deviceName,
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
      location: "Ilala, Dar es Salaam",
      phone: "712345678",
      report_date: "2026-08-02",
      device_location: "Biomedical engineering store",
    }).toString(),
  });
}

/** A submitted F004, filled in enough to pass `validateForSubmit`. */
function completeAssessment(signature: string) {
  return {
    intent: "submit",
    device_type: "md",
    registration_number: "",
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
    signal_status: "signal",
    c5: "Second report against this lot within a month.",
    risk_level: "high",
    c6: "Serious outcome with an unresolved cause.",
    actions: "monitoring",
    conclusion: "Recommend risk communication and enhanced monitoring.",
    signature,
  };
}

/** A complete secondary review: Agree on every one of A1's answers. */
function completeSecondary() {
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
  };
}

type Report = { id: string; number: string; assessor1_user_id: string | null };

async function reportNamed(deviceName: string): Promise<Report> {
  const rows = await owner.db.execute(sql`
    SELECT id, number, assessor1_user_id FROM reports WHERE device_name = ${deviceName}
  `);
  expect(rows.length).toBe(1);
  return rows[0] as Report;
}

async function statusOf(id: string): Promise<string> {
  const rows = await owner.db.execute(sql`
    SELECT status::text AS status FROM reports WHERE id = ${id}
  `);
  return (rows[0] as { status: string }).status;
}

type Assigned = { manager: Staff; first: Staff; second: Staff; worker: Staff; report: Report };

/**
 * A report driven all the way to `assigned_for_work`, through the real routes.
 *
 * Intake chooses A1 for itself, so the pool is named here and whoever it picked is looked up rather
 * than assumed. `worker` is deliberately somebody who did not assess it — not because the rule
 * requires it (carrying out work is no conflict of interest with having assessed) but so that a
 * check written as "was I involved?" rather than "was I named?" fails a case below.
 */
async function assignedForWork(deviceName = "Philips IntelliVue MX450"): Promise<Assigned> {
  const manager = await signedInAs("manager", "Grace Mollel");
  const pool = [
    await signedInAs("assessor", "Asha Mrema"),
    await signedInAs("assessor", "Baraka Nyoni"),
    await signedInAs("assessor", "Chausiku Njau"),
  ];

  await fileAtThePublicDoor(deviceName);
  const filed = await reportNamed(deviceName);

  // Intake picks A1 itself, so the three roles are read off that choice rather than decided before
  // it. Naming the work officer up front would sometimes name the Officer intake had just made A1,
  // and the case below — that assessing a report is not being handed its work — would then be
  // asserting that somebody is refused their own assignment.
  const first = pool.find((s) => s.id === filed.assessor1_user_id);
  if (first === undefined) throw new Error("intake assigned nobody this suite knows");
  const [second, worker] = pool.filter((s) => s.id !== first.id);
  if (second === undefined || worker === undefined) throw new Error("need two more Officers");

  await post(`/reports/${filed.id}/assessment-1`, first.cookie, completeAssessment(first.name));
  await post(`/reports/${filed.id}/assign-next-assessor`, manager.cookie, {
    assessor_id: second.id,
    comment: "Please take the second assessment.",
  });
  await post(`/reports/${filed.id}/secondary-assessment`, second.cookie, completeSecondary());

  await post(`/reports/${filed.id}/assign-work-officer`, manager.cookie, {
    officer_id: worker.id,
    comment: "Issue the risk communication and set up enhanced monitoring.",
  });

  expect(await statusOf(filed.id)).toBe("assigned_for_work");

  return { manager, first, second, worker, report: filed };
}

describe.skipIf(!INTEGRATION_ENABLED)("an Officer's own assigned work", () => {
  beforeEach(start);

  it("lists the report the manager assigned to them, and what it says about it", async () => {
    const { manager, worker, report } = await assignedForWork();

    const body = (await get("/my-work", worker.cookie)).body;

    expect(body).toContain(report.number);
    expect(body).toContain("Philips IntelliVue MX450");
    // Who handed it over, which is the fact this page exists to carry.
    expect(body).toContain(manager.name);
    expect(body).toContain('<span class="tag muted">Assigned for work</span>');
    // The severity caption, not the stored enum value.
    expect(body).toContain("Hospitalization");
    // The way in is the work item, never the register's copy.
    expect(body).toContain(`href="/my-work/${report.id}"`);
  });

  it("says so plainly when nothing has been assigned", async () => {
    const officer = await signedInAs("assessor", "Asha Mrema");

    const body = (await get("/my-work", officer.cookie)).body;

    expect(body).toContain("Nothing has been assigned to you for work yet.");
    expect(body).not.toContain("<table");
  });

  it("shows the report, the assessments and the manager's decisions on one work item", async () => {
    const { manager, first, second, worker, report } = await assignedForWork();

    const res = await get(`/my-work/${report.id}`, worker.cookie);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(report.number);

    // The instruction that came with the assignment, and who left it.
    expect(res.body).toContain("Issue the risk communication and set up enhanced monitoring.");
    expect(res.body).toContain(manager.name);

    // How it was assessed: every ordinal, and A1's own recommendation.
    expect(res.body).toContain("A1");
    expect(res.body).toContain(first.name);
    expect(res.body).toContain("A2");
    expect(res.body).toContain(second.name);
    expect(res.body).toContain("Recommend risk communication and enhanced monitoring.");

    // The decision history, the same list the manager reads on the report.
    expect(res.body).toContain("Manager decision history");
    expect(res.body).toContain("Please take the second assessment.");

    // The report as filed is on the page, not merely linked to.
    expect(res.body).toContain("Muhimbili National Hospital");
  });

  it("carries no work lifecycle: nothing to start, submit or close", async () => {
    const { worker, report } = await assignedForWork();

    for (const url of ["/my-work", `/my-work/${report.id}`]) {
      const body = (await get(url, worker.cookie)).body;

      // The MVP ends at the manager's decision. A control here would be a workflow nobody has
      // designed yet, so there is no action posting anywhere from either page.
      expect(body, url).not.toContain("Start work");
      expect(body, url).not.toContain("Submit work");
      expect(body, url).not.toContain("Complete");
      expect(body, url).not.toContain('action="/my-work');
    }
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("who may read one Officer's work", () => {
  beforeEach(start);

  it("keeps another Officer's assignment off this Officer's list", async () => {
    const { worker, report } = await assignedForWork();
    const stranger = await signedInAs("assessor", "Devota Kimaro");

    const body = (await get("/my-work", stranger.cookie)).body;

    expect(body).not.toContain(report.number);
    expect(body).toContain("Nothing has been assigned to you for work yet.");
    // And the assignment really does exist — the emptiness is the filter, not a broken fixture.
    expect((await get("/my-work", worker.cookie)).body).toContain(report.number);
  });

  it("refuses another Officer's work item to someone who edits the id in the address", async () => {
    const { report } = await assignedForWork();
    const stranger = await signedInAs("assessor", "Devota Kimaro");

    const res = await get(`/my-work/${report.id}`, stranger.cookie);

    expect(res.statusCode).toBe(403);
    // Refused before anything about the report is read, so the refusal cannot leak it either.
    expect(res.body).not.toContain(report.number);
    expect(res.body).not.toContain("Philips IntelliVue MX450");
    expect(res.body).not.toContain("Issue the risk communication");
  });

  it("refuses the assessors of that very report, who were not the ones assigned the work", async () => {
    const { first, second, report } = await assignedForWork();

    // Having assessed a report is not being handed the work arising from it. This is the case a
    // check written as "was I involved?" rather than "was I named?" would let through.
    for (const officer of [first, second]) {
      const res = await get(`/my-work/${report.id}`, officer.cookie);
      expect(res.statusCode, officer.name).toBe(403);
      expect(res.body, officer.name).not.toContain(report.number);
    }
  });

  it("refuses a report that has never been assigned for work at all", async () => {
    const officer = await signedInAs("assessor", "Asha Mrema");
    await fileAtThePublicDoor("Draeger Infinity M540");
    const fresh = await reportNamed("Draeger Infinity M540");

    expect((await get(`/my-work/${fresh.id}`, officer.cookie)).statusCode).toBe(403);
  });

  it("answers 404 for a malformed id, and refuses one that names no report", async () => {
    const officer = await signedInAs("assessor", "Asha Mrema");

    expect((await get("/my-work/not-a-uuid", officer.cookie)).statusCode).toBe(404);
    // A well-formed id naming nothing is refused rather than 404'd: the ownership test runs first
    // and fails, which is the same answer it gives for a report that is not this reader's.
    expect((await get(`/my-work/${NOBODY}`, officer.cookie)).statusCode).toBe(403);
  });

  it("is the Officer's page and nobody else's, whatever their standing", async () => {
    const { report } = await assignedForWork();
    const manager = await signedInAs("manager", "Second Manager");
    const admin = await signedInAs("administrator", "Bijengwa Mshindi");

    for (const staff of [manager, admin]) {
      for (const url of ["/my-work", `/my-work/${report.id}`]) {
        const res = await get(url, staff.cookie);
        expect(res.statusCode, `${staff.name} ${url}`).toBe(403);
        expect(res.body, `${staff.name} ${url}`).not.toContain(report.number);
      }
    }
  });

  it("turns an anonymous request away at the session guard", async () => {
    const { report } = await assignedForWork();

    for (const url of ["/my-work", `/my-work/${report.id}`]) {
      const res = await app.inject({ url, headers: { host: STAFF_HOST } });
      expect(res.statusCode, url).toBe(302);
      expect(res.headers.location, url).toBe("/");
    }
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("the rail's own entry for it", () => {
  beforeEach(start);

  it("offers My work to an Officer and to nobody else", async () => {
    const officer = await signedInAs("assessor", "Asha Mrema");
    const manager = await signedInAs("manager", "Grace Mollel");
    const admin = await signedInAs("administrator", "Bijengwa Mshindi");

    const theirs = (await get("/my-work", officer.cookie)).body;
    expect(theirs).toContain('href="/my-work"');
    expect(theirs).toContain("My work");
    // The rail marks where the reader is, so the entry and the page agree.
    expect(theirs).toContain('<a href="/my-work" class="on" aria-current="page">');

    // A link that answered 403 when clicked would be worse than no link, so neither gets one.
    expect((await get("/workload", manager.cookie)).body).not.toContain('href="/my-work"');
    expect((await get("/users", admin.cookie)).body).not.toContain('href="/my-work"');
  });
});
