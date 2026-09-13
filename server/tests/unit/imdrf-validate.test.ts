import { describe, expect, it } from "vitest";
import type { ParsedRow, ParsedWorkbook } from "../../src/domain/imdrf/parser.js";
import { validateParsedWorkbook } from "../../src/domain/imdrf/validate.js";

function row(partial: Partial<ParsedRow> & { code: string; codeHierarchy: string }): ParsedRow {
  return {
    annex: "A",
    sheetName: "A",
    rowNumber: 1,
    sourceOrder: 0,
    term: `Term ${partial.code}`,
    definition: null,
    nonImdrfCode: null,
    status: null,
    statusDescription: null,
    primaryCategory: null,
    secondaryCategory: null,
    filledLevelColumns: 1,
    ...partial,
  };
}

function workbookOf(rows: ParsedRow[], releaseYear = 2026): ParsedWorkbook {
  return { rows, issues: [], releaseYearsFound: new Set([releaseYear]) };
}

describe("validateParsedWorkbook", () => {
  it("derives level from hierarchy segment count, at any depth, never assuming a maximum of 3", () => {
    const rows = [
      row({ code: "A01", codeHierarchy: "A01", rowNumber: 9 }),
      row({ code: "A0101", codeHierarchy: "A01|A0101", rowNumber: 10 }),
      row({ code: "A010101", codeHierarchy: "A01|A0101|A010101", rowNumber: 11 }),
      row({ code: "A01010101", codeHierarchy: "A01|A0101|A010101|A01010101", rowNumber: 12 }),
    ];
    const result = validateParsedWorkbook(workbookOf(rows), 2026);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.terms.map((t) => t.level)).toEqual([1, 2, 3, 4]);
  });

  it("resolves parentTermId to the id generated for the row whose code is the second-to-last segment", () => {
    const rows = [
      row({ code: "A01", codeHierarchy: "A01" }),
      row({ code: "A0101", codeHierarchy: "A01|A0101" }),
    ];
    const result = validateParsedWorkbook(workbookOf(rows), 2026);
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
      row({ code: "E01", codeHierarchy: "E01", rowNumber: 9 }),
      row({ code: "E05", codeHierarchy: "E05", rowNumber: 10 }),
      row({ code: "E0104", codeHierarchy: "E01|E0104", rowNumber: 14 }),
      row({ code: "E0104", codeHierarchy: "E05|E0104", rowNumber: 140 }),
    ];
    const result = validateParsedWorkbook(workbookOf(rows), 2026);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.terms).toHaveLength(4);
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
    const result = validateParsedWorkbook(workbookOf(rows), 2026);
    if (!result.ok) throw new Error("expected ok");
    expect(result.terms[0]?.status).toBe("Retired (2020)");
  });

  it("rejects a row with zero or more than one filled level column", () => {
    const rows = [row({ code: "A01", codeHierarchy: "A01", filledLevelColumns: 0, rowNumber: 9 })];
    const result = validateParsedWorkbook(workbookOf(rows), 2026);
    expect(result.ok).toBe(false);
  });

  it("preserves sourceOrder as sortOrder on the output", () => {
    const rows = [
      row({ code: "A01", codeHierarchy: "A01", sourceOrder: 0 }),
      row({ code: "A02", codeHierarchy: "A02", sourceOrder: 1 }),
    ];
    const result = validateParsedWorkbook(workbookOf(rows), 2026);
    if (!result.ok) throw new Error("expected ok");
    expect(result.terms.map((t) => t.sortOrder)).toEqual([0, 1]);
  });

  it("returns a correct per-annex summary and total for a valid multi-annex workbook", () => {
    const rows = [
      row({ code: "A01", codeHierarchy: "A01", annex: "A" }),
      row({ code: "A02", codeHierarchy: "A02", annex: "A" }),
      row({ code: "B01", codeHierarchy: "B01", annex: "B" }),
    ];
    const result = validateParsedWorkbook(workbookOf(rows), 2026);
    if (!result.ok) throw new Error("expected ok");
    expect(result.total).toBe(3);
    expect(result.summary.find((s) => s.annex === "A")?.count).toBe(2);
    expect(result.summary.find((s) => s.annex === "B")?.count).toBe(1);
    expect(result.summary.find((s) => s.annex === "G")?.count).toBe(0);
  });
});
