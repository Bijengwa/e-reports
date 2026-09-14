import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/auth/password.js";
import type { Config } from "../../src/config.js";
import type { DatabaseHandle } from "../../src/db/client.js";
import { buildServer } from "../../src/server.js";
import { singleAnnexA } from "../fixtures/imdrf-real-fragments.js";
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

/** Two real records copied from the official IMDRF Annex A single-annex export (see
 *  `../fixtures/imdrf-real-fragments.ts`): a top-level record and its real child. */
const A_ROOT = singleAnnexA[0]; // code "A01", codehierarchy "A01"
const A_CHILD = singleAnnexA[1]; // code "A0101", codehierarchy "A01|A0101"

/** The real bare top-level JSON array shape — never a `{releaseYear, annexes}` wrapper. */
function payloadOf(records: readonly unknown[]): string {
  return JSON.stringify(records);
}

async function validate(
  cookie: string,
  releaseYear: number,
  payload: string,
  extra: Record<string, string> = {},
) {
  return act("/imdrf/manage/validate", cookie, {
    release_year: String(releaseYear),
    payload,
    ...extra,
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

describe.skipIf(!INTEGRATION_ENABLED)(
  "importing an IMDRF release from a pasted JSON payload",
  () => {
    beforeEach(start);

    it("validates the real Annex A fragment (bare array) with correct counts and no errors", async () => {
      const admin = await signedInAs("administrator");
      const payload = payloadOf([A_ROOT, A_CHILD]);

      const res = await validate(admin.cookie, 2026, payload);

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("VALIDATION PASSED");
      expect(res.body).toContain("READY TO IMPORT");
      expect(res.body).toContain("Annex A");
      expect(res.body).toContain("<b>2</b>");
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

    it("blocks the old invented {releaseYear, annexes} wrapper shape as not a bare array", async () => {
      const admin = await signedInAs("administrator");
      const res = await validate(
        admin.cookie,
        2026,
        JSON.stringify({ releaseYear: 2026, annexes: { A: [A_ROOT, A_CHILD] } }),
      );

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("IMPORT BLOCKED");
      expect(tokenFrom(res.body)).toBeUndefined();
    });

    it("blocks a payload with duplicate codehierarchy values", async () => {
      const admin = await signedInAs("administrator");
      const payload = payloadOf([A_ROOT, { ...A_ROOT }]);

      const res = await validate(admin.cookie, 2026, payload);

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("IMPORT BLOCKED");
      expect(res.body).toContain("duplicate");
      expect(tokenFrom(res.body)).toBeUndefined();
    });

    it("blocks a payload with a missing parent reference, writing zero rows", async () => {
      const admin = await signedInAs("administrator");
      const payload = payloadOf([A_CHILD]); // A0101 with no A01 root present

      const res = await validate(admin.cookie, 2026, payload);

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("IMPORT BLOCKED");
      expect(tokenFrom(res.body)).toBeUndefined();
      expect(await termCount()).toBe(0);
      expect(await owner.db.execute(sql`SELECT id FROM imdrf_releases`)).toHaveLength(0);
    });

    it("blocks a payload containing a malformed (non-object) record", async () => {
      const admin = await signedInAs("administrator");
      const res = await validate(admin.cookie, 2026, payloadOf([A_ROOT, "not a record"]));

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("IMPORT BLOCKED");
      expect(tokenFrom(res.body)).toBeUndefined();
    });

    it("confirming a valid preview creates a draft release with correct level/parent/sortOrder", async () => {
      const admin = await signedInAs("administrator");
      const payload = payloadOf([A_ROOT, A_CHILD]);

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
      expect(terms[0]).toMatchObject({ code: "A01", level: 1, parent_term_id: null });
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
        tokenFrom((await validate(admin.cookie, 2026, payloadOf([A_ROOT]))).body) as string,
      );

      await confirmImport(
        admin.cookie,
        tokenFrom(
          (
            await validate(
              admin.cookie,
              2027,
              payloadOf([{ ...A_ROOT, code: "A02", codehierarchy: "A02" }]),
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
      expect(await termCount()).toBe(2);

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
        tokenFrom((await validate(admin.cookie, 2026, payloadOf([A_ROOT]))).body) as string,
      );

      await confirmImport(
        admin.cookie,
        tokenFrom(
          (
            await validate(
              admin.cookie,
              2026,
              payloadOf([{ ...A_ROOT, code: "A99", codehierarchy: "A99", term: "Replaced" }]),
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
        tokenFrom((await validate(admin.cookie, 2026, payloadOf([A_ROOT]))).body) as string,
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

    it("refuses to import over an already-published release, leaving its rows unchanged", async () => {
      const admin = await signedInAs("administrator");
      const confirm = await confirmImport(
        admin.cookie,
        tokenFrom((await validate(admin.cookie, 2026, payloadOf([A_ROOT]))).body) as string,
      );
      const releaseId = (confirm.headers.location as string).split("release=")[1];
      await act(`/imdrf/manage/${releaseId}/publish`, admin.cookie);

      const before = await owner.db.execute(sql`SELECT code FROM imdrf_terms`);

      const preview = await validate(
        admin.cookie,
        2026,
        payloadOf([{ ...A_ROOT, code: "A99", codehierarchy: "A99", term: "Should not land" }]),
      );
      const token = tokenFrom(preview.body) as string;
      const confirmAgain = await confirmImport(admin.cookie, token);

      expect(confirmAgain.statusCode).toBe(409);

      const after = await owner.db.execute(sql`SELECT code FROM imdrf_terms`);
      expect(after).toEqual(before);
    });

    it("refuses a manager and an assessor every admin action", async () => {
      const admin = await signedInAs("administrator");
      const payload = payloadOf([A_ROOT]);

      for (const role of ["manager", "assessor"] as const) {
        const { cookie } = await signedInAs(role);
        expect((await get("/imdrf/manage", cookie)).statusCode).toBe(403);
        expect((await get("/imdrf/manage/import", cookie)).statusCode).toBe(403);
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

    it("renders the library page full-width with a link to the dedicated import page, and no paste form", async () => {
      const admin = await signedInAs("administrator");
      const page = await get("/imdrf/manage", admin.cookie);
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain(">Manage IMDRF<");
      expect(page.body).toContain("staff-head");
      expect(page.body).toContain("/imdrf/manage/import");
      expect(page.body).not.toContain('name="payload"');
      expect(page.body).not.toContain('style="');
    });

    it("renders the dedicated import page with a paste-only textarea and IMDRF-default document code/title", async () => {
      const admin = await signedInAs("administrator");
      const page = await get("/imdrf/manage/import", admin.cookie);
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain(">Import IMDRF release<");
      expect(page.body).toContain('name="payload"');
      expect(page.body).toContain("data-paste-only");
      expect(page.body).toContain("IMDRF/AE WG/N43");
      expect(page.body).toContain("IMDRF Adverse Event Terminology");
      expect(page.body).not.toContain('style="');
      expect(page.body).not.toContain('"releaseYear"'); // no fake wrapper example left in the UI
    });

    it("groups preview errors per annex rather than a generic (workbook) row", async () => {
      const admin = await signedInAs("administrator");
      const res = await validate(admin.cookie, 2026, payloadOf([A_CHILD])); // missing parent
      expect(res.body).not.toContain("(workbook)");
      expect(res.body).toContain("Annex A");
    });
  },
);
