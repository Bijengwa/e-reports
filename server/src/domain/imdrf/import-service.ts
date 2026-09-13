/**
 * Orchestrates the admin upload flow: parse, validate, hold for confirmation, then write.
 *
 * The three steps are deliberately separate calls rather than one function, because the workflow
 * itself has to be: an administrator sees a preview before anything touches the terminology
 * tables, and only a second, explicit action commits it. `previewImdrfImport` never writes to
 * `imdrf_releases`/`imdrf_terms`. `confirmImdrfImport` re-parses and re-validates the held
 * workbook before it writes anything, rather than trusting that nothing could have changed since
 * the preview — cheap insurance at a few thousand rows and a few milliseconds, against ever
 * writing something that was not itself just proven valid.
 *
 * The hold between those two calls lives in `imdrf_import_staging` (Postgres), not in an
 * in-memory map. This deployment can run more than one application instance behind a load
 * balancer, and an in-memory map on one process is invisible to the others — the preview request
 * and the confirm request are not guaranteed to land on the same one. The staging row is
 * single-use: `confirmImdrfImport` locks it (`SELECT ... FOR UPDATE`) and deletes it inside the
 * same transaction that reads it, so two simultaneous confirms of the same token cannot both
 * proceed — the second finds nothing, because the first has already consumed it.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { imdrfImportStaging, imdrfReleases, imdrfTerms } from "../../db/schema/index.js";
import { parseImdrfWorkbook } from "./parser.js";
import type { AnnexSummary } from "./types.js";
import { type ValidatedTerm, type ValidationIssue, validateParsedWorkbook } from "./validate.js";

export type ImportPreview = {
  token: string;
  releaseYear: number;
  documentCode: string | null;
  title: string | null;
  sourceFileName: string;
  summary: AnnexSummary[];
  total: number;
  issues: ValidationIssue[];
  ok: boolean;
};

export type ImportOutcome =
  | { status: "imported"; releaseId: string; total: number }
  | { status: "invalid_token" }
  | { status: "already_published" }
  | { status: "validation_failed"; issues: ValidationIssue[] };

export type PublishOutcome =
  | { status: "published" }
  | { status: "not_found" }
  | { status: "already_published" };

const STAGING_TTL_MS = 15 * 60 * 1000;

/** 256 bits from the CSPRNG — the same size and source `auth/session.ts` uses for a session token. */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * SHA-256, the same choice `hashSessionToken` makes and for the same reason: the token itself is
 * already 256 bits of randomness with nothing to guess, so a slow password hash would only tax
 * every legitimate confirm for no security benefit. What hashing buys is that a staging table dump
 * holds no usable token — the raw value is never written anywhere, including here.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Removes staging rows whose hold has expired. Called at the top of both entry points below,
 *  so no separate cron job is needed to keep the table from growing without bound. */
async function sweepExpiredStaging(db: Database): Promise<void> {
  await db.delete(imdrfImportStaging).where(lt(imdrfImportStaging.expiresAt, sql`now()`));
}

export async function previewImdrfImport(
  db: Database,
  input: {
    buffer: Buffer;
    releaseYear: number;
    documentCode: string | null;
    title: string | null;
    sourceFileName: string;
    actorUserId: string | null;
  },
): Promise<ImportPreview> {
  await sweepExpiredStaging(db);

  const parsed = await parseImdrfWorkbook(input.buffer);
  const result = validateParsedWorkbook(parsed, input.releaseYear);

  if (!result.ok) {
    // Invalid: no staging row is written. "Failed validation performs zero database writes"
    // holds here too, not only for the terminology tables.
    return {
      token: "",
      releaseYear: input.releaseYear,
      documentCode: input.documentCode,
      title: input.title,
      sourceFileName: input.sourceFileName,
      summary: [],
      total: 0,
      issues: result.issues,
      ok: false,
    };
  }

  const token = generateToken();
  await db.insert(imdrfImportStaging).values({
    tokenHash: hashToken(token),
    releaseYear: input.releaseYear,
    documentCode: input.documentCode,
    title: input.title,
    sourceFileName: input.sourceFileName,
    workbookData: input.buffer,
    createdByUserId: input.actorUserId,
    expiresAt: new Date(Date.now() + STAGING_TTL_MS),
  });

  return {
    token,
    releaseYear: input.releaseYear,
    documentCode: input.documentCode,
    title: input.title,
    sourceFileName: input.sourceFileName,
    summary: result.summary,
    total: result.total,
    issues: result.issues,
    ok: true,
  };
}

const INSERT_CHUNK_SIZE = 500;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function toRow(releaseId: string, term: ValidatedTerm) {
  return {
    id: term.id,
    releaseId,
    annex: term.annex,
    code: term.code,
    term: term.term,
    definition: term.definition,
    nonImdrfCode: term.nonImdrfCode,
    status: term.status,
    statusDescription: term.statusDescription,
    primaryCategory: term.primaryCategory,
    secondaryCategory: term.secondaryCategory,
    codeHierarchy: term.codeHierarchy,
    parentTermId: term.parentTermId,
    level: term.level,
    sortOrder: term.sortOrder,
  };
}

/**
 * Consumes a preview token exactly once: locks and deletes its staging row, re-validates the
 * workbook it held, and — only if that still passes — writes the release/terms, all inside one
 * transaction. A `draft` release for that year is replaced wholesale (its terms deleted, then
 * reinserted, then its own metadata updated); a `published` release is refused untouched; a year
 * with no existing release gets a new `draft` row.
 *
 * The token is consumed whatever the outcome below — including a revalidation failure — because a
 * token is a bearer credential for one import attempt, not a retry coupon. The one exception is an
 * unexpected error (not a validation failure) partway through the writes: that rolls the whole
 * transaction back, staging row included, so an administrator who hit a transient failure can
 * retry with the same token rather than losing their upload.
 */
export async function confirmImdrfImport(db: Database, token: string): Promise<ImportOutcome> {
  await sweepExpiredStaging(db);

  const tokenHash = hashToken(token);

  return db.transaction(async (tx) => {
    const [staged] = await tx
      .select()
      .from(imdrfImportStaging)
      .where(eq(imdrfImportStaging.tokenHash, tokenHash))
      .for("update");

    if (!staged) return { status: "invalid_token" as const };

    // Consumed here, before anything else runs, so a concurrent confirm of the same token —
    // blocked on the row lock above until this transaction ends — finds nothing once it does.
    await tx.delete(imdrfImportStaging).where(eq(imdrfImportStaging.id, staged.id));

    if (staged.expiresAt.getTime() <= Date.now()) {
      return { status: "invalid_token" as const };
    }

    const parsed = await parseImdrfWorkbook(staged.workbookData);
    const result = validateParsedWorkbook(parsed, staged.releaseYear);
    if (!result.ok) return { status: "validation_failed" as const, issues: result.issues };

    const [existing] = await tx
      .select({ id: imdrfReleases.id, status: imdrfReleases.status })
      .from(imdrfReleases)
      .where(eq(imdrfReleases.releaseYear, staged.releaseYear))
      .limit(1);

    if (existing && existing.status === "published") {
      return { status: "already_published" as const };
    }

    let releaseId: string;
    if (existing) {
      releaseId = existing.id;
      await tx.delete(imdrfTerms).where(eq(imdrfTerms.releaseId, releaseId));
      await tx
        .update(imdrfReleases)
        .set({
          documentCode: staged.documentCode,
          title: staged.title,
          sourceFileName: staged.sourceFileName,
        })
        .where(eq(imdrfReleases.id, releaseId));
    } else {
      const [inserted] = await tx
        .insert(imdrfReleases)
        .values({
          releaseYear: staged.releaseYear,
          documentCode: staged.documentCode,
          title: staged.title,
          sourceFileName: staged.sourceFileName,
          status: "draft",
        })
        .returning({ id: imdrfReleases.id });
      if (!inserted) throw new Error("Insert into imdrf_releases returned no row.");
      releaseId = inserted.id;
    }

    for (const batch of chunk(result.terms, INSERT_CHUNK_SIZE)) {
      await tx.insert(imdrfTerms).values(batch.map((term) => toRow(releaseId, term)));
    }

    return { status: "imported" as const, releaseId, total: result.total };
  });
}

/** Publishing is one conditional update: a draft becomes published, or nothing happens at all. */
export async function publishImdrfRelease(
  db: Database,
  releaseId: string,
): Promise<PublishOutcome> {
  const [updated] = await db
    .update(imdrfReleases)
    .set({ status: "published", publishedAt: new Date() })
    .where(and(eq(imdrfReleases.id, releaseId), eq(imdrfReleases.status, "draft")))
    .returning({ id: imdrfReleases.id });

  if (updated) return { status: "published" };

  const [existing] = await db
    .select({ id: imdrfReleases.id })
    .from(imdrfReleases)
    .where(eq(imdrfReleases.id, releaseId))
    .limit(1);
  return existing ? { status: "already_published" } : { status: "not_found" };
}
