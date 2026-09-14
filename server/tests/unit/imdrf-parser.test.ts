import { describe, expect, it } from "vitest";
import { MAX_PAYLOAD_BYTES, describePayloadShape, parseImdrfPayload } from "../../src/domain/imdrf/parser.js";
import {
  consolidatedAnnexA,
  consolidatedFragment,
  singleAnnexA,
  singleAnnexC,
  singleAnnexE,
} from "../fixtures/imdrf-real-fragments.js";

describe("parseImdrfPayload", () => {
  it("parses the real consolidated Annexes A-G export as a bare top-level array", () => {
    const parsed = parseImdrfPayload(JSON.stringify(consolidatedFragment));
    expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(parsed.rows).toHaveLength(consolidatedFragment.length);
    expect(parsed.shape).toBe("consolidated");
    expect(parsed.annexesFound).toEqual(new Set(["A", "B", "G"]));
  });

  it("derives each row's annex from the first character of its own code, for every real shape", () => {
    const parsed = parseImdrfPayload(JSON.stringify(consolidatedAnnexA));
    expect(parsed.rows.map((r) => r.annex)).toEqual(["A", "A", "A", "A"]);
    // the bare annex-root record itself ("A", codehierarchy "A") is included, not skipped
    const root = parsed.rows.find((r) => r.code === "A");
    expect(root?.codeHierarchy).toBe("A");
  });

  it("parses a real single-annex export (no root marker record) as shape single-annex", () => {
    const parsed = parseImdrfPayload(JSON.stringify(singleAnnexA));
    expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(parsed.shape).toBe("single-annex");
    expect(parsed.annexesFound).toEqual(new Set(["A"]));
    // real single-annex hierarchies start at the first real code, never a bare letter
    expect(parsed.rows.every((r) => r.codeHierarchy !== "A")).toBe(true);
  });

  it("matches non-IMDRF code / status description fields case-insensitively across the two real spellings", () => {
    const consolidated = parseImdrfPayload(JSON.stringify(consolidatedAnnexA));
    expect(consolidated.rows.find((r) => r.code === "A01")?.nonImdrfCode).toBe(
      "MedDRA:10092649:Patient-device interaction issue",
    );
    const singleAnnex = parseImdrfPayload(JSON.stringify(singleAnnexE));
    // singleAnnexE spells the field "non-imdrf code" (lowercase) — same output field.
    expect(singleAnnex.rows.find((r) => r.code === "E0101")?.nonImdrfCode).toBe(
      "MedDRA:10049848:Balance disorder",
    );
  });

  it("captures primary/secondary category when the real record has them (Annex E only)", () => {
    const parsed = parseImdrfPayload(JSON.stringify(singleAnnexE));
    const brainInjury = parsed.rows.find((r) => r.code === "E0102");
    expect(brainInjury?.primaryCategory).toBe("Nervous System");
    expect(brainInjury?.secondaryCategory).toBe("Injury");
  });

  it("rejects invalid JSON with a structural error instead of throwing", () => {
    const parsed = parseImdrfPayload("{ not json");
    expect(parsed.issues.some((i) => i.severity === "error")).toBe(true);
    expect(parsed.rows).toEqual([]);
  });

  it("rejects a payload that is a JSON object rather than a bare array (the old invented wrapper shape)", () => {
    const parsed = parseImdrfPayload(
      JSON.stringify({ releaseYear: 2026, annexes: { A: consolidatedAnnexA } }),
    );
    expect(parsed.issues.some((i) => i.severity === "error")).toBe(true);
    expect(parsed.rows).toEqual([]);
  });

  it("rejects an empty array", () => {
    const parsed = parseImdrfPayload("[]");
    expect(parsed.issues.some((i) => i.severity === "error")).toBe(true);
    expect(parsed.rows).toEqual([]);
  });

  it("reports a malformed (non-object) record by index without discarding the rest of the array", () => {
    const withJunk = [consolidatedAnnexA[0], "not a record", consolidatedAnnexA[1]];
    const parsed = parseImdrfPayload(JSON.stringify(withJunk));
    expect(parsed.issues.some((i) => i.severity === "error" && i.index === 2)).toBe(true);
    expect(parsed.rows.map((r) => r.code)).toEqual(["A", "A01"]);
  });

  it("rejects a payload whose byte size exceeds MAX_PAYLOAD_BYTES before attempting JSON.parse", () => {
    const huge = "x".repeat(MAX_PAYLOAD_BYTES + 1024);
    const parsed = parseImdrfPayload(huge);
    expect(parsed.issues.some((i) => i.severity === "error" && i.message.includes("MB"))).toBe(true);
    expect(parsed.rows).toEqual([]);
  });

  it("rejects a single-annex payload that silently contains a record from a different annex", () => {
    // Real Annex C records plus one real Annex A record spliced in — the kind of mistake an
    // administrator pasting the wrong file section could make.
    const mixed = [...singleAnnexC, singleAnnexA[0]];
    const parsed = parseImdrfPayload(JSON.stringify(mixed));
    expect(parsed.shape).toBe("single-annex");
    const mismatch = parsed.issues.find((i) => i.severity === "error" && i.annex === "A");
    expect(mismatch).toBeDefined();
    expect(mismatch?.message).toContain("Annex A");
    expect(mismatch?.message).toContain("Annex C");
  });

  it("does not flag a mismatch for the real consolidated export, which legitimately spans several annexes", () => {
    const parsed = parseImdrfPayload(JSON.stringify(consolidatedFragment));
    expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("describePayloadShape", () => {
  it("describes a consolidated payload by the annexes actually found", () => {
    expect(describePayloadShape("consolidated", new Set(["A", "B", "G"]))).toBe(
      "Consolidated Annexes A-B-G",
    );
  });

  it("describes a single-annex payload by its one annex letter", () => {
    expect(describePayloadShape("single-annex", new Set(["C"]))).toBe("Annex C");
  });

  it("describes an unrecognized payload", () => {
    expect(describePayloadShape(null, new Set())).toBe("Unrecognized payload");
  });
});
