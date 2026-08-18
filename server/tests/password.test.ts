import { describe, expect, it } from "vitest";
import {
  generateTempPassword,
  hashPassword,
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_LENGTH,
} from "../src/auth/password.js";

describe("temporary password alphabet", () => {
  // These properties are the reason the byte mapping is unbiased: 256 is an exact
  // multiple of 32. Asserting them directly beats a chi-square test over samples.
  it("has exactly 32 distinct characters", () => {
    expect(TEMP_PASSWORD_ALPHABET).toHaveLength(32);
    expect(new Set(TEMP_PASSWORD_ALPHABET).size).toBe(32);
  });

  it("omits the letters that are misread when spoken", () => {
    for (const letter of ["I", "L", "O", "U"]) {
      expect(TEMP_PASSWORD_ALPHABET).not.toContain(letter);
    }
  });
});

describe("generateTempPassword", () => {
  it("returns the configured length", () => {
    expect(generateTempPassword()).toHaveLength(TEMP_PASSWORD_LENGTH);
  });

  it("draws only from the alphabet", () => {
    for (const character of generateTempPassword()) {
      expect(TEMP_PASSWORD_ALPHABET).toContain(character);
    }
  });

  it("does not repeat itself", () => {
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });
});

describe("hashPassword", () => {
  it("returns an Argon2id PHC string", async () => {
    expect(await hashPassword("correct horse battery staple")).toMatch(/^\$argon2id\$/);
  });

  it("salts, so the same input hashes differently each time", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});
