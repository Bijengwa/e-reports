import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { generateTempPassword, hashPassword } from "../../../auth/password.js";
import { isUniqueViolation, USERS_EMAIL_UNIQUE } from "../../../db/unique-violation.js";
import { currentSession } from "../session-guard.js";
import {
  ASSIGNABLE_ROLES,
  type AssignableRole,
  NewUserPage,
  type StaffUser,
  UserCreatedPage,
  UsersPage,
} from "../views/users.js";

const INVALID = "Enter a full name, a valid email address, and a role.";
const EMAIL_TAKEN = "A user with that email already exists.";

/**
 * The submitted account, and the whole of what an administrator may decide about it.
 *
 * `role` is parsed against the two assignable roles rather than against the database enum, and
 * that is the only thing standing between this form and privilege escalation: `administrator` is
 * not a value this schema can produce, so no amount of editing the POST body reaches the insert
 * with it. The `<select>` upstream offers the same two, but a control is a convenience and this
 * is the check.
 *
 * The address is normalized exactly as `createAdmin` and sign-in normalize it. Stored with a
 * capital, it would be an account its owner could not sign into; stored unnormalized, `A@x` and
 * `a@x` would become two rows and the unique index would never fire.
 */
const Submitted = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  name: z.string().trim().min(1).max(200),
  role: z.enum(ASSIGNABLE_ROLES),
});

/** A refused submission is re-rendered with what was typed, so nothing has to be retyped. */
function echoed(body: unknown): { email: string; name: string; role: AssignableRole | undefined } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const asText = (value: unknown) => (typeof value === "string" ? value : "");

  return {
    email: asText(raw.email),
    name: asText(raw.name),
    // Never echoed unless it is a role the form can actually offer, so a hand-edited value
    // cannot be reflected into the markup as a selected option.
    role: ASSIGNABLE_ROLES.find((assignable) => assignable === raw.role),
  };
}

/**
 * Creating and listing staff accounts.
 *
 * Registered in the administrator-only scope. Nothing here re-checks the role: the guard on that
 * scope has already run, and a second check inside the handler would be a second rule free to
 * disagree with the first.
 */
export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.get("/users", async (_request, reply) => {
    // `password_hash` is deliberately not selected. A view cannot leak a column it was never
    // handed, and this is cheaper to keep true than a rule about what views may render.
    const rows = await app.db.execute(sql`
      SELECT email, full_name, role, is_active, must_change_password, created_at, last_sign_in_at
        FROM users
       ORDER BY created_at
    `);

    // snake_case to camelCase at the boundary, as `loadSession` does it. The cast is per row
    // rather than over the whole RowList, which is the shape the driver's types allow.
    const users = rows.map((row): StaffUser => {
      const user = row as {
        email: string;
        full_name: string;
        role: string;
        is_active: boolean;
        must_change_password: boolean;
        created_at: Date;
        last_sign_in_at: Date | null;
      };

      return {
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        isActive: user.is_active,
        mustChangePassword: user.must_change_password,
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at,
      };
    });

    return reply.html(<UsersPage users={users} />);
  });

  app.get("/users/new", async (_request, reply) => reply.html(<NewUserPage />));

  app.post("/users/new", async (request, reply) => {
    const session = currentSession(request);

    const parsed = Submitted.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).html(<NewUserPage error={INVALID} {...echoed(request.body)} />);
    }

    const { email, name, role } = parsed.data;

    // Generated here, never chosen. An administrator who picked the first password would know a
    // credential that outlives the handover; this one is 100 bits from the CSPRNG and is held
    // only by the response below.
    const password = generateTempPassword();
    const passwordHash = await hashPassword(password);

    try {
      await app.db.transaction(async (tx) => {
        const inserted = await tx.execute(sql`
          INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
          VALUES (${email}, ${name}, ${role}::user_role, ${passwordHash}, true, true)
          RETURNING id
        `);

        const { id } = inserted[0] as { id: string };

        // The hash is not in the payload and neither is the password. What the trail records is
        // who was created, by whom, as what — the facts an auditor needs — and nothing that could
        // ever be replayed as a credential.
        await tx.execute(sql`
          INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
          VALUES (
            ${session.userId}, 'user.created', 'user', ${id},
            ${JSON.stringify({ email, fullName: name, role })}::jsonb
          )
        `);
      });
    } catch (error) {
      // The unique index is what decides this, not a SELECT beforehand: two administrators adding
      // the same address at once would both pass a check-then-insert. 409, because the request was
      // well-formed and lost to a conflict — a 500 would blame the database for a duplicate.
      if (isUniqueViolation(error, USERS_EMAIL_UNIQUE)) {
        return reply
          .status(409)
          .html(<NewUserPage error={EMAIL_TAKEN} email={email} name={name} role={role} />);
      }
      throw error;
    }

    // 200 with the page in the body, not the 303 the other POSTs in this door use. The temp
    // password has to reach the administrator exactly once, and a redirect could only carry it
    // in the URL. See `UserCreatedPage`.
    return reply.html(
      <UserCreatedPage email={email} fullName={name} role={role} password={password} />,
    );
  });
}
