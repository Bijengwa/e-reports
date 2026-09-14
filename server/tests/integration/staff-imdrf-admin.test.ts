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

const STAFF_HOST = "staff.test";
const PUBLIC_HOST = "public.test";
const PASSWORD = "a correct staff password";
const COOKIE = "__Host-ae_session";

type Role = "administrator" | "manager" | "assessor";

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

async function seed(role: Role, name = "Grace Mollel"): Promise<{ id: string; email: string }> {
  seeded += 1;
  const email = `imdrf-admin${seeded}@tmda.go.tz`;

  const rows = await owner.db.execute(sql`
    INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
    VALUES (${email}, ${name}, ${role}::user_role, ${await hashPassword(PASSWORD)}, false, true)
    RETURNING id
  `);

  return { id: (rows[0] as { id: string }).id, email };
}

async function cookieFor(email: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/login",
    headers: { host: STAFF_HOST, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ email, password: PASSWORD }).toString(),
  });

  return `${COOKIE}=${res.cookies.find((c) => c.name === COOKIE)?.value}`;
}

async function signedInAs(
  role: Role,
  name?: string,
): Promise<{ id: string; email: string; cookie: string }> {
  const user = await seed(role, name);
  return { ...user, cookie: await cookieFor(user.email) };
}

function get(url: string, cookie: string) {
  return app.inject({ url, headers: { host: STAFF_HOST, cookie } });
}

function act(url: string, cookie: string, body: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url,
    headers: { host: STAFF_HOST, cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(body).toString(),
  });
}

const ALL_ANNEXES = ["A", "B", "C", "D", "E", "F", "G"] as const;

type TermRecord = { code: string; term: string; hierarchy: string; status?: string };

/**
 * A minimal but structurally real IMDRF JSON payload: `releaseYear`, and `annexes` keyed A-G.
 *
 * Every annex not explicitly given gets one trivial padding record — validation requires all
 * seven to be present with at least one term each, and a test about (say) Annex A's hierarchy
 * logic should not also have to think about the other six.
 */
function payloadOf(
  releaseYear: number,
  annexTerms: Partial<Record<(typeof ALL_ANNEXES)[number], TermRecord[]>>,
): string {
  const complete: typeof annexTerms = { ...annexTerms };
  for (const annex of ALL_ANNEXES) {
    if (!complete[annex]) {
      complete[annex] = [{ code: `${annex}99`, term: `Padding ${annex}`, hierarchy: `${annex}99` }];
    }
  }

  const annexes: Record<string, unknown[]> = {};
  for (const [annex, terms] of Object.entries(complete)) {
    annexes[annex] = (terms ?? []).map((t) => ({
      term: t.term,
      code: t.code,
      definition: "def",
      codeHierarchy: t.hierarchy,
      status: t.status ?? null,
    }));
  }

  return JSON.stringify({
    releaseYear,
    documentCode: "IMDRF/AE WG/N43",
    title: "IMDRF Adverse Event Terminology",
    annexes,
  });
}

async function validate(cookie: string, releaseYear: number, payload: string) {
  return act("/imdrf/manage/validate", cookie, {
    release_year: String(releaseYear),
    payload,
  });
}

function tokenFrom(body: string): string | undefined {
  return body.match(/name="token" value="([^"]+)"/)?.[1];
}

async function confirmImport(cookie: string, token: string) {
  return act("/imdrf/manage/import", cookie, { token });
}

async function termCount(): Promise<number> {
  const rows = await owner.db.execute(sql`SELECT count(*) FROM imdrf_terms`);
  return Number((rows[0] as { count: string }).count);
}

const A_ROOT = { code: "A01", term: "Root Problem", hierarchy: "A01" };
const A_CHILD = { code: "A0101", term: "Child Problem", hierarchy: "A01|A0101" };

describe.skipIf(!INTEGRATION_ENABLED)(
  "importing an IMDRF release from a pasted JSON payload",
  () => {
    beforeEach(start);

    it("validates a well-formed payload with correct per-annex counts and no errors", async () => {
      const admin = await signedInAs("administrator");
      const payload = payloadOf(2026, { A: [A_ROOT, A_CHILD] });

      const res = await validate(admin.cookie, 2026, payload);

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("VALIDATION PASSED");
      expect(res.body).toContain("READY TO IMPORT");
      expect(res.body).toContain(">A<");
      // 2 from Annex A (A_ROOT, A_CHILD) + 1 padding row each for the other six annexes.
      expect(res.body).toContain("<b>8</b>");
      expect(tokenFrom(res.body)).toBeTruthy();
    });

    it("blocks invalid JSON syntax without writing anything", async () => {
      const admin = await signedInAs("administrator");
      const res = await validate(admin.cookie, 2026, "{ this is not json");

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("IMPORT BLOCKED");
      expect(tokenFrom(res.body)).toBeUndefined();
      expect(await termCount()).toBe(0);
    });

    it("blocks a payload with duplicate CodeHierarchy values", async () => {
      const admin = await signedInAs("administrator");
      const payload = payloadOf(2026, {
        A: [A_ROOT, { code: "A01", term: "Duplicate", hierarchy: "A01" }],
      });

      const res = await validate(admin.cookie, 2026, payload);

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("IMPORT BLOCKED");
      expect(res.body).toContain("duplicate");
      expect(tokenFrom(res.body)).toBeUndefined();
    });

    it("blocks a payload with a missing/invalid parent reference, writing zero rows", async () => {
      const admin = await signedInAs("administrator");
      const payload = payloadOf(2026, { A: [A_CHILD] }); // A0101 with no A01 root present

      const res = await validate(admin.cookie, 2026, payload);

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("IMPORT BLOCKED");
      expect(tokenFrom(res.body)).toBeUndefined();
      expect(await termCount()).toBe(0);
      expect(await owner.db.execute(sql`SELECT id FROM imdrf_releases`)).toHaveLength(0);
    });

    it("blocks a payload containing a malformed (non-object) record", async () => {
      const admin = await signedInAs("administrator");
      const raw = payloadOf(2026, { A: [A_ROOT] });
      const parsed = JSON.parse(raw);
      parsed.annexes.A.push("not a record");

      const res = await validate(admin.cookie, 2026, JSON.stringify(parsed));

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("IMPORT BLOCKED");
      expect(tokenFrom(res.body)).toBeUndefined();
    });

    it("confirming a valid preview creates a draft release with correct level/parent/sortOrder", async () => {
      const admin = await signedInAs("administrator");
      const payload = payloadOf(2026, { A: [A_ROOT, A_CHILD] });

      const preview = await validate(admin.cookie, 2026, payload);
      const token = tokenFrom(preview.body) as string;
      const confirm = await confirmImport(admin.cookie, token);

      expect(confirm.statusCode).toBe(303);
      expect(confirm.headers.location).toMatch(/^\/imdrf\/manage\?release=/);

      const release = await owner.db.execute(
        sql`SELECT status FROM imdrf_releases WHERE release_year = 2026`,
      );
      expect(release[0]).toMatchObject({ status: "draft" });

      const terms = await owner.db.execute(sql`
      SELECT code, level, parent_term_id, sort_order FROM imdrf_terms
       WHERE annex = 'A' ORDER BY sort_order
    `);
      expect(terms).toHaveLength(2);
      expect(terms[0]).toMatchObject({
        code: "A01",
        level: 1,
        parent_term_id: null,
        sort_order: 0,
      });
      const child = terms[1] as { code: string; level: number; parent_term_id: string | null };
      expect(child.code).toBe("A0101");
      expect(child.level).toBe(2);
      const rootId = await owner.db.execute(sql`SELECT id FROM imdrf_terms WHERE code = 'A01'`);
      expect(child.parent_term_id).toBe((rootId[0] as { id: string }).id);
    });

    it("lets two release years coexist without touching each other's terms", async () => {
      const admin = await signedInAs("administrator");

      await confirmImport(
        admin.cookie,
        tokenFrom(
          (await validate(admin.cookie, 2026, payloadOf(2026, { A: [A_ROOT] }))).body,
        ) as string,
      );

      await confirmImport(
        admin.cookie,
        tokenFrom(
          (
            await validate(
              admin.cookie,
              2027,
              payloadOf(2027, { A: [{ code: "A02", term: "Other", hierarchy: "A02" }] }),
            )
          ).body,
        ) as string,
      );

      const releases = await owner.db.execute(
        sql`SELECT release_year FROM imdrf_releases ORDER BY release_year`,
      );
      expect(releases.map((r) => (r as { release_year: number }).release_year)).toEqual([
        2026, 2027,
      ]);
      // Each release: 1 term for the annex under test (A) + 1 padding row each for the other six.
      expect(await termCount()).toBe(14);

      const y2026 = await owner.db.execute(sql`
      SELECT count(*) FROM imdrf_terms t JOIN imdrf_releases r ON r.id = t.release_id
       WHERE r.release_year = 2026 AND t.annex = 'A'
    `);
      expect(Number((y2026[0] as { count: string }).count)).toBe(1);
    });

    it("re-importing a still-draft release replaces its terms rather than duplicating the release row", async () => {
      const admin = await signedInAs("administrator");

      await confirmImport(
        admin.cookie,
        tokenFrom(
          (await validate(admin.cookie, 2026, payloadOf(2026, { A: [A_ROOT] }))).body,
        ) as string,
      );

      await confirmImport(
        admin.cookie,
        tokenFrom(
          (
            await validate(
              admin.cookie,
              2026,
              payloadOf(2026, { A: [{ code: "A99", term: "Replaced", hierarchy: "A99" }] }),
            )
          ).body,
        ) as string,
      );

      const releases = await owner.db.execute(
        sql`SELECT id FROM imdrf_releases WHERE release_year = 2026`,
      );
      expect(releases).toHaveLength(1);

      const codes = await owner.db.execute(sql`SELECT code FROM imdrf_terms WHERE annex = 'A'`);
      expect(codes.map((r) => (r as { code: string }).code)).toEqual(["A99"]);
    });

    it("publishing sets status/published_at, and refuses a second publish", async () => {
      const admin = await signedInAs("administrator");
      const confirm = await confirmImport(
        admin.cookie,
        tokenFrom(
          (await validate(admin.cookie, 2026, payloadOf(2026, { A: [A_ROOT] }))).body,
        ) as string,
      );
      const releaseId = (confirm.headers.location as string).split("release=")[1];

      const publish = await act(`/imdrf/manage/${releaseId}/publish`, admin.cookie);
      expect(publish.statusCode).toBe(303);

      const row = await owner.db.execute(
        sql`SELECT status, published_at FROM imdrf_releases WHERE id = ${releaseId}`,
      );
      expect(row[0]).toMatchObject({ status: "published" });
      expect((row[0] as { published_at: Date | null }).published_at).not.toBeNull();

      const again = await act(`/imdrf/manage/${releaseId}/publish`, admin.cookie);
      expect(again.statusCode).toBe(409);
    });

    it("importing a new draft release does not automatically publish it or replace the currently live release", async () => {
      const admin = await signedInAs("administrator");
      const firstConfirm = await confirmImport(
        admin.cookie,
        tokenFrom(
          (await validate(admin.cookie, 2026, payloadOf(2026, { A: [A_ROOT] }))).body,
        ) as string,
      );
      const firstId = (firstConfirm.headers.location as string).split("release=")[1];
      await act(`/imdrf/manage/${firstId}/publish`, admin.cookie);

      const secondConfirm = await confirmImport(
        admin.cookie,
        tokenFrom(
          (
            await validate(
              admin.cookie,
              2027,
              payloadOf(2027, { A: [{ code: "A02", term: "Other", hierarchy: "A02" }] }),
            )
          ).body,
        ) as string,
      );
      const secondId = (secondConfirm.headers.location as string).split("release=")[1];

      const rows = await owner.db.execute(
        sql`SELECT id, status FROM imdrf_releases WHERE id IN (${firstId}, ${secondId})`,
      );
      const byId = new Map(
        rows.map((r) => [(r as { id: string }).id, (r as { status: string }).status]),
      );
      expect(byId.get(firstId)).toBe("published");
      expect(byId.get(secondId)).toBe("draft");
    });

    it("refuses to import over an already-published release, leaving its rows unchanged", async () => {
      const admin = await signedInAs("administrator");
      const confirm = await confirmImport(
        admin.cookie,
        tokenFrom(
          (await validate(admin.cookie, 2026, payloadOf(2026, { A: [A_ROOT] }))).body,
        ) as string,
      );
      const releaseId = (confirm.headers.location as string).split("release=")[1];
      await act(`/imdrf/manage/${releaseId}/publish`, admin.cookie);

      const before = await owner.db.execute(sql`SELECT code FROM imdrf_terms`);

      const preview = await validate(
        admin.cookie,
        2026,
        payloadOf(2026, { A: [{ code: "A99", term: "Should not land", hierarchy: "A99" }] }),
      );
      const token = tokenFrom(preview.body) as string;
      const confirmAgain = await confirmImport(admin.cookie, token);

      expect(confirmAgain.statusCode).toBe(409);

      const after = await owner.db.execute(sql`SELECT code FROM imdrf_terms`);
      expect(after).toEqual(before);
    });

    it("refuses a manager and an assessor every admin action", async () => {
      const admin = await signedInAs("administrator");
      const payload = payloadOf(2026, { A: [A_ROOT] });

      for (const role of ["manager", "assessor"] as const) {
        const { cookie } = await signedInAs(role);
        expect((await get("/imdrf/manage", cookie)).statusCode).toBe(403);
        expect((await validate(cookie, 2026, payload)).statusCode).toBe(403);
        expect((await act("/imdrf/manage/import", cookie, { token: "anything" })).statusCode).toBe(
          403,
        );
      }

      expect(await termCount()).toBe(0);
      expect((await get("/imdrf/manage", admin.cookie)).statusCode).toBe(200);
    });

    it("rejects an unsigned-in request with a redirect rather than a 200", async () => {
      const res = await get("/imdrf/manage", "");
      expect(res.statusCode).toBe(302);
    });

    it("renders the manage page with the same title bar as every other staff page, and no inline styles", async () => {
      const admin = await signedInAs("administrator");
      const page = await get("/imdrf/manage", admin.cookie);
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain(">Manage IMDRF<");
      expect(page.body).toContain("staff-head");
      expect(page.body).toContain("imdrf-admin");
      expect(page.body).not.toContain('style="');
    });
  },
);
