import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/auth/password.js";
import type { Config } from "../../src/config.js";
import type { DatabaseHandle } from "../../src/db/client.js";
import { buildServer } from "../../src/server.js";
import { consolidatedAnnexB, consolidatedAnnexG } from "../fixtures/imdrf-real-fragments.js";
import { INTEGRATION_ENABLED, openOwner, requireTestDatabase, truncateAll } from "./helpers.js";

/**
 * Gate 2 — F004 always resolves the latest published IMDRF release.
 *
 * The rule (`domain/imdrf/f004-integration.ts`'s `resolveAssessmentRelease`): F004 codes against
 * the newest published release, full stop. A report or A1 having started life while an older
 * release was current is not a reason to keep using it — the moment a newer release publishes,
 * every unsubmitted F004 (a fresh workflow or a draft already in progress) moves onto it. The one
 * exception is a *submitted* assessment: once signed, it is a historical record of the release it
 * actually used at that moment, and that is never silently relabelled later — not "selected" again,
 * just reported as what already happened. Older releases stay in the repository as reference data;
 * they are never a fallback, never chosen because a report or its A1 is old, and never reachable by
 * a client naming one directly.
 *
 * This file drives the *real* admin paste → validate → confirm → publish lifecycle for two
 * releases, starts a workflow while the older one is current, publishes the newer one mid-flight,
 * and proves — by direct database query — that the still-open workflow moves onto the newer release
 * rather than sticking to the one it began under, that a brand-new workflow started after the newer
 * release is current never touches the old one, and that a client cannot force the older release
 * back in through the request body.
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
  const email = `gate2-imdrf-${seeded}@tmda.go.tz`;
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
      report_type: "adverse_event",
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
      location: "Dar es Salaam",
      phone: "+255 700 000 000",
      report_date: "2026-08-02",
      device_location: "Sealed in the biomedical workshop",
    }).toString(),
  });
}

/* ───────────────────── Real IMDRF admin import lifecycle (paste → validate → confirm → publish) ─────────────────── */

/**
 * Only two of the seven F004 IMDRF items are ever mandatory to resolve a release for: "investigation
 * type" (3.3.1, Annex B) is the one IMDRF item `f004.ts`'s `IMDRF_GROUPS` does not mark `optional`,
 * and "component" (3.1.1, Annex G) is included alongside it to prove the release/term binding on a
 * second, independent annex too. Both come from `consolidatedAnnexB`/`consolidatedAnnexG` — real
 * IMDRF content, copied verbatim, in the consolidated shape (each carries its own annex-root
 * record), which is what lets the two annexes coexist in one paste without `parser.ts`'s
 * single-annex "must not mix annexes" rule rejecting it.
 */
const LEAF_CODE_BY_KEY: Record<string, string> = {
  investigation_type: "B01", // Annex B — the one IMDRF item F004 always requires
  component: "G01001", // Annex G — a second, independent annex for the same proof
};

/** Real IMDRF content (Annexes B and G, consolidated shape) combined into one paste — exactly what
 *  an administrator would paste to stand up a release covering every IMDRF item this test needs. */
function combinedRealPayload(): string {
  return JSON.stringify([...consolidatedAnnexB, ...consolidatedAnnexG]);
}

function tokenFrom(body: string): string {
  const token = body.match(/name="token" value="([^"]+)"/)?.[1];
  if (token === undefined) throw new Error(`no import token found in preview page: ${body}`);
  return token;
}

/**
 * Runs the real admin lifecycle end to end: paste → `/imdrf/manage/validate` → confirm at
 * `/imdrf/manage/import` (creates the release as `draft`) → `/imdrf/manage/:id/publish`. No row in
 * `imdrf_releases` or `imdrf_terms` is ever written directly by this file — every one of them is
 * the side effect of a real HTTP call through the same routes an administrator uses.
 */
async function importAndPublishRelease(adminCookie: string, releaseYear: number): Promise<string> {
  const preview = await post("/imdrf/manage/validate", adminCookie, {
    release_year: String(releaseYear),
    payload: combinedRealPayload(),
  });
  expect(preview.statusCode).toBe(200);

  const confirm = await post("/imdrf/manage/import", adminCookie, {
    token: tokenFrom(preview.body),
  });
  expect(confirm.statusCode).toBe(303);
  const releaseId = (confirm.headers.location as string).split("release=")[1];
  if (releaseId === undefined) throw new Error("no release id in import redirect");

  const publish = await post(`/imdrf/manage/${releaseId}/publish`, adminCookie, {});
  expect(publish.statusCode).toBe(303);

  const row = await owner.db.execute(sql`
    SELECT status::text AS status, published_at FROM imdrf_releases WHERE id = ${releaseId}
  `);
  expect(row[0]).toMatchObject({ status: "published" });
  expect((row[0] as { published_at: Date | null }).published_at).not.toBeNull();

  return releaseId;
}

/** This release's own term id for each F004 item, read back from the database it was just
 *  imported into — never assumed, since a fresh import gets fresh UUIDs every time. */
async function leafTermIds(releaseId: string): Promise<Record<string, string>> {
  const rows = await owner.db.execute(sql`
    SELECT id, code FROM imdrf_terms WHERE release_id = ${releaseId}
  `);
  const byCode = new Map((rows as { id: string; code: string }[]).map((r) => [r.code, r.id]));
  const out: Record<string, string> = {};
  for (const [key, code] of Object.entries(LEAF_CODE_BY_KEY)) {
    const id = byCode.get(code);
    if (id === undefined) throw new Error(`release ${releaseId} is missing leaf term ${code}`);
    out[key] = id;
  }
  return out;
}

function imdrfTermFields(terms: Record<string, string>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of Object.keys(LEAF_CODE_BY_KEY))
    fields[`imdrf_${key}_term_id`] = terms[key] ?? "";
  return fields;
}

/* ───────────────────────────────────── Assessment payload builders ───────────────────────────────────── */

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
    ...over,
  };
}

const SECONDARY_DEGREE_KEYS = [
  "1.3",
  "1.10",
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

/** Every reviewable item Agreed with, except whatever `overrides` replaces. */
function agreeAllSecondary(overrides: Record<string, string> = {}): Record<string, string> {
  const body: Record<string, string> = {
    intent: "submit",
    signing_password: PASSWORD,
    actions_2: "monitoring",
  };
  for (const key of SECONDARY_DEGREE_KEYS) body[`a2_degree_${key}`] = "agree";
  return { ...body, ...overrides };
}

/* ───────────────────────────────────── Database evidence readers ───────────────────────────────────── */

async function reportsOrderedByFiling(): Promise<{ id: string; number: string }[]> {
  const rows = await owner.db.execute(sql`
    SELECT id, number FROM reports ORDER BY received_at ASC, number ASC
  `);
  return rows as { id: string; number: string }[];
}

async function assignAssessor1(reportId: string, officerId: string): Promise<void> {
  await owner.db.execute(sql`
    UPDATE reports SET assessor1_user_id = ${officerId}, assessor1_assigned_at = now()
     WHERE id = ${reportId}
  `);
}

type AssessmentPayload = Record<string, unknown>;

async function assessmentPayload(reportId: string, ordinal: number): Promise<AssessmentPayload> {
  const rows = await owner.db.execute(sql`
    SELECT payload FROM assessments WHERE report_id = ${reportId} AND ordinal = ${ordinal}
  `);
  return (rows[0] as { payload: AssessmentPayload } | undefined)?.payload ?? {};
}

async function finalDocumentPayload(reportId: string): Promise<AssessmentPayload | null> {
  const rows = await owner.db.execute(sql`
    SELECT payload FROM report_final_documents WHERE report_id = ${reportId}
  `);
  return (
    (rows[0] as { payload: { answers: AssessmentPayload } } | undefined)?.payload.answers ?? null
  );
}

describe.skipIf(!INTEGRATION_ENABLED)(
  "Gate 2 — F004 always resolves the latest published IMDRF release",
  () => {
    beforeEach(start);

    it("moves an in-progress workflow onto a newly published release, sends a brand-new workflow straight to it, refuses a client override, and leaves the older release intact as reference data", async () => {
      const admin = await signedInAs("administrator");
      const manager = await signedInAs("manager", "Grace Mollel");

      // ───────────── STEP 1 — Release X: the only, and therefore latest, published release ─────────────
      const releaseX = await importAndPublishRelease(admin.cookie, 2024);
      const termsX = await leafTermIds(releaseX);

      // ───────────── STEP 2/3 — a real F004 workflow starts while X is current ─────────────
      const firstOfficer1 = await signedInAs("assessor", "Asha Mrema");
      await fileAtThePublicDoor("Philips IntelliVue MX450 (first workflow)");
      const [firstReport] = await reportsOrderedByFiling();
      if (firstReport === undefined) throw new Error("first report was not filed");
      await assignAssessor1(firstReport.id, firstOfficer1.id);

      const draftUnderX = await post(
        `/reports/${firstReport.id}/assessment-1`,
        firstOfficer1.cookie,
        baseAssessment({ intent: "save", ...imdrfTermFields(termsX) }),
      );
      expect(draftUnderX.statusCode).toBe(302);
      const draftPayload = await assessmentPayload(firstReport.id, 1);
      expect(draftPayload.imdrf_release_id).toBe(releaseX); // correct: X *is* the latest right now
      expect(draftPayload.imdrf_component_code).toBe("G01001");

      // ───────────── STEP 4 — publish Y through the real admin lifecycle, mid-flight ─────────────
      const releaseY = await importAndPublishRelease(admin.cookie, 2025);
      const termsY = await leafTermIds(releaseY);
      expect(releaseY).not.toBe(releaseX);

      // ───────────── STEP 9 — normal F004 no longer exposes/selects X, even for work already open ─────────────
      // The still-unsubmitted draft's own (older) terms no longer resolve — F004 re-resolves the
      // *current* latest release on every save while nothing is submitted, it does not keep using
      // whatever was current when the draft began.
      const staleResubmit = await post(
        `/reports/${firstReport.id}/assessment-1`,
        firstOfficer1.cookie,
        baseAssessment(imdrfTermFields(termsX)),
      );
      expect(staleResubmit.statusCode).toBe(422);
      expect(staleResubmit.body).toContain("does not exist in the selected IMDRF release");

      // A plain draft save (nothing IMDRF-related touched) proves the same thing without relying on
      // a validation error: the payload's own release id moves onto Y by itself.
      const draftAfterY = await post(
        `/reports/${firstReport.id}/assessment-1`,
        firstOfficer1.cookie,
        baseAssessment({ intent: "save" }),
      );
      expect(draftAfterY.statusCode).toBe(302);
      expect((await assessmentPayload(firstReport.id, 1)).imdrf_release_id).toBe(releaseY);

      // The workflow finishes using Y's own terms — its final, submitted release is Y, the release
      // that was actually current the moment it was signed, regardless of having started under X.
      const firstSubmit = await post(
        `/reports/${firstReport.id}/assessment-1`,
        firstOfficer1.cookie,
        baseAssessment(imdrfTermFields(termsY)),
      );
      expect(firstSubmit.statusCode).toBe(302);
      const firstA1 = await assessmentPayload(firstReport.id, 1);
      expect(firstA1.imdrf_release_id).toBe(releaseY);
      expect(firstA1.imdrf_component_code).toBe("G01001");

      // Once submitted, A1 is a historical record: it cannot be resaved, so its own release is never
      // re-evaluated again — this is reporting a historical fact, not "selecting" anything.
      const resaveAfterSubmit = await post(
        `/reports/${firstReport.id}/assessment-1`,
        firstOfficer1.cookie,
        baseAssessment(),
      );
      expect(resaveAfterSubmit.statusCode).toBe(403);
      expect((await assessmentPayload(firstReport.id, 1)).imdrf_release_id).toBe(releaseY);

      const firstOfficer2 = await signedInAs("assessor", "Baraka Nyoni");
      const firstAssign2 = await post(
        `/reports/${firstReport.id}/assign-next-assessor`,
        manager.cookie,
        { assessor_id: firstOfficer2.id, comment: "Please take a second look." },
      );
      expect(firstAssign2.statusCode).toBe(302);

      // A2 follows A1's own (now Y) release — never independently, never onto X.
      const firstA2Reject = await post(
        `/reports/${firstReport.id}/secondary-assessment`,
        firstOfficer2.cookie,
        agreeAllSecondary({
          "a2_degree_3.1.1": "disagree",
          "a2_statement_3.1.1": "Attempting to replace with a term from a release A1 never used.",
          "a2_imdrf_term_3.1.1": termsX.investigation_type ?? "",
        }),
      );
      expect(firstA2Reject.statusCode).toBe(422);
      expect(firstA2Reject.body).toContain("does not exist in the selected IMDRF release");

      const firstA2Submit = await post(
        `/reports/${firstReport.id}/secondary-assessment`,
        firstOfficer2.cookie,
        agreeAllSecondary(),
      );
      expect(firstA2Submit.statusCode).toBe(302);

      // Final document / provenance: the release actually used (Y), never the one the workflow
      // happened to begin under (X).
      const firstWorker = await signedInAs("assessor", "Eliza Komba");
      const firstApprove = await post(
        `/reports/${firstReport.id}/assign-work-officer`,
        manager.cookie,
        { officer_id: firstWorker.id },
      );
      expect(firstApprove.statusCode).toBe(302);
      const firstFinal = await finalDocumentPayload(firstReport.id);
      if (firstFinal === null) throw new Error("first report has no final document");
      expect(firstFinal.imdrf_release_id).toBe(releaseY);
      expect(firstFinal.imdrf_component_code).toBe("G01001");

      // ───────────── STEP 5/6 — a brand-new workflow, started only after Y is already current ─────────────
      const newOfficer1 = await signedInAs("assessor", "Chausiku Njau");
      await fileAtThePublicDoor("Philips IntelliVue MX450 (new workflow)");
      const filedAfterY = await reportsOrderedByFiling();
      const newReport = filedAfterY[filedAfterY.length - 1];
      if (newReport === undefined || newReport.id === firstReport.id) {
        throw new Error("new report was not filed");
      }
      await assignAssessor1(newReport.id, newOfficer1.id);

      // ───────────── STEP 7 — override attack: hand-craft a POST naming X while Y is latest ─────────────
      // This is the very first save for this report's A1 — the case a broken implementation would be
      // most tempted to trust a client-supplied release. `resolveAssessmentRelease` must ignore both
      // the posted `imdrf_release_id` and the posted term ids' implied release, and resolve the
      // current latest published release (Y) regardless — which makes X's own term id foreign and
      // unresolvable, and the submission must be refused.
      const overrideAttempt = await post(
        `/reports/${newReport.id}/assessment-1`,
        newOfficer1.cookie,
        baseAssessment({ ...imdrfTermFields(termsX), imdrf_release_id: releaseX }),
      );
      expect(overrideAttempt.statusCode).toBe(422);
      expect(overrideAttempt.body).toContain("does not exist in the selected IMDRF release");
      // Nothing was persisted by the rejected attempt — no assessments row exists yet at all.
      expect(await assessmentPayload(newReport.id, 1)).toEqual({});

      const newA1Submit = await post(
        `/reports/${newReport.id}/assessment-1`,
        newOfficer1.cookie,
        baseAssessment(imdrfTermFields(termsY)),
      );
      expect(newA1Submit.statusCode).toBe(302);
      const newA1 = await assessmentPayload(newReport.id, 1);
      expect(newA1.imdrf_release_id).toBe(releaseY);
      expect(newA1.imdrf_component_code).toBe("G01001");

      const newOfficer2 = await signedInAs("assessor", "Daudi Kimaro");
      const newAssign2 = await post(
        `/reports/${newReport.id}/assign-next-assessor`,
        manager.cookie,
        {
          assessor_id: newOfficer2.id,
          comment: "Please take a second look.",
        },
      );
      expect(newAssign2.statusCode).toBe(302);
      const newA2Submit = await post(
        `/reports/${newReport.id}/secondary-assessment`,
        newOfficer2.cookie,
        agreeAllSecondary(),
      );
      expect(newA2Submit.statusCode).toBe(302);

      // ───────────── STEP 8 — X still exists, untouched, as reference/research data ─────────────
      const xRow = await owner.db.execute(sql`
      SELECT status::text AS status FROM imdrf_releases WHERE id = ${releaseX}
    `);
      expect(xRow[0]).toMatchObject({ status: "published" });
      const xTermsStill = await owner.db.execute(sql`
      SELECT count(*)::int AS count FROM imdrf_terms WHERE release_id = ${releaseX}
    `);
      expect((xTermsStill[0] as { count: number }).count).toBeGreaterThan(0);

      // ───────────── The invariant, restated as one direct comparison ─────────────
      expect(releaseX).not.toBe(releaseY);
      expect(firstFinal.imdrf_release_id).toBe(releaseY); // finished under the newest release, not the one it began under
      expect(newA1.imdrf_release_id).toBe(releaseY); // a fresh workflow goes straight to it
    });
  },
);
