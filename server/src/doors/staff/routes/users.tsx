import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { generateTempPassword, hashPassword } from "../../../auth/password.js";
import { isUniqueViolation, USERS_EMAIL_UNIQUE } from "../../../db/unique-violation.js";
import { currentSession } from "../session-guard.js";
import {
  ASSIGNABLE_ROLES,
  type AssignableRole,
  NewUserPage,
  PasswordResetPage,
  type StaffUser,
  UserCreatedPage,
  UsersPage,
} from "../views/users.js";

const INVALID = "Enter a full name, a valid email address, and a role.";
const EMAIL_TAKEN = "A user with that email already exists.";
const NOT_FOUND = "That account no longer exists.";
const SELF_RESET = "You cannot reset your own password here. Use the change-password page.";
const SELF_DEACTIVATE = "You cannot deactivate your own account.";
const RESET_DEACTIVATED = "That account is deactivated. Reactivate it before resetting.";

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

/**
 * The account an action names, parsed before it reaches a query.
 *
 * `users.id` is a uuid column, so comparing it against arbitrary path text would raise 22P02 and
 * surface as a 500 — a malformed id would report a broken database rather than a wrong address.
 * Anything that is not a uuid is simply not an account, which is a 404.
 */
const TargetId = z.uuid();

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
 * Every staff account, as the list needs it.
 *
 * `password_hash` is deliberately not selected. A view cannot leak a column it was never handed,
 * and this is cheaper to keep true than a rule about what views may render.
 */
async function loadStaffUsers(app: FastifyInstance, selfId: string): Promise<StaffUser[]> {
  const rows = await app.db.execute(sql`
    SELECT id, email, full_name, role, is_active, must_change_password, created_at, last_sign_in_at
      FROM users
     ORDER BY created_at
  `);

  // snake_case to camelCase at the boundary, as `loadSession` does it. The cast is per row
  // rather than over the whole RowList, which is the shape the driver's types allow.
  return rows.map((row): StaffUser => {
    const user = row as {
      id: string;
      email: string;
      full_name: string;
      role: string;
      is_active: boolean;
      must_change_password: boolean;
      created_at: Date;
      last_sign_in_at: Date | null;
    };

    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      isActive: user.is_active,
      mustChangePassword: user.must_change_password,
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at,
      isSelf: user.id === selfId,
    };
  });
}

/**
 * The list, with an optional refusal over it.
 *
 * Every way an action can be refused ends here rather than on a page of its own. The administrator
 * is told what happened without losing the table they were working from, and the status code still
 * says which refusal it was.
 */
async function renderUsers(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  error?: string,
): Promise<void> {
  const session = currentSession(request);
  const users = await loadStaffUsers(app, session.userId);

  reply
    .status(status)
    .html(
      <UsersPage
        users={users}
        error={error}
        viewerRole={session.role}
        viewerName={session.fullName}
      />,
    );
}

/**
 * Creating, listing and administering staff accounts.
 *
 * Registered in the administrator-only scope. Nothing here re-checks the role: the guard on that
 * scope has already run, and a second check inside the handler would be a second rule free to
 * disagree with the first. What the handlers do re-check is the target — that is a different
 * question from the reader's role, and a page that draws no button is not what enforces it.
 */
export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.get("/users", async (request, reply) => renderUsers(app, request, reply, 200));

  app.get("/users/new", async (request, reply) =>
    reply.html(
      <NewUserPage
        viewerRole={currentSession(request).role}
        viewerName={currentSession(request).fullName}
      />,
    ),
  );

  app.post("/users/new", async (request, reply) => {
    const session = currentSession(request);

    const parsed = Submitted.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(422)
        .html(
          <NewUserPage
            error={INVALID}
            viewerRole={session.role}
            viewerName={session.fullName}
            {...echoed(request.body)}
          />,
        );
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
          .html(
            <NewUserPage
              error={EMAIL_TAKEN}
              email={email}
              name={name}
              role={role}
              viewerRole={session.role}
              viewerName={session.fullName}
            />,
          );
      }
      throw error;
    }

    // 200 with the page in the body, not the 303 the other POSTs in this door use. The temp
    // password has to reach the administrator exactly once, and a redirect could only carry it
    // in the URL. See `UserCreatedPage`.
    return reply.html(
      <UserCreatedPage
        email={email}
        fullName={name}
        role={role}
        password={password}
        viewerRole={session.role}
        viewerName={session.fullName}
      />,
    );
  });

  /**
   * Break glass from the web, on the same terms as the CLI.
   *
   * A new temporary password, the forced-change flag back up, and every session on that account
   * deleted. The deletion is the half that matters: a reset that left them alive would tell the
   * administrator the account was locked out while whoever was already signed in stayed signed in.
   *
   * Unlike the CLI, the trail names an actor. The operator running a CLI reset holds DATABASE_URL
   * and is not a row in `users`, so that path writes NULL; this path knows exactly who clicked.
   */
  app.post("/users/:id/reset", async (request, reply) => {
    const session = currentSession(request);

    const target = TargetId.safeParse((request.params as { id: string }).id);
    if (!target.success) return renderUsers(app, request, reply, 404, NOT_FOUND);

    // Checked here as well as being undrawn in the list. The page not offering a button is a
    // convenience; this is the rule.
    if (target.data === session.userId) {
      return renderUsers(app, request, reply, 403, SELF_RESET);
    }

    const password = generateTempPassword();
    const passwordHash = await hashPassword(password);

    const outcome = await app.db.transaction(async (tx) => {
      const found = await tx.execute(sql`
        SELECT email, full_name, is_active FROM users WHERE id = ${target.data}
      `);

      if (found.length === 0) return { status: "missing" } as const;

      const user = found[0] as { email: string; full_name: string; is_active: boolean };

      // The CLI's rule, for the CLI's reason: a reset that cannot be used is a trap, and better
      // the administrator learns now than after reading a password down a phone line.
      if (!user.is_active) return { status: "inactive" } as const;

      await tx.execute(sql`
        UPDATE users
           SET password_hash = ${passwordHash}, must_change_password = true
         WHERE id = ${target.data}
      `);

      await tx.execute(sql`DELETE FROM sessions WHERE user_id = ${target.data}`);

      await tx.execute(sql`
        INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
        VALUES (
          ${session.userId}, 'user.password_reset', 'user', ${target.data},
          ${JSON.stringify({ email: user.email })}::jsonb
        )
      `);

      return { status: "ok", email: user.email, fullName: user.full_name } as const;
    });

    if (outcome.status === "missing") return renderUsers(app, request, reply, 404, NOT_FOUND);
    if (outcome.status === "inactive") {
      return renderUsers(app, request, reply, 409, RESET_DEACTIVATED);
    }

    // 200 in place, for the reason create gives: the password must not reach a URL.
    return reply.html(
      <PasswordResetPage
        email={outcome.email}
        fullName={outcome.fullName}
        password={password}
        viewerRole={session.role}
        viewerName={session.fullName}
      />,
    );
  });

  /**
   * Turning an account off, and on again.
   *
   * Deactivating deletes that account's sessions rather than leaning on `loadSession`, which
   * already refuses an inactive user. The guard alone would end them lazily, on each session's
   * next request, and — the part that matters — a later reactivation would bring a still-valid
   * cookie back to life. Deleting the rows means reactivation restores no one's access silently:
   * they sign in again or they do not get in.
   *
   * Reactivating deletes nothing, because there is nothing to delete. Deactivation removed the
   * rows, and no session can have been opened since — sign-in requires `is_active`.
   *
   * Both answer 303 rather than rendering in place. There is no secret to show, so the
   * post/redirect/get that the password pages cannot use applies here.
   */
  const setActive = async (request: FastifyRequest, reply: FastifyReply, active: boolean) => {
    const session = currentSession(request);

    const target = TargetId.safeParse((request.params as { id: string }).id);
    if (!target.success) return renderUsers(app, request, reply, 404, NOT_FOUND);

    if (target.data === session.userId) {
      return renderUsers(app, request, reply, 403, SELF_DEACTIVATE);
    }

    const outcome = await app.db.transaction(async (tx) => {
      const found = await tx.execute(sql`SELECT email FROM users WHERE id = ${target.data}`);
      if (found.length === 0) return { status: "missing" } as const;

      const { email } = found[0] as { email: string };

      await tx.execute(sql`UPDATE users SET is_active = ${active} WHERE id = ${target.data}`);

      if (!active) {
        await tx.execute(sql`DELETE FROM sessions WHERE user_id = ${target.data}`);
      }

      await tx.execute(sql`
        INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
        VALUES (
          ${session.userId},
          ${active ? "user.reactivated" : "user.deactivated"},
          'user',
          ${target.data},
          ${JSON.stringify({ email })}::jsonb
        )
      `);

      return { status: "ok" } as const;
    });

    if (outcome.status === "missing") return renderUsers(app, request, reply, 404, NOT_FOUND);

    return reply.redirect("/users", 303);
  };

  app.post("/users/:id/deactivate", async (request, reply) => setActive(request, reply, false));

  app.post("/users/:id/reactivate", async (request, reply) => setActive(request, reply, true));
}
