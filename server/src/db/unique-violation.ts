/**
 * The unique index behind a duplicate staff address.
 *
 * Named once because two callers now recognise the same violation: the bootstrap CLI, which
 * creates the first administrator, and the staff door, which creates everyone after them. A
 * constraint name spelled twice is a constraint name that can be renamed in only one of them.
 */
export const USERS_EMAIL_UNIQUE = "users_email_unique";

/**
 * Recognises a unique-constraint violation, through two layers.
 *
 * postgres.js maps the wire protocol's `n` field to `constraint_name` — there is no `constraint`
 * property, whatever the surrounding ecosystem suggests. Drizzle then wraps driver errors in its
 * own query error, so the PostgresError arrives as a `cause` rather than as the thrown value.
 * Reading `error.code` directly finds `undefined` and the collision is misreported as a crash.
 *
 * The chain is walked rather than unwrapped once, so an extra layer of wrapping in a future
 * Drizzle release does not silently reintroduce that bug. Depth is capped because a `cause` that
 * points at itself would otherwise spin.
 *
 * The constraint is compared, not just the code: 23505 says only "some unique index rejected
 * this", and treating any of them as "that email is taken" would name the wrong collision the
 * moment the table grows a second unique index.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;

  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { code?: string; constraint_name?: string; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint_name === constraint) {
      return true;
    }
    current = candidate.cause;
  }

  return false;
}
