import { describe, expect, it } from "vitest";
import { parseImdrfPayload } from "../../src/domain/imdrf/parser.js";
import { validateParsedPayload } from "../../src/domain/imdrf/validate.js";
import {
  consolidatedFragment,
  crossListedE0104UnderE01,
  crossListedE0104UnderE05,
  orphanedRealRecordG07003,
  singleAnnexA,
  singleAnnexD,
  singleAnnexE,
  singleAnnexE05Root,
  singleAnnexF,
  singleAnnexG,
} from "../fixtures/imdrf-real-fragments.js";

function parseAndValidate(records: readonly unknown[], releaseYear = 2026) {
  const parsed = parseImdrfPayload(JSON.stringify(records));
  return validateParsedPayload(parsed, releaseYear);
}

describe("validateParsedPayload: real consolidated export", () => {
  it("validates the real consolidated Annexes A-G fragment and resolves parent chains", () => {
    const result = parseAndValidate(consolidatedFragment);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.total).toBe(consolidatedFragment.length);
    expect(result.summary.find((s) => s.annex === "A")?.count).toBe(4);
    expect(result.summary.find((s) => s.annex === "B")?.count).toBe(3);
    expect(result.summary.find((s) => s.annex === "G")?.count).toBe(3);

    const root = result.terms.find((t) => t.codeHierarchy === "A");
    const a01 = result.terms.find((t) => t.codeHierarchy === "A|A01");
    const a0101 = result.terms.find((t) => t.codeHierarchy === "A|A01|A0101");
    expect(root?.parentTermId).toBeNull();
    expect(root?.level).toBe(1);
    expect(a01?.parentTermId).toBe(root?.id);
    expect(a01?.level).toBe(2);
    expect(a0101?.parentTermId).toBe(a01?.id);
    expect(a0101?.level).toBe(3);
  });
});

describe("validateParsedPayload: real single-annex exports", () => {
  it("validates a real Annex A single-annex export (no root marker record)", () => {
    const result = parseAndValidate(singleAnnexA);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.total).toBe(singleAnnexA.length);
    const top = result.terms.find((t) => t.codeHierarchy === "A01");
    expect(top?.level).toBe(1);
    expect(top?.parentTermId).toBeNull();
  });

  it("validates a real Annex D single-annex export", () => {
    const result = parseAndValidate(singleAnnexD);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.summary.find((s) => s.annex === "D")?.count).toBe(singleAnnexD.length);
  });

  it("validates a real Annex F single-annex export", () => {
    const result = parseAndValidate(singleAnnexF);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.summary.find((s) => s.annex === "F")?.count).toBe(singleAnnexF.length);
  });

  it("validates a real Annex G single-annex export", () => {
    const result = parseAndValidate(singleAnnexG);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.summary.find((s) => s.annex === "G")?.count).toBe(singleAnnexG.length);
  });
});

describe("validateParsedPayload: code vs codeHierarchy uniqueness", () => {
  it("allows the same real code to recur at a different hierarchy position (Annex E cross-listing)", () => {
    // E0104 "Cerebral Hyperperfusion Syndrome" genuinely appears at both E01|E0104 and E05|E0104
    // in the real 2026 export — confirmed by grepping the source file (4 occurrences of E0104).
    const records = [
      ...singleAnnexE,
      singleAnnexE05Root,
      crossListedE0104UnderE01,
      crossListedE0104UnderE05,
    ];
    const result = parseAndValidate(records);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const underNervous = result.terms.find((t) => t.codeHierarchy === "E01|E0104");
    const underVascular = result.terms.find((t) => t.codeHierarchy === "E05|E0104");
    expect(underNervous).toBeDefined();
    expect(underVascular).toBeDefined();
    expect(underNervous?.id).not.toBe(underVascular?.id);
    expect(underNervous?.code).toBe(underVascular?.code);
  });

  it("rejects a duplicate codehierarchy (the same real record pasted twice)", () => {
    const records = [...singleAnnexA, singleAnnexA[0]];
    const result = parseAndValidate(records);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(
      result.issues.some((i) => i.field === "codehierarchy" && i.message.includes("duplicate")),
    ).toBe(true);
  });
});

describe("validateParsedPayload: structural rejections", () => {
  it("rejects a hierarchy whose parent is not present in the payload", () => {
    // A genuine real record (source line ~44828) whose real parent "G07" is not included here.
    const result = parseAndValidate([orphanedRealRecordG07003]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.issues.some((i) => i.message.includes("G07"))).toBe(true);
  });

  it("rejects a hierarchy whose last segment does not match the record's own code", () => {
    const tampered = { ...singleAnnexA[1], codehierarchy: "A01|A9999" };
    const result = parseAndValidate([singleAnnexA[0], tampered]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.issues.some((i) => i.field === "codehierarchy")).toBe(true);
  });

  it("rejects an empty payload", () => {
    const result = parseAndValidate([]);
    expect(result.ok).toBe(false);
  });

  it("rejects a payload that mixes annexes without any root marker (single-annex mismatch)", () => {
    const mixed = [...singleAnnexD, singleAnnexF[0]];
    const result = parseAndValidate(mixed);
    expect(result.ok).toBe(false);
  });

  it("rejects a release year outside the sane range", () => {
    const result = parseAndValidate(singleAnnexA, 1800);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.issues.some((i) => i.field === "releaseYear")).toBe(true);
  });

  it("rejects a record missing a required field", () => {
    const { term: _term, ...withoutTerm } = singleAnnexA[0];
    const result = parseAndValidate([withoutTerm]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.issues.some((i) => i.field === "term")).toBe(true);
  });
});
