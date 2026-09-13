/**
 * Orchestrates the admin upload flow: parse, validate, hold for confirmation, then write.
 *
 * The three steps are deliberately separate calls rather than one function, because the workflow
 * itself has to be: an administrator sees a preview before anything touches the database, and only
 * a second, explicit action commits it. `previewImdrfImport` never writes. `confirmImdrfImport`
 * re-parses and re-validates the held buffer before it writes anything, rather than trusting that
 * nothing could have changed between the two calls — cheap insurance at a few thousand rows and a
 * few milliseconds, against ever writing something that was not itself just proven valid.
 */

import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { imdrfReleases, imdrfTerms } from "../../db/schema/index.js";
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

type PendingImport = {
  buffer: Buffer;
  releaseYear: number;
  documentCode: string | null;
  title: string | null;
  sourceFileName: string;
  expiresAt: number;
};

/**
 * A single-process, in-memory hold for an uploaded workbook between preview and confirm.
 *
 * Deliberately not a database table or a file on disk: the buffer only needs to survive the short
 * gap between one administrator's two clicks, on the one app instance this deployment runs (see
 * the "AE Reports locked architecture" note — one Fastify process, one Postgres). A restart during
 * that gap loses the token, and the administrator simply re-uploads; nothing about the release
 * itself is ever in a half-written state, because `confirmImdrfImport` re-validates from the held
 * buffer inside its own transaction rather than trusting anything the token merely remembers.
 */
const PENDING_IMPORTS = new Map<string, PendingImport>();
const PENDING_IMPORT_TTL_MS = 15 * 60 * 1000;

function evictExpired(now: number): void {
  for (const [token, pending] of PENDING_IMPORTS) {
    if (pending.expiresAt <= now) PENDING_IMPORTS.delete(token);
  }
}

export async function previewImdrfImport(input: {
  buffer: Buffer;
  releaseYear: number;
  documentCode: string | null;
  title: string | null;
  sourceFileName: string;
}): Promise<ImportPreview> {
  const now = Date.now();
  evictExpired(now);

  const parsed = await parseImdrfWorkbook(input.buffer);
  const result = validateParsedWorkbook(parsed, input.releaseYear);

  if (!result.ok) {
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

  const token = crypto.randomUUID();
  PENDING_IMPORTS.set(token, {
    buffer: input.buffer,
    releaseYear: input.releaseYear,
    documentCode: input.documentCode,
    title: input.title,
    sourceFileName: input.sourceFileName,
    expiresAt: now + PENDING_IMPORT_TTL_MS,
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
 * Consumes a preview token exactly once: re-validates the held workbook and, only if it still
 * passes, writes it inside a single transaction. A `draft` release for that year is replaced
 * wholesale (its terms deleted, then reinserted, then its own metadata updated); a `published`
 * release is refused untouched; a year with no existing release gets a new `draft` row.
 */
export async function confirmImdrfImport(db: Database, token: string): Promise<ImportOutcome> {
  evictExpired(Date.now());

  const pending = PENDING_IMPORTS.get(token);
  if (!pending) return { status: "invalid_token" };
  PENDING_IMPORTS.delete(token); // Single-use, whatever the outcome below.

  const parsed = await parseImdrfWorkbook(pending.buffer);
  const result = validateParsedWorkbook(parsed, pending.releaseYear);
  if (!result.ok) return { status: "validation_failed", issues: result.issues };

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: imdrfReleases.id, status: imdrfReleases.status })
      .from(imdrfReleases)
      .where(eq(imdrfReleases.releaseYear, pending.releaseYear))
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
          documentCode: pending.documentCode,
          title: pending.title,
          sourceFileName: pending.sourceFileName,
        })
        .where(eq(imdrfReleases.id, releaseId));
    } else {
      const [inserted] = await tx
        .insert(imdrfReleases)
        .values({
          releaseYear: pending.releaseYear,
          documentCode: pending.documentCode,
          title: pending.title,
          sourceFileName: pending.sourceFileName,
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
