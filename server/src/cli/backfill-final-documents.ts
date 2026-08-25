import { sql } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { createDatabase, type DatabaseHandle } from "../db/client.js";
import { F004_VERSION, type F004Answers, normalizeSecondaryReview } from "../domain/f004.js";
import { FINAL_DOCUMENT_MIN_ORDINAL, resolveFinalDocument } from "../domain/final-document.js";

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
 *   - It never repairs an A1 alone. A first assessment nobody reviewed is not a concluded
 *     assessment, and a snapshot resolved from one would be an approved document of an unreviewed
 *     opinion. Such a report is named and left for the workflow — assign A2, take the second
 *     assessment, approve — which is the only thing that can actually settle it.
 *
 * It also names the A1-only snapshots that ALREADY exist, written by an earlier version of this
 * script before that rule was here. They are not touched: the table is immutable, and deleting
 * history to tidy a list would be the worse of the two mistakes. They are simply no longer served
 * as Final F004s — see `isConcludedFinalDocument` — and this is where a human finds out which
 * reports need putting back through the workflow.
 *
 * Exit codes: 0 success (including nothing to do), 3 unexpected failure.
 */

const HELP = `Backfill missing Final F004 snapshots.

  --apply    Write the missing snapshots. Without it, this only reports what it would do.

A report is repaired when all four are true:

  * it is 'assigned_for_work'
  * it has an 'assign_work_officer' decision
  * its first assessment is submitted
  * at least one secondary assessment is submitted

Anything else is listed as needing manual review and left alone. Reports that already
have a snapshot are never touched, including the A1-only ones an earlier version of this
script wrote — those are listed too, and are repaired only by taking the report back
through the A2 workflow.
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

/**
 * The A1-only snapshots already in the table, named and left exactly as they are.
 *
 * Read-only, on purpose and without qualification. `report_final_documents` is the record of what a
 * manager approved and when, and a row in it is not made truer by being deleted. These rows are no
 * longer served as Final F004s and no longer listed as Final Reports; what they still need is a
 * person to take each report back through the workflow, and that person needs the list.
 */
async function reportLegacyA1Only(db: DatabaseHandle["db"]): Promise<void> {
  const rows = (await db.execute(sql`
    SELECT r.number, f.resolved_through_ordinal
      FROM report_final_documents f
      JOIN reports r ON r.id = f.report_id
     WHERE f.resolved_through_ordinal < ${FINAL_DOCUMENT_MIN_ORDINAL}
     ORDER BY r.number
  `)) as unknown as { number: string; resolved_through_ordinal: number }[];

  if (rows.length === 0) return;

  process.stdout.write(
    `\n${String(rows.length)} existing snapshot(s) resolve through A1 alone and are NOT valid Final F004s:\n`,
  );
  for (const row of rows) {
    process.stdout.write(
      `  ${row.number} — resolved through A${String(row.resolved_through_ordinal)}; left untouched, repair through the A2 workflow\n`,
    );
  }
}

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

      /*
       * A1 alone is not a concluded assessment, so it does not get a snapshot.
       *
       * The live approval has refused this since the rule was written into
       * `assign-work-officer`; this is that same rule, applied to the reports that reached
       * `assigned_for_work` before it existed. Writing one anyway would manufacture an
       * authoritative document out of an unreviewed first opinion, which is the one outcome a
       * repair script must never produce.
       */
      if (chainRows.length === 0) {
        skipped.push({
          number: report.number,
          why: "no submitted secondary assessment — needs A2 through the workflow",
        });
        continue;
      }

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

    await reportLegacyA1Only(db.db);

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
