import { randomBytes } from "node:crypto";
import { type Algorithm, hash } from "@node-rs/argon2";

/**
 * `Algorithm.Argon2id` cannot be read directly here.
 *
 * @node-rs/argon2 declares `Algorithm` as an ambient `const enum`, and this project compiles with
 * `verbatimModuleSyntax`, which forbids accessing such a member at runtime (TS2748). The numeric
 * value is part of the package's published API, so it is pinned once, under the name it stands for.
 */
const ARGON2ID = 2 as Algorithm;

/**
 * OWASP's baseline for Argon2id, defined in exactly one place.
 *
 * The login slice will verify against hashes produced here, so it must import these rather than
 * restate them. Parameters that drift between hashing and verification silently reject everyone.
 */
export const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Crockford Base32. `I`, `L`, `O` and `U` are absent, so a password read down a phone line has
 * only one spelling. Exactly 32 characters, which is what makes the mapping below unbiased.
 */
export const TEMP_PASSWORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 20 characters at 5 bits each — 100 bits of entropy. */
export const TEMP_PASSWORD_LENGTH = 20;

export function generateTempPassword(): string {
  const bytes = randomBytes(TEMP_PASSWORD_LENGTH);
  let password = "";

  for (const byte of bytes) {
    // 256 is an exact multiple of 32, so this modulo introduces no bias and needs no
    // rejection sampling.
    password += TEMP_PASSWORD_ALPHABET[byte % TEMP_PASSWORD_ALPHABET.length];
  }

  return password;
}

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}
