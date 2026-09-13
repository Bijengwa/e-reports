import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../../src/domain/imdrf/query-service.js";

describe("imdrf query-service cursor helpers", () => {
  it("round-trips a composite {sortOrder, id} cursor through encode/decode", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(decodeCursor(encodeCursor({ sortOrder: 42, id }))).toEqual({ sortOrder: 42, id });
    expect(decodeCursor(encodeCursor({ sortOrder: 0, id }))).toEqual({ sortOrder: 0, id });
  });

  it("treats a missing cursor as the start", () => {
    expect(decodeCursor(undefined)).toBeNull();
  });

  it("treats a malformed or tampered cursor as the start rather than throwing", () => {
    expect(decodeCursor("not-a-real-cursor")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    // Valid base64url, but not JSON at all.
    expect(decodeCursor(Buffer.from("not json", "utf8").toString("base64url"))).toBeNull();
  });

  it("rejects a decoded value missing sortOrder or id", () => {
    expect(
      decodeCursor(Buffer.from(JSON.stringify({ id: "x" }), "utf8").toString("base64url")),
    ).toBeNull();
    expect(
      decodeCursor(Buffer.from(JSON.stringify({ sortOrder: 1 }), "utf8").toString("base64url")),
    ).toBeNull();
  });

  it("rejects a decoded value whose sortOrder is not an integer", () => {
    expect(
      decodeCursor(
        Buffer.from(JSON.stringify({ sortOrder: 1.5, id: "x" }), "utf8").toString("base64url"),
      ),
    ).toBeNull();
    expect(
      decodeCursor(
        Buffer.from(JSON.stringify({ sortOrder: "1", id: "x" }), "utf8").toString("base64url"),
      ),
    ).toBeNull();
  });
});
