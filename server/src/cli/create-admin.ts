import { sql } from "drizzle-orm";
import { z } from "zod";
import { generateTempPassword, hashPassword } from "../auth/password.js";
import type { Database } from "../db/client.js";
import { isUniqueViolation, USERS_EMAIL_UNIQUE } from "../db/unique-violation.js";
import type { CommandResult } from "./result.js";

/**
 * Arbitrary but permanent. Changing it reopens the race it exists to close, because two
 * processes holding different keys do not exclude one another.
 */
export const ADMIN_BOOTSTRAP_LOCK_KEY = 4_170_825_113n;

/**
 * How many administrators may exist at once.
 *
 * Two, so the office is never one forgotten password away from having nobody who can add staff.
 * No more than two, because each one is another account that can create staff and reset anyone's
 * credentials, and the point of a limit is that the number of those accounts is known.
 *
 * A constant rather than configuration, deliberately: an environment variable would let the limit
 * differ between staging and production, and the safe number is not a deployment decision.
 */
export const MAX_ADMINISTRATORS = 2;

const InputSchema = z.object({
  // Normalized before validation and before the unique index sees it. Without this,
  // A@tmda.go.tz and a@tmda.go.tz become two rows and 23505 never fires.
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(1),
});

/**
 * Creates an administrator, up to `MAX_ADMINISTRATORS`.
 *
 * The counting subquery is not race-free on its own: under READ COMMITTED it takes no lock, so
 * two processes at the limit would both read the same count, both find room, and store one more
 * administrator than the limit allows. The advisory lock is what closes that window, and it is
 * released when the transaction ends.
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
        WHERE (SELECT count(*) FROM users WHERE role = 'administrator') < ${MAX_ADMINISTRATORS}
        RETURNING id
      `);

      if (inserted.length === 0) {
        return {
          status: "refused",
          message: `The administrator limit of ${MAX_ADMINISTRATORS} is already reached.`,
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
    // The limit can have room while the address collides with an existing user. Reporting a
    // reached limit there would be a lie, and exit 3 would claim the database is broken.
    if (isUniqueViolation(error, USERS_EMAIL_UNIQUE)) {
      return { status: "refused", message: "A user with that email already exists." };
    }
    throw error;
  }
}
