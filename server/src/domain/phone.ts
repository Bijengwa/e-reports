/**
 * Tanzanian mobile numbers.
 *
 * The reporter types nine digits and the `+255` is fixed furniture beside the box, so the number
 * cannot be entered in five different shapes. But the form is a plain HTML POST — anything can
 * post here, and a reporter pasting `0712 345 678` from their contacts is doing the obvious
 * thing — so the server accepts every reasonable spelling and normalises rather than rejecting.
 *
 * Storage is always E.164 (`+255712345678`): TMDA sends the report number by SMS, and a gateway
 * needs one canonical form, not whatever the reporter happened to type.
 */

export const PHONE_COUNTRY_CODE = "+255";

/** Nine digits, opening with 7 (most networks) or 6 (Halotel and newer ranges). */
export const PHONE_LOCAL_LENGTH = 9;

/** Shared with the `pattern` attribute so the browser enforces exactly what the server does. */
export const PHONE_LOCAL_PATTERN = "[67][0-9]{8}";

const LOCAL_RE = /^[67][0-9]{8}$/;

/**
 * Best-effort reduction of anything the reporter typed to the nine national digits.
 *
 * Deliberately does not validate: the view uses this to re-display what was submitted, and a
 * reporter who typed something wrong must see their own mistake, not an empty box.
 */
export function localPhoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");

  // +255 712 345 678 / 255712345678
  if (digits.startsWith("255") && digits.length > PHONE_LOCAL_LENGTH) {
    return digits.slice(3);
  }

  // 0712 345 678 — the leading zero is the national trunk prefix and is dropped in E.164.
  if (digits.startsWith("0") && digits.length > PHONE_LOCAL_LENGTH) {
    return digits.slice(1);
  }

  return digits;
}

/**
 * The number in E.164, or null when it is not a Tanzanian mobile.
 *
 * Null rather than a thrown error: a bad phone number is a message to the reporter, not an
 * exceptional condition.
 */
export function normalizePhone(raw: string): string | null {
  const local = localPhoneDigits(raw.trim());
  return LOCAL_RE.test(local) ? `${PHONE_COUNTRY_CODE}${local}` : null;
}

export function isValidPhone(raw: string): boolean {
  return normalizePhone(raw) !== null;
}
