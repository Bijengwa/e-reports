import { describe, expect, it } from "vitest";
import {
  generateTempPassword,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_LENGTH,
  verifyAgainstAbsentUser,
  verifyPassword,
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

describe("verifyPassword", () => {
  it("accepts the password that produced the hash", async () => {
    const stored = await hashPassword("correct horse battery staple");

    expect(await verifyPassword(stored, "correct horse battery staple")).toBe(true);
  });

  it("rejects a different password", async () => {
    const stored = await hashPassword("correct horse battery staple");

    expect(await verifyPassword(stored, "Correct horse battery staple")).toBe(false);
  });

  it("returns false rather than throwing on a hash it did not produce", async () => {
    // The integration fixtures seed rows whose password_hash is the literal "not-a-real-hash".
    // Sign-in must fail for those rows, not crash the door.
    await expect(verifyPassword("not-a-real-hash", "anything")).resolves.toBe(false);
    await expect(verifyPassword("", "anything")).resolves.toBe(false);
  });
});

describe("verifyAgainstAbsentUser", () => {
  it("resolves without throwing, whatever it is given", async () => {
    await expect(verifyAgainstAbsentUser("anything at all")).resolves.toBeUndefined();
  });

  it("costs about as much as a real verification", async () => {
    // The point of the call is that an unknown address is not visibly faster than a known one.
    // The bound is loose on purpose: this asserts the work happens, not how fast the machine is.
    const stored = await hashPassword("a real password");

    const realStart = performance.now();
    await verifyPassword(stored, "a real password");
    const real = performance.now() - realStart;

    const absentStart = performance.now();
    await verifyAgainstAbsentUser("a real password");
    const absent = performance.now() - absentStart;

    expect(absent).toBeGreaterThan(real / 4);
  });
});

describe("MIN_PASSWORD_LENGTH", () => {
  it("is the one number the form and the server both read", () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(12);
  });
});
