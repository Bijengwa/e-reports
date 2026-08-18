import { sql } from "drizzle-orm";
import { z } from "zod";
import { generateTempPassword, hashPassword } from "../auth/password.js";
import type { Database } from "../db/client.js";
import type { CommandResult } from "./result.js";

const InputSchema = z.object({
  // Normalized the same way createAdmin normalizes it, or a reset would miss the row that a
  // differently-cased address created.
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

/**
 * Break glass: puts a new temporary password on any account and ends its sessions.
 *
 * Deleting the sessions is the half that matters. A reset that left them alive would tell the
 * operator the account was locked out while whoever was already signed in stayed signed in. That
 * only works because every staff session is a row in `sessions` and the `__Host-` cookie carries
 * nothing but an opaque id — the contract the login slice must not break.
 *
 * It is not restricted to administrators. The operator already holds DATABASE_URL, so restricting
 * it would remove legitimate use without removing any capability.
 *
 * There is no constraint-violation handling here, unlike createAdmin: this command inserts no
 * user and touches no unique index, so every database error it can raise is unexpected by
 * definition. Those propagate, and the entry point maps them to exit 3.
 */
export async function resetPassword(
  db: Database,
  input: { email: string },
): Promise<CommandResult> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "invalid", message: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const { email } = parsed.data;
  const password = generateTempPassword();
  const passwordHash = await hashPassword(password);

  return db.transaction(async (tx) => {
    const found = await tx.execute(sql`
      SELECT id, is_active FROM users WHERE email = ${email}
    `);

    if (found.length === 0) {
      return { status: "refused", message: "No user with that email." };
    }

    const user = found[0] as { id: string; is_active: boolean };

    // A reset that cannot be used is a trap. Better the operator learns now than after reading a
    // password down a phone line. Reactivation is a separate job and is not part of this slice.
    if (!user.is_active) {
      return {
        status: "refused",
        message: "That account is deactivated. Reactivate it before resetting the password.",
      };
    }

    await tx.execute(sql`
      UPDATE users
      SET password_hash = ${passwordHash}, must_change_password = true
      WHERE id = ${user.id}
    `);

    await tx.execute(sql`DELETE FROM sessions WHERE user_id = ${user.id}`);

    await tx.execute(sql`
      INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
      VALUES (NULL, 'user.password_reset', 'user', ${user.id}, ${JSON.stringify({ email })}::jsonb)
    `);

    return { status: "ok", message: `Password reset for ${email}.`, password };
  });
}
