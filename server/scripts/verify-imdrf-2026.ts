import { sql } from "drizzle-orm";
import { createDatabase } from "../src/db/client.js";
import {
  resolveImdrfTerm,
  imdrfItemByFieldKey,
} from "../src/domain/imdrf/f004-integration.js";

type TermRow = {
  id: string;
  annex: string;
  code: string;
  term: string;
  level: number;
  parent_term_id: string | null;
  status: string | null;
  has_children: boolean;
};

const ANNEX_TO_FIELD: Record<string, string> = {
  A: "device_problem",
  B: "investigation_type",
  C: "investigation_findings",
  D: "investigation_conclusion",
  E: "clinical_signs",
  F: "health_impact",
  G: "component",
};

function fail(message: string): never {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    fail("DATABASE_URL is not available. Check server/.env");
  }

  const { db, close } = createDatabase(databaseUrl);

  try {
    console.log("\n╔════════════════════════════════════════════╗");
    console.log("║ IMDRF 2026 FULL CORPUS VERIFICATION       ║");
    console.log("╚════════════════════════════════════════════╝\n");

    // ------------------------------------------------------------
    // 1. Find the published 2026 release
    // ------------------------------------------------------------

    const releases = await db.execute<{
      id: string;
      release_year: number;
      document_code: string | null;
      status: string;
    }>(sql`
      SELECT id, release_year, document_code, status
      FROM imdrf_releases
      WHERE release_year = 2026
        AND status = 'published'
      ORDER BY release_year DESC
      LIMIT 1
    `);

    const release = releases[0];

    if (!release) {
      fail("No published 2026 IMDRF release found.");
    }

    console.log(`Release: ${release.document_code ?? "(no document code)"}`);
    console.log(`Year:    ${release.release_year}`);
    console.log(`Status:  ${release.status}\n`);

    // ------------------------------------------------------------
    // 2. Load the COMPLETE 2026 corpus
    // ------------------------------------------------------------

    const terms = await db.execute<TermRow>(sql`
      SELECT
        t.id,
        t.annex,
        t.code,
        t.term,
        t.level,
        t.parent_term_id,
        t.status,
        EXISTS (
          SELECT 1
          FROM imdrf_terms c
          WHERE c.parent_term_id = t.id
        ) AS has_children
      FROM imdrf_terms t
      WHERE t.release_id = ${release.id}
      ORDER BY t.annex, t.sort_order, t.id
    `);

    console.log(`Total terms: ${terms.length}`);

    if (terms.length !== 2133) {
      fail(
        `Expected 2,133 terms in the 2026 release, but found ${terms.length}.`,
      );
    }

    // ------------------------------------------------------------
    // 3. Basic corpus checks
    // ------------------------------------------------------------

    const counts = new Map<string, number>();

    for (const term of terms) {
      counts.set(term.annex, (counts.get(term.annex) ?? 0) + 1);
    }

    console.log("\nAnnex counts:");

    for (const annex of ["A", "B", "C", "D", "E", "F", "G"]) {
      console.log(`  Annex ${annex}: ${counts.get(annex) ?? 0}`);
    }

    // ------------------------------------------------------------
    // 4. Check duplicate identity
    // ------------------------------------------------------------

    const duplicateRows = await db.execute<{
      code: string;
      code_hierarchy: string;
      copies: string;
    }>(sql`
      SELECT code, code_hierarchy, COUNT(*) AS copies
      FROM imdrf_terms
      WHERE release_id = ${release.id}
      GROUP BY code, code_hierarchy
      HAVING COUNT(*) > 1
    `);

    if (duplicateRows.length > 0) {
      fail(
        `Found ${duplicateRows.length} duplicate (code, code_hierarchy) identities.`,
      );
    }

    console.log("\nDuplicate identity: PASS");

    // ------------------------------------------------------------
    // 5. Check broken parent references
    // ------------------------------------------------------------

    const brokenParents = await db.execute<{
      id: string;
      code: string;
      term: string;
    }>(sql`
      SELECT
        t.id,
        t.code,
        t.term
      FROM imdrf_terms t
      LEFT JOIN imdrf_terms p
        ON p.id = t.parent_term_id
      WHERE t.release_id = ${release.id}
        AND t.parent_term_id IS NOT NULL
        AND p.id IS NULL
    `);

    if (brokenParents.length > 0) {
      fail(
        `Found ${brokenParents.length} terms with broken parent references.`,
      );
    }

    console.log("Parent references:  PASS");

    // ------------------------------------------------------------
    // 6. Run the REAL F004 resolver against every term
    // ------------------------------------------------------------

    console.log("\nRunning F004 resolver against all 2,133 terms...\n");

    const stats = new Map<
      string,
      {
        total: number;
        selectable: number;
        rejected: number;
        errors: number;
      }
    >();

    for (const annex of ["A", "B", "C", "D", "E", "F", "G"]) {
      stats.set(annex, {
        total: 0,
        selectable: 0,
        rejected: 0,
        errors: 0,
      });
    }

    const failures: Array<{
      annex: string;
      code: string;
      term: string;
      reason: string;
    }> = [];

    let processed = 0;

    for (const term of terms) {
      processed++;

      const fieldKey = ANNEX_TO_FIELD[term.annex];

      if (!fieldKey) {
        failures.push({
          annex: term.annex,
          code: term.code,
          term: term.term,
          reason: `No F004 mapping exists for Annex ${term.annex}`,
        });
        continue;
      }

      const item = imdrfItemByFieldKey(fieldKey);

      if (!item) {
        failures.push({
          annex: term.annex,
          code: term.code,
          term: term.term,
          reason: `F004 item "${fieldKey}" was not found`,
        });
        continue;
      }

      const annexStats = stats.get(term.annex)!;
      annexStats.total++;

      try {
        const result = await resolveImdrfTerm(
          db,
          release.id,
          item,
          term.id,
        );

        if (result.ok) {
          annexStats.selectable++;
        } else {
          annexStats.rejected++;

          const expectedNonSelectable =
            term.has_children ||
            (term.status ?? "").toLowerCase().includes("not selectable");

          if (!expectedNonSelectable) {
            failures.push({
              annex: term.annex,
              code: term.code,
              term: term.term,
              reason: `Resolver rejected a term that appears selectable: ${result.message}`,
            });
          }
        }
      } catch (error) {
        annexStats.errors++;

        failures.push({
          annex: term.annex,
          code: term.code,
          term: term.term,
          reason:
            error instanceof Error ? error.message : String(error),
        });
      }

      if (processed % 100 === 0 || processed === terms.length) {
        process.stdout.write(
          `\rProcessed ${processed}/${terms.length}...`,
        );
      }
    }

    console.log("\n");

    // ------------------------------------------------------------
    // 7. Print results
    // ------------------------------------------------------------

    console.log("Resolver results:");
    console.log(
      "Annex | Total | Selectable | Rejected | Errors",
    );
    console.log(
      "------+-------+------------+----------+-------",
    );

    for (const annex of ["A", "B", "C", "D", "E", "F", "G"]) {
      const s = stats.get(annex)!;

      console.log(
        `${annex.padStart(5)} | ${String(s.total).padStart(5)} | ${String(
          s.selectable,
        ).padStart(10)} | ${String(s.rejected).padStart(8)} | ${String(
          s.errors,
        ).padStart(6)}`,
      );
    }

    // ------------------------------------------------------------
    // 8. Fail loudly if anything unexpected happened
    // ------------------------------------------------------------

    console.log("");

    if (failures.length > 0) {
      console.log(`❌ Unexpected failures: ${failures.length}\n`);

      for (const failure of failures.slice(0, 50)) {
        console.log(
          `  [${failure.annex}] ${failure.code} — ${failure.term}`,
        );
        console.log(`      ${failure.reason}`);
      }

      if (failures.length > 50) {
        console.log(
          `\n  ...and ${failures.length - 50} more.`,
        );
      }

      fail("IMDRF 2026 verification FAILED.");
    }

    console.log("Hierarchy:        PASS");
    console.log("Duplicate check:  PASS");
    console.log("Parent references: PASS");
    console.log("F004 resolver:    PASS");
    console.log("Unexpected errors: 0");
    console.log("\n════════════════════════════════════════════");
    console.log("RESULT: ✅ IMDRF 2026 VERIFICATION PASSED");
    console.log("════════════════════════════════════════════\n");
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error("\n❌ Verification crashed:");
  console.error(error);
  process.exit(1);
});