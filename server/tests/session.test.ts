import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashSessionToken,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "../src/auth/session.js";

describe("SESSION_COOKIE", () => {
  it("carries the __Host- prefix", () => {
    expect(SESSION_COOKIE.startsWith("__Host-")).toBe(true);
  });
});

describe("SESSION_COOKIE_OPTIONS", () => {
  // The browser refuses a __Host- cookie that breaks any of these, so getting one wrong means
  // sign-in silently never persists.
  it("satisfies every condition the __Host- prefix imposes", () => {
    expect(SESSION_COOKIE_OPTIONS.path).toBe("/");
    expect(SESSION_COOKIE_OPTIONS.secure).toBe(true);
    expect(SESSION_COOKIE_OPTIONS).not.toHaveProperty("domain");
  });

  it("keeps the cookie out of JavaScript and off cross-site posts", () => {
    expect(SESSION_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(SESSION_COOKIE_OPTIONS.sameSite).toBe("lax");
  });

  it("sets no lifetime of its own", () => {
    // The sessions row is the only clock. A Max-Age here would be a second one, free to disagree.
    expect(SESSION_COOKIE_OPTIONS).not.toHaveProperty("maxAge");
    expect(SESSION_COOKIE_OPTIONS).not.toHaveProperty("expires");
  });
});

describe("generateSessionToken", () => {
  it("is url-safe, so it survives a Set-Cookie unescaped", () => {
    expect(generateSessionToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("carries at least 256 bits", () => {
    // 32 bytes in base64url is 43 characters.
    expect(generateSessionToken().length).toBeGreaterThanOrEqual(43);
  });

  it("does not repeat itself", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateSessionToken()));

    expect(tokens.size).toBe(500);
  });

  it("is opaque — it encodes nothing", () => {
    // A JWT would show three dot-separated base64 segments here. Nothing about the user may be
    // recoverable from the cookie; the sessions row is the only place the identity lives.
    expect(generateSessionToken()).not.toContain(".");
  });
});

describe("hashSessionToken", () => {
  it("returns a hex sha256 digest", () => {
    expect(hashSessionToken("token")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable, so the same cookie finds the same row", () => {
    expect(hashSessionToken("token")).toBe(hashSessionToken("token"));
  });

  it("does not contain the token it hashed", () => {
    const token = generateSessionToken();

    expect(hashSessionToken(token)).not.toContain(token);
  });
});
