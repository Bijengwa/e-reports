import { randomBytes } from "node:crypto";
import { type Algorithm, hash, hashSync, verify } from "@node-rs/argon2";

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

/**
 * Shortest password a user may choose for themselves.
 *
 * Exported because the change-password form renders its `minlength` from it. A browser rule that
 * disagrees with the server's rule is either a lie to the user or a hole in the check, and this
 * module already treats parameters that drift apart as the thing to prevent.
 *
 * It does not apply to `generateTempPassword`, which is longer and machine-chosen.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * A hash of a fixed string, so an unknown email costs the same as a known one.
 *
 * Sign-in that skips the Argon2 work when no such user exists answers visibly sooner, and that
 * difference alone enumerates staff addresses. Computed once at import — one hash's worth of
 * startup time, paid at boot rather than on every request.
 */
const ABSENT_USER_HASH = hashSync("no account has this password", ARGON2_OPTIONS);

/**
 * Check a password against a stored Argon2id hash.
 *
 * Returns false rather than throwing when the stored value is not a hash this module produced.
 * A row whose `password_hash` is a placeholder must fail sign-in like any wrong password; letting
 * the parse error escape would turn a bad row into a 500, which tells the caller the row exists.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Spend a verification's worth of work and prove nothing.
 *
 * Sign-in calls this on the branch where the address matched no active account, so that branch
 * takes about as long as the branch where it did.
 */
export async function verifyAgainstAbsentUser(plain: string): Promise<void> {
  await verifyPassword(ABSENT_USER_HASH, plain);
}
