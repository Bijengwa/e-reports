import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../../src/domain/imdrf/query-service.js";

describe("imdrf query-service cursor helpers", () => {
  it("round-trips a sort_order through encode/decode", () => {
    expect(decodeCursor(encodeCursor(42))).toBe(42);
    expect(decodeCursor(encodeCursor(0))).toBe(0);
  });

  it("treats a missing cursor as the start", () => {
    expect(decodeCursor(undefined)).toBeNull();
  });

  it("treats a malformed or tampered cursor as the start rather than throwing", () => {
    expect(decodeCursor("not-a-real-cursor")).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });
});
