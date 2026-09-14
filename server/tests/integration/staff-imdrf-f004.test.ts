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
import { type ImdrfFixture, imdrfAssessmentFields, seedImdrfForF004 } from "./imdrf-fixture.js";

/**
 * Phase 3: F004 Section 3 drawing its terminology from the IMDRF repository, server-side.
 *
 * `staff-assessment-write` and `staff-secondary-chain` already pin the rest of A1's and the
 * secondary chain's own validation; this file is the one place that pins the IMDRF-specific rules
 * `domain/imdrf/f004-integration.ts` adds on top of them — the ones a hand-edited POST is exactly
 * what would try to get past: the wrong Annex, a category rather than a specific term, an
 * unpublished or foreign release, and free text with no repository reference behind it.
 */

const STAFF_HOST = "staff.test";
const PUBLIC_HOST = "public.test";
const PASSWORD = "a correct staff password";
const COOKIE = "__Host-ae_session";

type Role = "administrator" | "manager" | "assessor";
type Staff = { cookie: string; id: string; name: string };

let owner: DatabaseHandle;
let app: FastifyInstance;
let imdrf: ImdrfFixture;

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
  imdrf = await seedImdrfForF004(owner.db);
}

let seeded = 0;

async function signedInAs(role: Role, name?: string): Promise<Staff> {
  seeded += 1;
  const email = `f004-imdrf-${seeded}@tmda.go.tz`;
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

type Report = { id: string; status: string };

async function theReport(): Promise<Report> {
  const rows = await owner.db.execute(sql`SELECT id, status::text AS status FROM reports`);
  expect(rows.length).toBe(1);
  return rows[0] as Report;
}

/** An assessor holding an unsubmitted A1, exactly as `staff-assessment-write`'s own `assigned()`
 *  sets one up — standing in for the Manager's manual assignment. */
async function assigned(): Promise<{ officer: Staff; report: Report }> {
  const officer = await signedInAs("assessor", "Asha Mrema");
  await fileAtThePublicDoor();
  const filed = await theReport();
  await owner.db.execute(sql`
    UPDATE reports SET assessor1_user_id = ${officer.id}, assessor1_assigned_at = now()
     WHERE id = ${filed.id}
  `);
  return { officer, report: await theReport() };
}

/** Everything a first assessment must carry to submit, minus whatever the IMDRF section a test
 *  wants to override or omit — see `completeAssessment()` in `staff-assessment-write.test.ts` for
 *  the same shape, with the IMDRF spread pulled out so a case can replace it. */
function baseAssessment(over: Record<string, string> = {}): Record<string, string> {
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
    expectedness: "unexpected",
    c4_1: "Not described in the manufacturer's IFU or risk file.",
    causality: "probable",
    c4_3: "Temporal relationship with device use; no other cause identified.",
    signal_status: "signal",
    c5: "Second report against this lot within a month.",
    risk_level: "high",
    c6: "Serious outcome and an unresolved cause.",
    actions: "monitoring",
    conclusion: "Recommend risk communication and enhanced monitoring.",
    ...imdrfAssessmentFields(imdrf),
    ...over,
  };
}

async function payloadOf(reportId: string, ordinal: number): Promise<Record<string, unknown>> {
  const rows = await owner.db.execute(sql`
    SELECT payload FROM assessments WHERE report_id = ${reportId} AND ordinal = ${ordinal}
  `);
  return (rows[0] as { payload: Record<string, unknown> } | undefined)?.payload ?? {};
}

/** A leaf term of the given annex, distinct from the fixture's own seeded `annex01` term. */
async function seedLeafTerm(annex: string, code: string): Promise<string> {
  const rows = await owner.db.execute(sql`
    INSERT INTO imdrf_terms (release_id, annex, code, term, code_hierarchy, level, sort_order)
    VALUES (${imdrf.releaseId}, ${annex}, ${code}, ${`Alternative ${code}`}, ${code}, 1, 1)
    RETURNING id
  `);
  return (rows[0] as { id: string }).id;
}

/** A term with a child of its own — a category, never a valid final choice. */
async function seedCategoryTerm(annex: string, code: string): Promise<string> {
  const rows = await owner.db.execute(sql`
    INSERT INTO imdrf_terms (release_id, annex, code, term, code_hierarchy, level, sort_order)
    VALUES (${imdrf.releaseId}, ${annex}, ${code}, ${`Category ${code}`}, ${code}, 1, 2)
    RETURNING id
  `);
  const categoryId = (rows[0] as { id: string }).id;
  await owner.db.execute(sql`
    INSERT INTO imdrf_terms (release_id, annex, code, term, code_hierarchy, level, sort_order, parent_term_id)
    VALUES (${imdrf.releaseId}, ${annex}, ${`${code}01`}, ${"Child"}, ${`${code}|${code}01`}, 2, 0, ${categoryId})
  `);
  return categoryId;
}

describe.skipIf(!INTEGRATION_ENABLED)("A1's IMDRF term selection", () => {
  beforeEach(start);

  it("accepts a valid Annex G leaf term for 3.1.1 (component)", async () => {
    const { officer, report } = await assigned();

    const res = await post(`/reports/${report.id}/assessment-1`, officer.cookie, baseAssessment());
    expect(res.statusCode).toBe(302);

    const payload = await payloadOf(report.id, 1);
    expect(payload.imdrf_release_id).toBe(imdrf.releaseId);
    expect(payload.imdrf_component_term_id).toBe(imdrf.term.component);
    // The display text is the repository's own, not anything the client posted.
    expect(payload.imdrf_component_code).toBe("G01");
  });

  it("refuses an Annex A term posted for 3.1.1, which needs Annex G", async () => {
    const { officer, report } = await assigned();
    const wrongAnnexTerm = await seedLeafTerm("A", "A02");

    const res = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      baseAssessment({ imdrf_component_term_id: wrongAnnexTerm }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("Annex G");
  });

  it("refuses a category term (one with children) as too shallow a choice", async () => {
    const { officer, report } = await assigned();
    const category = await seedCategoryTerm("G", "G02");

    const res = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      baseAssessment({ imdrf_component_term_id: category }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("category heading");
  });

  it("ignores a draft release, however new, and uses the latest published one", async () => {
    const { officer, report } = await assigned();
    // A higher year, but a draft — never eligible, whatever its year.
    await owner.db.execute(sql`
      INSERT INTO imdrf_releases (release_year, source_file_name, status)
      VALUES (9001, 'draft.json', 'draft'::imdrf_release_status)
    `);

    const res = await post(`/reports/${report.id}/assessment-1`, officer.cookie, baseAssessment());
    expect(res.statusCode).toBe(302);

    const payload = await payloadOf(report.id, 1);
    expect(payload.imdrf_release_id).toBe(imdrf.releaseId);
  });

  it("does not select an older published release over a newer one for a brand-new assessment", async () => {
    const { officer, report } = await assigned();
    const newer = await seedImdrfForF004(owner.db); // a higher release_year than `imdrf`'s

    const res = await post(`/reports/${report.id}/assessment-1`, officer.cookie, baseAssessment());
    expect(res.statusCode).toBe(422); // `imdrf`'s own term ids no longer belong to the latest release
    expect(res.body).toContain("does not exist in the selected IMDRF release");

    // Using the newer release's own terms succeeds, and that is the release recorded.
    const retried = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      baseAssessment(imdrfAssessmentFields(newer)),
    );
    expect(retried.statusCode).toBe(302);
    expect((await payloadOf(report.id, 1)).imdrf_release_id).toBe(newer.releaseId);
  });

  it("keeps an existing assessment on its original release even after a newer one is published", async () => {
    const { officer, report } = await assigned();

    const draft = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      baseAssessment({ intent: "save" }),
    );
    expect(draft.statusCode).toBe(302);
    expect((await payloadOf(report.id, 1)).imdrf_release_id).toBe(imdrf.releaseId);

    // A new, later release goes live after work on this report already started.
    await seedImdrfForF004(owner.db);

    const submitted = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      baseAssessment(),
    );
    expect(submitted.statusCode).toBe(302);
    // Still the release this report started on — never silently moved onto the new one.
    expect((await payloadOf(report.id, 1)).imdrf_release_id).toBe(imdrf.releaseId);
  });

  it("ignores a hand-edited imdrf_release_id — the assessor cannot choose or change it", async () => {
    const { officer, report } = await assigned();
    const other = await seedImdrfForF004(owner.db);

    const res = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      // A hand-crafted body naming a release id directly, with `imdrf`'s own (older) term ids.
      baseAssessment({ imdrf_release_id: other.releaseId }),
    );

    // Resolves to the latest published release (`other`), never the one named in the POST — so
    // `imdrf`'s own component term id, which belongs to the older release, no longer resolves.
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("does not exist in the selected IMDRF release");
  });

  it("refuses a term id that belongs to a different (draft) release", async () => {
    const { officer, report } = await assigned();
    const foreignRows = await owner.db.execute(sql`
      INSERT INTO imdrf_releases (release_year, source_file_name, status)
      VALUES (9101, 'other.json', 'draft'::imdrf_release_status)
      RETURNING id
    `);
    const foreignReleaseId = (foreignRows[0] as { id: string }).id;
    const foreignTerm = await owner.db.execute(sql`
      INSERT INTO imdrf_terms (release_id, annex, code, term, code_hierarchy, level, sort_order)
      VALUES (${foreignReleaseId}, 'G', 'G99', 'Foreign term', 'G99', 1, 0)
      RETURNING id
    `);

    const res = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      baseAssessment({
        imdrf_component_term_id: (foreignTerm[0] as { id: string }).id,
      }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("does not exist in the selected IMDRF release");
  });

  it("refuses a leaf term IMDRF marks Not selectable", async () => {
    const { officer, report } = await assigned();
    const rows = await owner.db.execute(sql`
      INSERT INTO imdrf_terms (release_id, annex, code, term, code_hierarchy, level, sort_order, status)
      VALUES (${imdrf.releaseId}, 'G', 'G03', 'Retired battery term', 'G03', 1, 3, 'Not selectable')
      RETURNING id
    `);
    const notSelectableId = (rows[0] as { id: string }).id;

    const res = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      baseAssessment({ imdrf_component_term_id: notSelectableId }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("category heading");
  });

  it("refuses free text with no term id behind it — a hand-edited payload cannot bypass the picker", async () => {
    const { officer, report } = await assigned();

    const res = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      baseAssessment({
        imdrf_component_term_id: "",
        imdrf_component_l1: "Made up on the spot",
        imdrf_component_code: "MADEUP",
      }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("free text is not accepted");
  });

  it("requires the required 3.3.1 investigation-type term even though the others are optional", async () => {
    const { officer, report } = await assigned();

    const res = await post(
      `/reports/${report.id}/assessment-1`,
      officer.cookie,
      baseAssessment({ imdrf_investigation_type_term_id: "" }),
    );

    expect(res.statusCode).toBe(422);
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("a secondary assessor's IMDRF Disagree replacement", () => {
  beforeEach(start);

  async function readyForSecondary() {
    const manager = await signedInAs("manager", "Grace Mollel");
    const { officer: first, report } = await assigned();

    const submitted = await post(
      `/reports/${report.id}/assessment-1`,
      first.cookie,
      baseAssessment(),
    );
    expect(submitted.statusCode).toBe(302);

    const second = await signedInAs("assessor", "Baraka Nyoni");
    const assign = await post(`/reports/${report.id}/assign-next-assessor`, manager.cookie, {
      assessor_id: second.id,
      comment: "Please take a second look.",
    });
    expect(assign.statusCode).toBe(302);

    return { report, second };
  }

  /** Every item Agreed with except the one under test, so only that item's own rule is exercised. */
  function agreeExcept(overrides: Record<string, string>): Record<string, string> {
    const keys = [
      "1.3",
      "1.11",
      "1.19",
      "2.5",
      "2.6",
      "2.7",
      "3.1.1",
      "3.1.2",
      "3.2.1",
      "3.2.2",
      "3.3.1",
      "3.3.2",
      "3.3.3",
      "4.1",
      "4.2",
      "4.3",
      "5",
      "6",
      "7.1_actions",
      "7.1_conclusion",
    ];
    const body: Record<string, string> = {
      intent: "submit",
      signing_password: PASSWORD,
      actions_2: "monitoring",
    };
    for (const key of keys) body[`a2_degree_${key}`] = "agree";
    return { ...body, ...overrides };
  }

  it("accepts a Disagree replacement from the same release and the right Annex", async () => {
    const { report, second } = await readyForSecondary();
    const replacement = await seedLeafTerm("B", "B02");

    const res = await post(
      `/reports/${report.id}/secondary-assessment`,
      second.cookie,
      agreeExcept({
        "a2_degree_3.3.1": "disagree",
        "a2_statement_3.3.1": "The investigation was independently repeated by the manufacturer.",
        "a2_imdrf_term_3.3.1": replacement,
      }),
    );

    expect(res.statusCode).toBe(302);

    const payload = await payloadOf(report.id, 2);
    const responses = (payload.responses ?? {}) as Record<string, { value?: { code?: string } }>;
    expect(responses["3.3.1"]?.value?.code).toBe("B02");
  });

  it("refuses a Disagree replacement of the wrong Annex", async () => {
    const { report, second } = await readyForSecondary();
    const wrongAnnex = await seedLeafTerm("A", "A03");

    const res = await post(
      `/reports/${report.id}/secondary-assessment`,
      second.cookie,
      agreeExcept({
        "a2_degree_3.3.1": "disagree",
        "a2_statement_3.3.1": "Reasoned but pointed at the wrong repository entry.",
        "a2_imdrf_term_3.3.1": wrongAnnex,
      }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("Annex B");
  });

  it("refuses a Disagree replacement posted as free text with no term id", async () => {
    const { report, second } = await readyForSecondary();

    const res = await post(
      `/reports/${report.id}/secondary-assessment`,
      second.cookie,
      agreeExcept({
        "a2_degree_3.3.1": "disagree",
        "a2_statement_3.3.1": "Typed by hand, bypassing the picker.",
        "a2_value_3.3.1_l1": "Hand-typed investigation type",
        "a2_value_3.3.1_code": "MADEUP",
      }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("free text is not accepted");
  });

  it("Agree keeps A1's own term untouched", async () => {
    const { report, second } = await readyForSecondary();

    const res = await post(
      `/reports/${report.id}/secondary-assessment`,
      second.cookie,
      agreeExcept({}),
    );
    expect(res.statusCode).toBe(302);

    const payload = await payloadOf(report.id, 2);
    const responses = (payload.responses ?? {}) as Record<string, { degree?: string }>;
    expect(responses["3.3.1"]?.degree).toBe("agree");
    // No replacement value is stored for Agree — A1's own row is what the final document reads.
    expect(responses["3.3.1"]).not.toHaveProperty("value");
  });

  it("Required clarification carries a statement and never a replacement value", async () => {
    const { report, second } = await readyForSecondary();

    const res = await post(
      `/reports/${report.id}/secondary-assessment`,
      second.cookie,
      agreeExcept({
        "a2_degree_3.3.1": "clarification",
        "a2_statement_3.3.1": "Confirm which manufacturer report this investigation refers to.",
      }),
    );
    expect(res.statusCode).toBe(302);

    const payload = await payloadOf(report.id, 2);
    const responses = (payload.responses ?? {}) as Record<
      string,
      { degree?: string; value?: unknown; statement?: string }
    >;
    expect(responses["3.3.1"]?.degree).toBe("clarification");
    expect(responses["3.3.1"]).not.toHaveProperty("value");
    expect(responses["3.3.1"]?.statement).toContain("Confirm which manufacturer report");
  });
});
