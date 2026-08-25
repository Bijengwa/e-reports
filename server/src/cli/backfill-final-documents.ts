import { sql } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { createDatabase } from "../db/client.js";
import { F004_VERSION, type F004Answers, normalizeSecondaryReview } from "../domain/f004.js";
import { resolveFinalDocument } from "../domain/final-document.js";

/**
 * The Final F004 snapshots that were never taken, for reports approved before there were any.
 *
 * `assign-work-officer` has written one in the same transaction as the decision since migration
 * 0014. Every report approved before that reached `assigned_for_work` with a decision, a finished
 * assessment chain and no document — genuinely approved, and invisible to a Final Reports list
 * that reads `report_final_documents`. This repairs those, once.
 *
 * A script rather than a SQL migration, unlike 0013's backfill of the legacy assignments. That one
 * moved columns around and SQL could express it; this one has to resolve an assessment chain into
 * a document, and the resolution is `resolveFinalDocument` — the same function the live approval
 * calls. Reimplementing it in SQL would be a second resolver to keep in step with the first, which
 * is exactly the thing worth avoiding in a document meant to be authoritative.
 *
 * What it will not do:
 *
 *   - It never touches `reports.payload`, `reports.received_at`, `assessments` or
 *     `report_decisions`. The inputs stay exactly as they are; only the missing output is written.
 *   - It never backdates. `approved_at` takes the column default, so the row says when the snapshot
 *     was taken, not when the approval happened — the old system recorded no snapshot time, and
 *     inventing one would make a repair look like a contemporaneous record. The decision it points
 *     at carries the real approval time, and `decision_id` is how a reader gets to it.
 *   - It never writes twice. The INSERT is guarded by NOT EXISTS and the table's unique index on
 *     `report_id` backs that up, so running it again is a no-op.
 *   - It never guesses. A report whose chain cannot produce a truthful document is skipped and
 *     named, for a human to look at.
 *
 * Exit codes: 0 success (including nothing to do), 3 unexpected failure.
 */

const HELP = `Backfill missing Final F004 snapshots.

  --apply    Write the missing snapshots. Without it, this only reports what it would do.

A report is repaired when all three are true:

  * it is 'assigned_for_work'
  * it has an 'assign_work_officer' decision
  * its first assessment is submitted

Anything else is listed as needing manual review and left alone. Reports that already
have a snapshot are never touched.
`;

type Candidate = {
  id: string;
  number: string;
  decision_id: string | null;
  approved_by_user_id: string | null;
  reviewed_through_ordinal: number | null;
  a1_payload: unknown;
  a1_submitted: boolean;
};

export async function backfillFinalDocuments(apply: boolean): Promise<number> {
  const db = createDatabase(loadConfig().DATABASE_URL);

  try {
    /*
     * Every approved report with no snapshot, and enough of its state to decide what to do.
     *
     * The decision is the LATEST `assign_work_officer` on the report, which is the one that put it
     * in `assigned_for_work` — the same rule `/my-work` already applies when it names who the work
     * went to, so the document points at the decision the rest of the app agrees is the live one.
     */
    const candidates = (await db.db.execute(sql`
      SELECT r.id, r.number,
             d.id AS decision_id,
             d.decided_by_user_id AS approved_by_user_id,
             d.reviewed_through_ordinal,
             a1.payload AS a1_payload,
             (a1.submitted_at IS NOT NULL) AS a1_submitted
        FROM reports r
        LEFT JOIN LATERAL (
          SELECT id, decided_by_user_id, reviewed_through_ordinal
            FROM report_decisions
           WHERE report_id = r.id AND kind = 'assign_work_officer'
           ORDER BY decided_at DESC
           LIMIT 1
        ) d ON true
        LEFT JOIN assessments a1 ON a1.report_id = r.id AND a1.ordinal = 1
       WHERE r.status = 'assigned_for_work'
         AND NOT EXISTS (SELECT 1 FROM report_final_documents f WHERE f.report_id = r.id)
       ORDER BY r.number
    `)) as unknown as Candidate[];

    if (candidates.length === 0) {
      process.stdout.write("Nothing to do: every approved report already has a Final F004.\n");
      return 0;
    }

    const repaired: string[] = [];
    const skipped: { number: string; why: string }[] = [];

    for (const report of candidates) {
      if (report.decision_id === null || report.approved_by_user_id === null) {
        skipped.push({ number: report.number, why: "no assign_work_officer decision" });
        continue;
      }

      if (!report.a1_submitted) {
        skipped.push({ number: report.number, why: "first assessment not submitted" });
        continue;
      }

      // Only submitted secondary assessments, in ordinal order — the same chain the live approval
      // folds. A draft was never a finding and is not one now.
      const chainRows = (await db.db.execute(sql`
        SELECT ordinal, payload
          FROM assessments
         WHERE report_id = ${report.id} AND ordinal > 1 AND submitted_at IS NOT NULL
         ORDER BY ordinal ASC
      `)) as unknown as { ordinal: number; payload: unknown }[];

      const chain = chainRows.map((row) => ({
        ordinal: row.ordinal,
        review: normalizeSecondaryReview(row.payload),
      }));

      const document = resolveFinalDocument((report.a1_payload ?? {}) as F004Answers, chain);

      /*
       * The ordinal the document actually resolves through, not the decision's own record of it.
       *
       * They agree wherever the decision was written by the current code. Where they do not, the
       * chain is the truth about the document — this row has to say what it holds, and the highest
       * submitted ordinal is exactly that. Falls back to the decision's figure, then to 1.
       */
      const resolvedThrough = chainRows.at(-1)?.ordinal ?? report.reviewed_through_ordinal ?? 1;

      if (!apply) {
        repaired.push(`${report.number} (would resolve A1..A${String(resolvedThrough)})`);
        continue;
      }

      // NOT EXISTS again, inside the write. The read above could be minutes old by now, and the
      // unique index would turn a race into a crash rather than the no-op it should be.
      await db.db.execute(sql`
        INSERT INTO report_final_documents (report_id, decision_id, approved_by_user_id,
                                            resolved_through_ordinal, form_version, payload)
        SELECT ${report.id}, ${report.decision_id}, ${report.approved_by_user_id},
               ${resolvedThrough}, ${F004_VERSION}, ${JSON.stringify(document)}::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM report_final_documents WHERE report_id = ${report.id}
         )
      `);

      repaired.push(`${report.number} (resolved A1..A${String(resolvedThrough)})`);
    }

    process.stdout.write(
      `${apply ? "Backfilled" : "Would backfill"} ${String(repaired.length)} Final F004 snapshot(s).\n`,
    );
    for (const line of repaired) process.stdout.write(`  ${line}\n`);

    if (skipped.length > 0) {
      process.stdout.write(`\n${String(skipped.length)} report(s) need manual review:\n`);
      for (const one of skipped) process.stdout.write(`  ${one.number} — ${one.why}\n`);
    }

    if (!apply) process.stdout.write("\nDry run. Re-run with --apply to write.\n");

    return 0;
  } finally {
    await db.close();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }

  process.exitCode = await backfillFinalDocuments(argv.includes("--apply"));
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 3;
});
