import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";
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

/**
 * A minimal but structurally real IMDRF workbook: one sheet per annex given, header row detected
 * by content (not a fixed row number), three "Level N Term" columns so any of levels 1-3 works.
 */
async function workbookBuffer(
  releaseYear: number,
  annexTerms: Partial<
    Record<
      "A" | "B" | "C" | "D" | "E" | "F" | "G",
      Array<{ code: string; term: string; hierarchy: string }>
    >
  >,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [annex, terms] of Object.entries(annexTerms)) {
    const ws = wb.addWorksheet(annex);
    ws.addRow([`Annex Name: Annex ${annex}`]);
    ws.addRow([`Release Number: ${releaseYear}`]);
    for (let i = 0; i < 5; i++) ws.addRow([]);
    ws.addRow([
      "Level 1 Term",
      "Level 2 Term",
      "Level 3 Term",
      "Code",
      "Definition",
      "Non-IMDRF Code",
      "Status",
      "Status Description",
      "CodeHierarchy",
    ]);
    for (const t of terms ?? []) {
      const level = t.hierarchy.split("|").length;
      const row: (string | null)[] = [
        null,
        null,
        null,
        t.code,
        "def",
        null,
        null,
        null,
        t.hierarchy,
      ];
      row[level - 1] = t.term;
      ws.addRow(row);
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function multipartBody(
  fields: Record<string, string>,
  fileField: string,
  fileName: string,
  fileBuffer: Buffer,
): { body: Buffer; contentType: string } {
  const boundary = `----testBoundary${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
    ),
  );
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function upload(cookie: string, releaseYear: number, fileBuffer: Buffer) {
  const { body, contentType } = multipartBody(
    { release_year: String(releaseYear) },
    "workbook",
    "imdrf.xlsx",
    fileBuffer,
  );
  return app.inject({
    method: "POST",
    url: "/imdrf/manage/upload",
    headers: { host: STAFF_HOST, cookie, "content-type": contentType },
    payload: body,
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

describe.skipIf(!INTEGRATION_ENABLED)("importing an IMDRF release", () => {
  beforeEach(start);

  it("previews a valid workbook with correct per-annex counts and no errors", async () => {
    const admin = await signedInAs("administrator");
    const wb = await workbookBuffer(2026, { A: [A_ROOT, A_CHILD] });

    const res = await upload(admin.cookie, 2026, wb);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(">A<");
    expect(res.body).toContain("<b>2</b>");
    expect(tokenFrom(res.body)).toBeTruthy();
  });

  it("confirming the preview creates a draft release with correct level/parent/sortOrder", async () => {
    const admin = await signedInAs("administrator");
    const wb = await workbookBuffer(2026, { A: [A_ROOT, A_CHILD] });

    const preview = await upload(admin.cookie, 2026, wb);
    const token = tokenFrom(preview.body) as string;
    const confirm = await confirmImport(admin.cookie, token);

    expect(confirm.statusCode).toBe(303);
    expect(confirm.headers.location).toMatch(/^\/imdrf\/manage\?release=/);

    const release = await owner.db.execute(
      sql`SELECT status FROM imdrf_releases WHERE release_year = 2026`,
    );
    expect(release[0]).toMatchObject({ status: "draft" });

    const terms = await owner.db.execute(sql`
      SELECT code, level, parent_term_id, sort_order FROM imdrf_terms ORDER BY sort_order
    `);
    expect(terms).toHaveLength(2);
    expect(terms[0]).toMatchObject({ code: "A01", level: 1, parent_term_id: null, sort_order: 0 });
    const child = terms[1] as { code: string; level: number; parent_term_id: string | null };
    expect(child.code).toBe("A0101");
    expect(child.level).toBe(2);
    const rootId = await owner.db.execute(sql`SELECT id FROM imdrf_terms WHERE code = 'A01'`);
    expect(child.parent_term_id).toBe((rootId[0] as { id: string }).id);
  });

  it("lets two release years coexist without touching each other's terms", async () => {
    const admin = await signedInAs("administrator");

    const wb2026 = await workbookBuffer(2026, { A: [A_ROOT] });
    await confirmImport(
      admin.cookie,
      tokenFrom((await upload(admin.cookie, 2026, wb2026)).body) as string,
    );

    const wb2027 = await workbookBuffer(2027, {
      A: [{ code: "A02", term: "Other", hierarchy: "A02" }],
    });
    await confirmImport(
      admin.cookie,
      tokenFrom((await upload(admin.cookie, 2027, wb2027)).body) as string,
    );

    const releases = await owner.db.execute(
      sql`SELECT release_year FROM imdrf_releases ORDER BY release_year`,
    );
    expect(releases.map((r) => (r as { release_year: number }).release_year)).toEqual([2026, 2027]);
    expect(await termCount()).toBe(2);

    const y2026 = await owner.db.execute(sql`
      SELECT count(*) FROM imdrf_terms t JOIN imdrf_releases r ON r.id = t.release_id
       WHERE r.release_year = 2026
    `);
    expect(Number((y2026[0] as { count: string }).count)).toBe(1);
  });

  it("re-importing a still-draft release replaces its terms rather than duplicating the release row", async () => {
    const admin = await signedInAs("administrator");

    const first = await workbookBuffer(2026, { A: [A_ROOT] });
    await confirmImport(
      admin.cookie,
      tokenFrom((await upload(admin.cookie, 2026, first)).body) as string,
    );

    const second = await workbookBuffer(2026, {
      A: [{ code: "A99", term: "Replaced", hierarchy: "A99" }],
    });
    await confirmImport(
      admin.cookie,
      tokenFrom((await upload(admin.cookie, 2026, second)).body) as string,
    );

    const releases = await owner.db.execute(
      sql`SELECT id FROM imdrf_releases WHERE release_year = 2026`,
    );
    expect(releases).toHaveLength(1);

    const codes = await owner.db.execute(sql`SELECT code FROM imdrf_terms`);
    expect(codes.map((r) => (r as { code: string }).code)).toEqual(["A99"]);
  });

  it("publishing sets status/published_at, and refuses a second publish", async () => {
    const admin = await signedInAs("administrator");
    const wb = await workbookBuffer(2026, { A: [A_ROOT] });
    const confirm = await confirmImport(
      admin.cookie,
      tokenFrom((await upload(admin.cookie, 2026, wb)).body) as string,
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
    const wb = await workbookBuffer(2026, { A: [A_ROOT] });
    const confirm = await confirmImport(
      admin.cookie,
      tokenFrom((await upload(admin.cookie, 2026, wb)).body) as string,
    );
    const releaseId = (confirm.headers.location as string).split("release=")[1];
    await act(`/imdrf/manage/${releaseId}/publish`, admin.cookie);

    const before = await owner.db.execute(sql`SELECT code FROM imdrf_terms`);

    const replacement = await workbookBuffer(2026, {
      A: [{ code: "A99", term: "Should not land", hierarchy: "A99" }],
    });
    const preview = await upload(admin.cookie, 2026, replacement);
    const token = tokenFrom(preview.body) as string;
    const confirmAgain = await confirmImport(admin.cookie, token);

    expect(confirmAgain.statusCode).toBe(409);

    const after = await owner.db.execute(sql`SELECT code FROM imdrf_terms`);
    expect(after).toEqual(before);
  });

  it("rejects a workbook with a missing parent, writing zero rows", async () => {
    const admin = await signedInAs("administrator");
    const wb = await workbookBuffer(2026, { A: [A_CHILD] }); // A0101 with no A01 root present

    const res = await upload(admin.cookie, 2026, wb);

    expect(res.statusCode).toBe(200);
    expect(tokenFrom(res.body)).toBeUndefined();
    expect(res.body).toContain("cannot be imported");
    expect(await termCount()).toBe(0);
    expect(await owner.db.execute(sql`SELECT id FROM imdrf_releases`)).toHaveLength(0);
  });

  it("refuses a manager and an assessor every admin action", async () => {
    const admin = await signedInAs("administrator");
    const wb = await workbookBuffer(2026, { A: [A_ROOT] });

    for (const role of ["manager", "assessor"] as const) {
      const { cookie } = await signedInAs(role);
      expect((await get("/imdrf/manage", cookie)).statusCode).toBe(403);
      expect((await upload(cookie, 2026, wb)).statusCode).toBe(403);
      expect((await act("/imdrf/manage/import", cookie, { token: "anything" })).statusCode).toBe(
        403,
      );
    }

    expect(await termCount()).toBe(0);
    expect((await get("/imdrf/manage", admin.cookie)).statusCode).toBe(200);
  });
});
