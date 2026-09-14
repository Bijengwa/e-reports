import { describe, expect, it } from "vitest";
import type { ParsedRow, ParsedWorkbook } from "../../src/domain/imdrf/parser.js";
import { ANNEXES, type Annex } from "../../src/domain/imdrf/types.js";
import { validateParsedWorkbook } from "../../src/domain/imdrf/validate.js";

function row(partial: Partial<ParsedRow> & { code: string; codeHierarchy: string }): ParsedRow {
  return {
    annex: "A",
    rowNumber: 1,
    sourceOrder: 0,
    term: `Term ${partial.code}`,
    definition: null,
    nonImdrfCode: null,
    status: null,
    statusDescription: null,
    primaryCategory: null,
    secondaryCategory: null,
    ...partial,
  };
}

/**
 * `annexesFound` defaults to exactly the annexes present in `rows`, so a test about the
 * all-seven-annexes rule can seed a deliberately incomplete set and still exercise it. Every test
 * that expects `ok: true` and is not itself about that rule must instead pad its rows with
 * `completeWith` — a real (post-0018) validation call always requires all seven, matching
 * production, and padding keeps that requirement out of the tests that are about something else.
 */
function workbookOf(
  rows: ParsedRow[],
  releaseYear = 2026,
  annexesFound: Set<Annex> = new Set(rows.map((r) => r.annex)),
): ParsedWorkbook {
  return { rows, issues: [], releaseYearsFound: new Set([releaseYear]), annexesFound };
}

/** Adds one trivial, valid root row for any annex not already present in `rows`. */
function completeWith(rows: ParsedRow[]): ParsedRow[] {
  const present = new Set(rows.map((r) => r.annex));
  const padding = ANNEXES.filter((a) => !present.has(a)).map((a) =>
    row({ code: `${a}99`, codeHierarchy: `${a}99`, annex: a, term: `Padding ${a}` }),
  );
  return [...rows, ...padding];
}

describe("validateParsedWorkbook", () => {
  it("derives level from hierarchy segment count, at any depth, never assuming a maximum of 3", () => {
    const rows = [
      row({ code: "A01", codeHierarchy: "A01", rowNumber: 9 }),
      row({ code: "A0101", codeHierarchy: "A01|A0101", rowNumber: 10 }),
      row({ code: "A010101", codeHierarchy: "A01|A0101|A010101", rowNumber: 11 }),
      row({ code: "A01010101", codeHierarchy: "A01|A0101|A010101|A01010101", rowNumber: 12 }),
    ];
    const result = validateParsedWorkbook(workbookOf(completeWith(rows)), 2026);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.terms.filter((t) => t.annex === "A").map((t) => t.level)).toEqual([1, 2, 3, 4]);
  });

  it("resolves parentTermId to the id generated for the row whose code is the second-to-last segment", () => {
    const rows = [
      row({ code: "A01", codeHierarchy: "A01" }),
      row({ code: "A0101", codeHierarchy: "A01|A0101" }),
    ];
    const result = validateParsedWorkbook(workbookOf(completeWith(rows)), 2026);
    if (!result.ok) throw new Error("expected ok");
    const root = result.terms.find((t) => t.code === "A01");
    const child = result.terms.find((t) => t.code === "A0101");
    expect(root?.parentTermId).toBeNull();
    expect(child?.parentTermId).toBe(root?.id);
  });

  it("rejects a duplicate hierarchy position (the same CodeHierarchy claimed twice)", () => {
    const rows = [
      row({ code: "A01", codeHierarchy: "A01", rowNumber: 9 }),
      row({ code: "A01", codeHierarchy: "A01", rowNumber: 20 }),
    ];
    const result = validateParsedWorkbook(workbookOf(rows), 2026);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.issues.some((i) => i.field === "CodeHierarchy" && i.row === 20)).toBe(true);
  });

  it("allows the same code to recur at a different hierarchy position (IMDRF's real Annex E cross-listing)", () => {
    // E0104 "Cerebral Hyperperfusion Syndrome" genuinely appears at both E01|E0104 and E05|E0104
    // in the real 2026 workbook — the same term, cross-listed under two category branches.
    const rows = [
      row({ code: "E01", codeHierarchy: "E01", annex: "E", rowNumber: 9 }),
      row({ code: "E05", codeHierarchy: "E05", annex: "E", rowNumber: 10 }),
      row({ code: "E0104", codeHierarchy: "E01|E0104", annex: "E", rowNumber: 14 }),
      row({ code: "E0104", codeHierarchy: "E05|E0104", annex: "E", rowNumber: 140 }),
    ];
    const result = validateParsedWorkbook(workbookOf(completeWith(rows)), 2026);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.terms.filter((t) => t.annex === "E")).toHaveLength(4);
    const underNervous = result.terms.find((t) => t.codeHierarchy === "E01|E0104");
    const underVascular = result.terms.find((t) => t.codeHierarchy === "E05|E0104");
    const nervousRoot = result.terms.find((t) => t.codeHierarchy === "E01");
    const vascularRoot = result.terms.find((t) => t.codeHierarchy === "E05");
    expect(underNervous?.parentTermId).toBe(nervousRoot?.id);
    expect(underVascular?.parentTermId).toBe(vascularRoot?.id);
    expect(underNervous?.id).not.toBe(underVascular?.id);
  });

  it("rejects a hierarchy whose parent code is missing from the workbook", () => {
    const rows = [row({ code: "A0101", codeHierarchy: "A01|A0101", rowNumber: 10 })];
    const result = validateParsedWorkbook(workbookOf(rows), 2026);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.issues.some((i) => i.row === 10 && i.message.includes("A01"))).toBe(true);
  });

  it("rejects a hierarchy whose last segment does not match the row's own code", () => {
    const rows = [row({ code: "A01", codeHierarchy: "A02", rowNumber: 9 })];
    const result = validateParsedWorkbook(workbookOf(rows), 2026);
    expect(result.ok).toBe(false);
  });

  it("rejects an annex outside A-G", () => {
    const rows = [row({ code: "Z01", codeHierarchy: "Z01", annex: "Z" as never, rowNumber: 9 })];
    const result = validateParsedWorkbook(workbookOf(rows), 2026);
    expect(result.ok).toBe(false);
  });

  it("rejects when the workbook's own release year disagrees with the import target", () => {
    const rows = [row({ code: "A01", codeHierarchy: "A01" })];
    const result = validateParsedWorkbook(workbookOf(rows, 2025), 2026);
    expect(result.ok).toBe(false);
  });

  it("keeps retired terms rather than dropping them", () => {
    const rows = [row({ code: "A01", codeHierarchy: "A01", status: "Retired (2020)" })];
    const result = validateParsedWorkbook(workbookOf(completeWith(rows)), 2026);
    if (!result.ok) throw new Error("expected ok");
    expect(result.terms.find((t) => t.code === "A01")?.status).toBe("Retired (2020)");
  });

  it("preserves sourceOrder as sortOrder on the output", () => {
    const rows = [
      row({ code: "A01", codeHierarchy: "A01", sourceOrder: 0 }),
      row({ code: "A02", codeHierarchy: "A02", sourceOrder: 1 }),
    ];
    const result = validateParsedWorkbook(workbookOf(completeWith(rows)), 2026);
    if (!result.ok) throw new Error("expected ok");
    expect(result.terms.filter((t) => t.annex === "A").map((t) => t.sortOrder)).toEqual([0, 1]);
  });

  it("returns a correct per-annex summary and total for a valid multi-annex workbook", () => {
    const rows = completeWith([
      row({ code: "A01", codeHierarchy: "A01", annex: "A" }),
      row({ code: "A02", codeHierarchy: "A02", annex: "A" }),
      row({ code: "B01", codeHierarchy: "B01", annex: "B" }),
    ]);
    const result = validateParsedWorkbook(workbookOf(rows), 2026);
    if (!result.ok) throw new Error("expected ok");
    // A/B are the annexes this test cares about; C-G are `completeWith`'s one-row-each padding
    // (required now that every annex must contribute at least one term) and are asserted generically.
    expect(result.total).toBe(rows.length);
    expect(result.summary.find((s) => s.annex === "A")?.count).toBe(2);
    expect(result.summary.find((s) => s.annex === "B")?.count).toBe(1);
    expect(result.summary.find((s) => s.annex === "G")?.count).toBe(1);
  });
});

/** One valid root-level row per annex, and the found-set that goes with it. */
function allSevenRows(): ParsedRow[] {
  return ANNEXES.map((annex) => row({ code: `${annex}01`, codeHierarchy: `${annex}01`, annex }));
}

describe("validateParsedWorkbook: all seven annexes required", () => {
  for (const missing of ANNEXES) {
    it(`rejects a workbook missing Annex ${missing}`, () => {
      const rows = allSevenRows().filter((r) => r.annex !== missing);
      const found = new Set(ANNEXES.filter((a) => a !== missing));
      const result = validateParsedWorkbook(workbookOf(rows, 2026, found), 2026);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(
        result.issues.some(
          (i) =>
            i.annex === missing && i.message === `Annex ${missing} is missing from the workbook.`,
        ),
      ).toBe(true);
    });
  }

  it("accepts a workbook with all seven annexes present and populated", () => {
    const result = validateParsedWorkbook(workbookOf(allSevenRows(), 2026), 2026);
    expect(result.ok).toBe(true);
  });

  it("reports every missing annex, not just the first, when several are absent", () => {
    const rows = allSevenRows().filter((r) => r.annex !== "F" && r.annex !== "G");
    const found = new Set(ANNEXES.filter((a) => a !== "F" && a !== "G"));
    const result = validateParsedWorkbook(workbookOf(rows, 2026, found), 2026);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    const missingAnnexes = result.issues
      .filter((i) => i.message.includes("is missing from the workbook"))
      .map((i) => i.annex);
    expect(missingAnnexes.sort()).toEqual(["F", "G"]);
  });

  it("rejects an annex sheet that was found but produced no terminology rows", () => {
    const rows = allSevenRows().filter((r) => r.annex !== "G");
    // G's sheet exists (found), it simply has no data rows.
    const result = validateParsedWorkbook(workbookOf(rows, 2026, new Set(ANNEXES)), 2026);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(
      result.issues.some((i) => i.annex === "G" && i.message.includes("has no terminology rows")),
    ).toBe(true);
  });
});
