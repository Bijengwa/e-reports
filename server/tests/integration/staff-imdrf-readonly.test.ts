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
const ABSENT_ID = "00000000-0000-4000-8000-000000000000";

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
  const email = `imdrf-ro${seeded}@tmda.go.tz`;

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

async function signedInAs(role: Role, name?: string): Promise<{ id: string; cookie: string }> {
  const user = await seed(role, name);
  return { id: user.id, cookie: await cookieFor(user.email) };
}

function get(url: string, cookie: string) {
  return app.inject({ url, headers: { host: STAFF_HOST, cookie } });
}

function json<T>(res: { body: string }): T {
  return JSON.parse(res.body) as T;
}

/** Seeds a release directly (owner connection), bypassing the admin upload flow entirely. */
async function seedRelease(
  releaseYear: number,
  status: "draft" | "published" = "published",
): Promise<string> {
  const rows = await owner.db.execute(sql`
    INSERT INTO imdrf_releases (release_year, source_file_name, status, published_at)
    VALUES (
      ${releaseYear}, 'seed.xlsx', ${status}::imdrf_release_status,
      ${status === "published" ? sql`now()` : sql`NULL`}
    )
    RETURNING id
  `);
  return (rows[0] as { id: string }).id;
}

type SeedTerm = {
  annex: string;
  code: string;
  term: string;
  codeHierarchy: string;
  level: number;
  sortOrder: number;
  parentTermId?: string | null;
  status?: string | null;
  definition?: string | null;
};

async function seedTerm(releaseId: string, t: SeedTerm): Promise<string> {
  const rows = await owner.db.execute(sql`
    INSERT INTO imdrf_terms (release_id, annex, code, term, code_hierarchy, level, sort_order, parent_term_id, status, definition)
    VALUES (
      ${releaseId}, ${t.annex}, ${t.code}, ${t.term}, ${t.codeHierarchy}, ${t.level}, ${t.sortOrder},
      ${t.parentTermId ?? null}, ${t.status ?? null}, ${t.definition ?? null}
    )
    RETURNING id
  `);
  return (rows[0] as { id: string }).id;
}

describe.skipIf(!INTEGRATION_ENABLED)("the read-only IMDRF terminology sidebar", () => {
  beforeEach(start);

  it("a published release's terms are visible to manager, assessor and administrator alike", async () => {
    const releaseId = await seedRelease(2026);
    await seedTerm(releaseId, {
      annex: "A",
      code: "A01",
      term: "Root",
      codeHierarchy: "A01",
      level: 1,
      sortOrder: 0,
    });

    for (const role of ["administrator", "manager", "assessor"] as const) {
      const { cookie } = await signedInAs(role);
      const res = await get(`/imdrf/releases/${releaseId}/terms?annex=A`, cookie);
      expect(res.statusCode).toBe(200);
      expect(json<{ rows: unknown[] }>(res).rows).toHaveLength(1);
    }
  });

  it("a draft release is invisible: 404 on its id, and absent from the release list", async () => {
    const draftId = await seedRelease(2026, "draft");
    await seedTerm(draftId, {
      annex: "A",
      code: "A01",
      term: "Root",
      codeHierarchy: "A01",
      level: 1,
      sortOrder: 0,
    });
    const { cookie } = await signedInAs("manager");

    const termsRes = await get(`/imdrf/releases/${draftId}/terms?annex=A`, cookie);
    expect(termsRes.statusCode).toBe(404);

    const detailRes = await get(`/imdrf/releases/${draftId}/terms/${ABSENT_ID}`, cookie);
    expect(detailRes.statusCode).toBe(404);

    const page = await get("/imdrf", cookie);
    expect(page.body).not.toContain("2026");
  });

  it("switching release id between two published releases returns disjoint term sets", async () => {
    const r2026 = await seedRelease(2026);
    const r2027 = await seedRelease(2027);
    await seedTerm(r2026, {
      annex: "A",
      code: "A01",
      term: "From 2026",
      codeHierarchy: "A01",
      level: 1,
      sortOrder: 0,
    });
    await seedTerm(r2027, {
      annex: "A",
      code: "A02",
      term: "From 2027",
      codeHierarchy: "A02",
      level: 1,
      sortOrder: 0,
    });
    const { cookie } = await signedInAs("manager");

    const from2026 = json<{ rows: { code: string }[] }>(
      await get(`/imdrf/releases/${r2026}/terms?annex=A`, cookie),
    );
    const from2027 = json<{ rows: { code: string }[] }>(
      await get(`/imdrf/releases/${r2027}/terms?annex=A`, cookie),
    );

    expect(from2026.rows.map((r) => r.code)).toEqual(["A01"]);
    expect(from2027.rows.map((r) => r.code)).toEqual(["A02"]);
  });

  it("lists only root terms with parentId absent, and exactly a term's own children with parentId set", async () => {
    const releaseId = await seedRelease(2026);
    const rootId = await seedTerm(releaseId, {
      annex: "A",
      code: "A01",
      term: "Root",
      codeHierarchy: "A01",
      level: 1,
      sortOrder: 0,
    });
    await seedTerm(releaseId, {
      annex: "A",
      code: "A0101",
      term: "Child",
      codeHierarchy: "A01|A0101",
      level: 2,
      sortOrder: 1,
      parentTermId: rootId,
    });
    await seedTerm(releaseId, {
      annex: "A",
      code: "A02",
      term: "Other root",
      codeHierarchy: "A02",
      level: 1,
      sortOrder: 2,
    });
    const { cookie } = await signedInAs("manager");

    const roots = json<{ rows: { code: string; hasChildren: boolean }[] }>(
      await get(`/imdrf/releases/${releaseId}/terms?annex=A`, cookie),
    );
    expect(roots.rows.map((r) => r.code).sort()).toEqual(["A01", "A02"]);
    expect(roots.rows.find((r) => r.code === "A01")?.hasChildren).toBe(true);
    expect(roots.rows.find((r) => r.code === "A02")?.hasChildren).toBe(false);

    const children = json<{ rows: { code: string }[] }>(
      await get(`/imdrf/releases/${releaseId}/terms?parentId=${rootId}`, cookie),
    );
    expect(children.rows.map((r) => r.code)).toEqual(["A0101"]);
  });

  it("retrieves a hierarchy deeper than 3 levels with the correct level, making no depth-3 assumption", async () => {
    const releaseId = await seedRelease(2026);
    const l1 = await seedTerm(releaseId, {
      annex: "A",
      code: "A01",
      term: "L1",
      codeHierarchy: "A01",
      level: 1,
      sortOrder: 0,
    });
    const l2 = await seedTerm(releaseId, {
      annex: "A",
      code: "A0101",
      term: "L2",
      codeHierarchy: "A01|A0101",
      level: 2,
      sortOrder: 1,
      parentTermId: l1,
    });
    const l3 = await seedTerm(releaseId, {
      annex: "A",
      code: "A010101",
      term: "L3",
      codeHierarchy: "A01|A0101|A010101",
      level: 3,
      sortOrder: 2,
      parentTermId: l2,
    });
    const l4Id = await seedTerm(releaseId, {
      annex: "A",
      code: "A01010101",
      term: "L4",
      codeHierarchy: "A01|A0101|A010101|A01010101",
      level: 4,
      sortOrder: 3,
      parentTermId: l3,
    });
    const { cookie } = await signedInAs("manager");

    const detail = json<{ level: number; codeHierarchy: string }>(
      await get(`/imdrf/releases/${releaseId}/terms/${l4Id}`, cookie),
    );
    expect(detail.level).toBe(4);
    expect(detail.codeHierarchy).toBe("A01|A0101|A010101|A01010101");
  });

  it("search matches only within the given release", async () => {
    const r2026 = await seedRelease(2026);
    const r2027 = await seedRelease(2027);
    await seedTerm(r2026, {
      annex: "G",
      code: "G02002",
      term: "Battery",
      codeHierarchy: "G02|G02002",
      level: 2,
      sortOrder: 0,
    });
    await seedTerm(r2027, {
      annex: "G",
      code: "G02002",
      term: "Battery Cell",
      codeHierarchy: "G02|G02002",
      level: 2,
      sortOrder: 0,
    });
    const { cookie } = await signedInAs("manager");

    const from2026 = json<{ rows: { term: string }[] }>(
      await get(`/imdrf/releases/${r2026}/search?q=battery`, cookie),
    );
    expect(from2026.rows.map((r) => r.term)).toEqual(["Battery"]);

    const from2027 = json<{ rows: { term: string }[] }>(
      await get(`/imdrf/releases/${r2027}/search?q=battery`, cookie),
    );
    expect(from2027.rows.map((r) => r.term)).toEqual(["Battery Cell"]);
  });

  it("a retired term still appears in browse and search, with its status preserved", async () => {
    const releaseId = await seedRelease(2026);
    const termId = await seedTerm(releaseId, {
      annex: "A",
      code: "A99",
      term: "Retired Widget Problem",
      codeHierarchy: "A99",
      level: 1,
      sortOrder: 0,
      status: "Retired (2020)",
    });
    const { cookie } = await signedInAs("manager");

    const browse = json<{ rows: { code: string }[] }>(
      await get(`/imdrf/releases/${releaseId}/terms?annex=A`, cookie),
    );
    expect(browse.rows.map((r) => r.code)).toEqual(["A99"]);

    const search = json<{ rows: { code: string }[] }>(
      await get(`/imdrf/releases/${releaseId}/search?q=widget`, cookie),
    );
    expect(search.rows.map((r) => r.code)).toEqual(["A99"]);

    const detail = json<{ status: string | null }>(
      await get(`/imdrf/releases/${releaseId}/terms/${termId}`, cookie),
    );
    expect(detail.status).toBe("Retired (2020)");
  });

  it("returns an empty result set for an empty or whitespace query, without error", async () => {
    const releaseId = await seedRelease(2026);
    await seedTerm(releaseId, {
      annex: "A",
      code: "A01",
      term: "Root",
      codeHierarchy: "A01",
      level: 1,
      sortOrder: 0,
    });
    const { cookie } = await signedInAs("manager");

    const empty = json<{ rows: unknown[] }>(
      await get(`/imdrf/releases/${releaseId}/search?q=`, cookie),
    );
    expect(empty.rows).toEqual([]);

    const blank = json<{ rows: unknown[] }>(
      await get(`/imdrf/releases/${releaseId}/search?q=${encodeURIComponent("   ")}`, cookie),
    );
    expect(blank.rows).toEqual([]);
  });

  it("paginates: nextCursor is set once more rows exist than fit a page, and following it returns the remainder with no overlap", async () => {
    const releaseId = await seedRelease(2026);
    for (let i = 0; i < 60; i++) {
      await seedTerm(releaseId, {
        annex: "A",
        code: `A${String(i).padStart(3, "0")}`,
        term: `Term ${i}`,
        codeHierarchy: `A${String(i).padStart(3, "0")}`,
        level: 1,
        sortOrder: i,
      });
    }
    const { cookie } = await signedInAs("manager");

    // The server clamps its own page size (spec: "Use a sensible result limit"), so 60 seeded
    // root terms is enough to force a second page regardless of what limit it chose.
    const first = json<{ rows: { code: string }[]; nextCursor: string | null }>(
      await get(`/imdrf/releases/${releaseId}/terms?annex=A`, cookie),
    );
    expect(first.nextCursor).not.toBeNull();

    const second = json<{ rows: { code: string }[] }>(
      await get(
        `/imdrf/releases/${releaseId}/terms?annex=A&cursor=${encodeURIComponent(first.nextCursor as string)}`,
        cookie,
      ),
    );
    const firstCodes = new Set(first.rows.map((r) => r.code));
    for (const row of second.rows) expect(firstCodes.has(row.code)).toBe(false);
    expect(first.rows.length + second.rows.length).toBe(60);
  });

  it("renders a documentation reader with the same title bar as every other staff page, and no inline styles", async () => {
    const releaseId = await seedRelease(2026);
    await seedTerm(releaseId, {
      annex: "A",
      code: "A01",
      term: "Root",
      codeHierarchy: "A01",
      level: 1,
      sortOrder: 0,
    });
    const { cookie } = await signedInAs("assessor");

    const page = await get("/imdrf", cookie);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(">IMDRF terminology<");
    expect(page.body).toContain("data-imdrf-browser");
    expect(page.body).toContain("imdrf-reader");
    expect(page.body).toContain("staff-head");
    expect(page.body).not.toContain('style="');
  });
});
