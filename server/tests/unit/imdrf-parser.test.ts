import { describe, expect, it } from "vitest";
import { MAX_PAYLOAD_BYTES, parseImdrfPayload } from "../../src/domain/imdrf/parser.js";

function payloadOf(annexes: Record<string, unknown[]>, releaseYear = 2026): string {
  return JSON.stringify({
    releaseYear,
    documentCode: "IMDRF/AE WG/N43",
    title: "IMDRF Adverse Event Terminology",
    annexes,
  });
}

const rootTerm = {
  term: "Root Term",
  code: "A01",
  definition: "def",
  codeHierarchy: "A01",
};
const childTerm = {
  term: "Child Term",
  code: "A0101",
  definition: "def2",
  codeHierarchy: "A01|A0101",
};
const grandchildTerm = {
  term: "Grandchild Term",
  code: "A010101",
  definition: "def3",
  status: "Retired (2020)",
  statusDescription: "no longer used",
  codeHierarchy: "A01|A0101|A010101",
};

describe("parseImdrfPayload", () => {
  it("parses a well-formed payload into flat rows keyed by annex", () => {
    const parsed = parseImdrfPayload(payloadOf({ A: [rootTerm, childTerm, grandchildTerm] }));
    expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.every((r) => r.annex === "A")).toBe(true);
  });

  it("maps camelCase and snake_case field variants to the same output field", () => {
    const parsed = parseImdrfPayload(
      payloadOf({
        C: [
          {
            term: "Root",
            code: "C01",
            codeHierarchy: "C01",
            non_imdrf_code: "MedDRA:1:x",
          },
        ],
      }),
    );
    expect(parsed.rows[0]?.nonImdrfCode).toBe("MedDRA:1:x");
  });

  it("captures Primary/Secondary Category when the record has them", () => {
    const parsed = parseImdrfPayload(
      payloadOf({
        E: [
          {
            term: "Nervous System",
            code: "E01",
            codeHierarchy: "E01",
            primaryCategory: "Nervous System",
          },
        ],
      }),
    );
    expect(parsed.rows[0]?.primaryCategory).toBe("Nervous System");
  });

  it("rejects invalid JSON with a structural error instead of throwing", () => {
    const parsed = parseImdrfPayload("{ not json");
    expect(parsed.issues.some((i) => i.severity === "error")).toBe(true);
    expect(parsed.rows).toEqual([]);
  });

  it("rejects a payload that is not a JSON object", () => {
    const parsed = parseImdrfPayload("[1, 2, 3]");
    expect(parsed.issues.some((i) => i.severity === "error")).toBe(true);
  });

  it("requires releaseYear to be a whole number", () => {
    const parsed = parseImdrfPayload(JSON.stringify({ releaseYear: "2026", annexes: {} }));
    expect(parsed.issues.some((i) => i.field === "releaseYear")).toBe(true);
    expect(parsed.releaseYearsFound.size).toBe(0);
  });

  it("requires annexes to be an object", () => {
    const parsed = parseImdrfPayload(JSON.stringify({ releaseYear: 2026, annexes: [] }));
    expect(parsed.issues.some((i) => i.field === "annexes")).toBe(true);
  });

  it("rejects an annex key outside A-G", () => {
    const parsed = parseImdrfPayload(payloadOf({ H: [rootTerm] }));
    expect(parsed.issues.some((i) => i.field === "annexes")).toBe(true);
  });

  it("records the release year the payload declares, for cross-checking against the import target", () => {
    const parsed = parseImdrfPayload(payloadOf({ A: [rootTerm] }, 2026));
    expect(parsed.releaseYearsFound).toEqual(new Set([2026]));
  });

  it("converts empty/missing optional fields to null rather than empty strings", () => {
    const parsed = parseImdrfPayload(payloadOf({ A: [rootTerm] }));
    const root = parsed.rows.find((r) => r.code === "A01");
    expect(root?.nonImdrfCode).toBeNull();
    expect(root?.status).toBeNull();
  });

  it("preserves source row ordering via sourceOrder", () => {
    const parsed = parseImdrfPayload(payloadOf({ A: [rootTerm, childTerm, grandchildTerm] }));
    expect(parsed.rows.map((r) => r.sourceOrder)).toEqual([0, 1, 2]);
    expect(parsed.rows.map((r) => r.code)).toEqual(["A01", "A0101", "A010101"]);
  });

  it("records every annex key present in annexesFound, even one with an empty array", () => {
    const parsed = parseImdrfPayload(payloadOf({ A: [rootTerm], G: [] }));
    expect(parsed.annexesFound).toEqual(new Set(["A", "G"]));
    expect(parsed.rows.filter((r) => r.annex === "G")).toHaveLength(0);
  });

  it("reports a malformed (non-object) record without discarding the rest of the annex", () => {
    const parsed = parseImdrfPayload(payloadOf({ A: [rootTerm, "not a record", childTerm] }));
    expect(parsed.issues.some((i) => i.severity === "error" && i.row === 2)).toBe(true);
    expect(parsed.rows.map((r) => r.code)).toEqual(["A01", "A0101"]);
  });

  it("rejects a payload whose byte size exceeds MAX_PAYLOAD_BYTES before attempting JSON.parse", () => {
    const huge = "x".repeat(MAX_PAYLOAD_BYTES + 1024);
    const parsed = parseImdrfPayload(huge);
    expect(parsed.issues.some((i) => i.severity === "error" && i.message.includes("MB"))).toBe(
      true,
    );
    expect(parsed.rows).toEqual([]);
  });
});
