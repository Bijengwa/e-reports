import { sql } from "drizzle-orm";
import { z } from "zod";
import { generateTempPassword, hashPassword } from "../auth/password.js";
import type { Database } from "../db/client.js";
import type { CommandResult } from "./result.js";

/**
 * Arbitrary but permanent. Changing it reopens the race it exists to close, because two
 * processes holding different keys do not exclude one another.
 */
export const ADMIN_BOOTSTRAP_LOCK_KEY = 4_170_825_113n;

const InputSchema = z.object({
  // Normalized before validation and before the unique index sees it. Without this,
  // A@tmda.go.tz and a@tmda.go.tz become two rows and 23505 never fires.
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(1),
});

/**
 * Recognises a duplicate address, through two layers.
 *
 * postgres.js maps the wire protocol's `n` field to `constraint_name` — there is no `constraint`
 * property, whatever the surrounding ecosystem suggests. Drizzle then wraps driver errors in its
 * own query error, so the PostgresError arrives as a `cause` rather than as the thrown value.
 * Reading `error.code` directly finds `undefined` and the collision is misreported as a crash.
 *
 * The chain is walked rather than unwrapped once, so an extra layer of wrapping in a future
 * Drizzle release does not silently reintroduce that bug. Depth is capped because a `cause` that
 * points at itself would otherwise spin.
 */
function isEmailTaken(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { code?: string; constraint_name?: string; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint_name === "users_email_unique") {
      return true;
    }
    current = candidate.cause;
  }

  return false;
}

/**
 * Creates the first administrator, once.
 *
 * `INSERT ... WHERE NOT EXISTS` is not race-free on its own: under READ COMMITTED the subquery
 * takes no lock, because there is no row to lock. The advisory lock is what closes that window,
 * and it is released when the transaction ends.
 */
export async function createAdmin(
  db: Database,
  input: { email: string; name: string },
): Promise<CommandResult> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "invalid", message: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const { email, name } = parsed.data;
  const password = generateTempPassword();
  const passwordHash = await hashPassword(password);

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADMIN_BOOTSTRAP_LOCK_KEY})`);

      const inserted = await tx.execute(sql`
        INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
        SELECT ${email}, ${name}, 'administrator', ${passwordHash}, true, true
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'administrator')
        RETURNING id
      `);

      if (inserted.length === 0) {
        return {
          status: "refused",
          message: "An administrator already exists. Bootstrap is closed.",
        };
      }

      const { id } = inserted[0] as { id: string };

      await tx.execute(sql`
        INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
        VALUES (
          NULL, 'user.bootstrap_created', 'user', ${id},
          ${JSON.stringify({ email, fullName: name, role: "administrator" })}::jsonb
        )
      `);

      return { status: "ok", message: `Administrator ${email} created.`, password };
    });
  } catch (error) {
    // The bootstrap guard can pass while the address collides with a non-administrator. Saying
    // "bootstrap is closed" there would be a lie, and exit 3 would claim the database is broken.
    if (isEmailTaken(error)) {
      return { status: "refused", message: "A user with that email already exists." };
    }
    throw error;
  }
}
