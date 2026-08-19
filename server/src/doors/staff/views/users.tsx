import { roleLabel } from "../../../domain/roles.js";
import { StaffShell } from "./shell.js";

/** The roles an administrator may hand out. Never `administrator`. */
export const ASSIGNABLE_ROLES = ["manager", "assessor"] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/**
 * A row of the staff list, as the page needs it.
 *
 * `passwordHash` is absent by construction rather than by discipline: the route's SELECT does not
 * name that column, and this type gives it nowhere to land if someone later adds it back.
 */
export type StaffUser = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  lastSignInAt: Date | null;
  /**
   * Whether this row is the administrator reading the page.
   *
   * Decided in the route by comparing against the session, not by matching on role: there is
   * exactly one administrator today, but "the row that is me" and "the row that is an
   * administrator" are different questions and only the first one protects the right person.
   */
  isSelf: boolean;
};

/** A date an auditor can read, in one place. Null means it has not happened yet. */
function day(value: Date | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "Never";
}

export type UsersPageProps = {
  users: StaffUser[];
  /** A refused action, re-rendered over the list it was refused on. */
  error?: string;
  /**
   * The reader's own role, for the rail.
   *
   * Named apart from the `role` on a row and on the create form, which mean the account's role.
   * Threaded from the session rather than written as "administrator" here: the guard on this
   * scope is what makes that true, and restating it in the view would be a second place for it
   * to stop being true.
   */
  viewerRole: string;
  /** The signed-in person, for the title bar. */
  viewerName: string;
};

/**
 * Every staff account.
 *
 * The temp password issued at creation is deliberately not here. It exists in one response body,
 * once, and is unrecoverable afterwards — a list that could show it again would make it a
 * standing credential rather than a handover.
 */
export function UsersPage({ users, error, viewerRole, viewerName }: UsersPageProps): JSX.Element {
  return (
    <StaffShell
      title="Staff accounts — AE Reports"
      pageTitle="Staff accounts"
      role={viewerRole}
      fullName={viewerName}
      active="users"
    >
      <div class="staff-head">
        <div class="sp">
          <p class="hint">
            {users.length} account{users.length === 1 ? "" : "s"}
          </p>
        </div>
        <a href="/users/new" class="btn">
          Add user
        </a>
      </div>

      {error && (
        <div class="alert alert-error" safe>
          {error}
        </div>
      )}

      <table class="utable">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Added</th>
            <th>Last sign-in</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr>
              <td>
                <span safe>{user.fullName}</span>
                {user.isSelf && <span class="tag muted">You</span>}
              </td>
              <td safe>{user.email}</td>
              <td safe>{roleLabel(user.role)}</td>
              <td>
                {user.isActive ? (
                  <span class="tag">Active</span>
                ) : (
                  <span class="tag muted">Deactivated</span>
                )}
                {user.mustChangePassword && <span class="tag warn">Password not set</span>}
              </td>
              <td>{day(user.createdAt)}</td>
              <td>{day(user.lastSignInAt)}</td>
              <td>
                {/* Nothing at all on your own row. An administrator may not reset or deactivate
                    themselves, and the surest way to render that is to render no control — though
                    the routes check it again, because a missing button is not a control. */}
                {user.isSelf ? (
                  <span class="hint">—</span>
                ) : (
                  <div class="row-actions">
                    {/* Offered only while the account is active, because a reset of a deactivated
                        account is refused. A button that always fails is worse than no button. */}
                    {user.isActive && (
                      <form method="POST" action={`/users/${user.id}/reset`}>
                        <button type="submit" class="btn ghost btn-sm">
                          Reset password
                        </button>
                      </form>
                    )}

                    <form
                      method="POST"
                      action={`/users/${user.id}/${user.isActive ? "deactivate" : "reactivate"}`}
                    >
                      <button type="submit" class="btn ghost btn-sm">
                        {user.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </StaffShell>
  );
}

export type NewUserPageProps = {
  error?: string;
  /**
   * Echoed back so a refused submission does not make the administrator retype it.
   *
   * These are the only place raw submitted text reaches an attribute rather than a text node, so
   * `safe` — which governs children — does not cover them. It does not need to: the runtime
   * escapes `"` and `'` in every attribute it writes, and the attributes below are double-quoted,
   * so the value cannot be closed. A `<` surviving inside the value looks alarming in the source
   * and is inert; an entity such as `&#34;` decodes into the value's data, because the tokenizer
   * fixes the delimiters before it resolves any entity. Neither can start a new attribute. What
   * it does cost is a round trip: a name typed with a literal `&#34;` redisplays as `"`, which is
   * a wrong echo on a refused form and not a way in.
   */
  email?: string;
  name?: string;
  role?: AssignableRole | undefined;
  /** The reader's own role, for the rail. See `UsersPageProps`. */
  viewerRole: string;
  /** The signed-in person, for the title bar. */
  viewerName: string;
};

/**
 * The form for creating a staff account.
 *
 * The role control offers exactly the two assignable roles, and the route parses against the same
 * list — the select is a convenience, never the check. There is no password field: the account's
 * first password is generated server-side, so an administrator cannot choose one and therefore
 * cannot know one that outlives the handover.
 */
export function NewUserPage({
  error,
  email,
  name,
  role,
  viewerRole,
  viewerName,
}: NewUserPageProps): JSX.Element {
  return (
    <StaffShell
      title="Add a staff account — AE Reports"
      pageTitle="Add a staff account"
      role={viewerRole}
      fullName={viewerName}
      active="users"
    >
      <div class="staff-narrow">
        <div class="staff-head">
          <div class="sp">
            <p class="hint">
              A one-time password is generated here and shown once. The user must replace it at
              first sign-in.
            </p>
          </div>
        </div>

        {error && (
          <div class="alert alert-error" safe>
            {error}
          </div>
        )}

        <div class="card card-b">
          <form method="POST" action="/users/new">
            <div class="f">
              <label for="name">
                Full name <i>*</i>
              </label>
              <input type="text" id="name" name="name" required maxlength={200} value={name} />
            </div>

            <div class="f">
              <label for="email">
                Email <i>*</i>
              </label>
              <input
                type="email"
                id="email"
                name="email"
                required
                maxlength={254}
                placeholder="name@tmda.go.tz"
                value={email}
              />
            </div>

            <div class="f">
              <label for="role">
                Role <i>*</i>
              </label>
              <select id="role" name="role" required>
                <option value="" disabled selected={role === undefined}>
                  Choose a role
                </option>
                {ASSIGNABLE_ROLES.map((assignable) => (
                  <option value={assignable} selected={role === assignable}>
                    {roleLabel(assignable)}
                  </option>
                ))}
              </select>
            </div>

            <div class="bar">
              <button type="submit" class="btn">
                Create account
              </button>
              <a href="/users" class="btn ghost">
                Cancel
              </a>
            </div>
          </form>
        </div>
      </div>
    </StaffShell>
  );
}

export type UserCreatedPageProps = {
  email: string;
  fullName: string;
  role: AssignableRole;
  /** Shown here and nowhere else, ever. */
  password: string;
  /** The reader's own role, for the rail. See `UsersPageProps`. */
  viewerRole: string;
  /** The signed-in person, for the title bar. */
  viewerName: string;
};

/**
 * The one place the temp password is ever displayed.
 *
 * This is the body of the POST's own 200 response, not a page reached by redirect. A redirect
 * would have to carry the password in the URL, where it would land in the access log, in
 * `Referer`, and in the administrator's history; the alternative, a server-side flash store,
 * would mean the password outlived the request that made it. Only the Argon2 hash was persisted,
 * so once this page is closed the password is genuinely gone and the account needs a reset.
 */
export function UserCreatedPage({
  email,
  fullName,
  role,
  password,
  viewerRole,
  viewerName,
}: UserCreatedPageProps): JSX.Element {
  return (
    <StaffShell
      title="Account created — AE Reports"
      pageTitle="Account created"
      role={viewerRole}
      fullName={viewerName}
      active="users"
    >
      <div class="staff-narrow">
        <div class="staff-head">
          <div class="sp">
            <p class="eyebrow">Account created</p>
            <h2 safe>{fullName}</h2>
            <p class="hint">
              <span safe>{email}</span> · <span safe>{roleLabel(role)}</span>
            </p>
          </div>
        </div>

        <div class="temp-password">
          <p class="eyebrow">One-time password</p>
          <code safe>{password}</code>
          <p class="hint">
            Give this to the user by a channel they already trust. It is shown only on this page —
            reloading or leaving will not bring it back, and it must be replaced at first sign-in.
          </p>
        </div>

        <div class="bar">
          <a href="/users/new" class="btn ghost">
            Add another
          </a>
          <a href="/users" class="btn">
            Done
          </a>
        </div>
      </div>
    </StaffShell>
  );
}

export type PasswordResetPageProps = {
  email: string;
  fullName: string;
  /** Shown here and nowhere else, ever. */
  password: string;
  /** The reader's own role, for the rail. See `UsersPageProps`. */
  viewerRole: string;
  /** The signed-in person, for the title bar. */
  viewerName: string;
};

/**
 * The other place a temp password is displayed, on the same terms as the first.
 *
 * 200 in the body of the POST, never a redirect, for the reason `UserCreatedPage` gives. It also
 * says what the reset did beyond the password: every session that account had is gone, so anyone
 * signed in as them — including whoever prompted the reset — has been signed out.
 */
export function PasswordResetPage({
  email,
  fullName,
  password,
  viewerRole,
  viewerName,
}: PasswordResetPageProps): JSX.Element {
  return (
    <StaffShell
      title="Password reset — AE Reports"
      pageTitle="Password reset"
      role={viewerRole}
      fullName={viewerName}
      active="users"
    >
      <div class="staff-narrow">
        <div class="staff-head">
          <div class="sp">
            <p class="eyebrow">Password reset</p>
            <h2 safe>{fullName}</h2>
            <p class="hint" safe>
              {email}
            </p>
          </div>
        </div>

        <div class="temp-password">
          <p class="eyebrow">One-time password</p>
          <code safe>{password}</code>
          <p class="hint">
            Give this to the user by a channel they already trust. It is shown only on this page —
            reloading or leaving will not bring it back, and it must be replaced at their next
            sign-in.
          </p>
        </div>

        <p class="hint staff-foot">
          Every session on that account has been ended. They will have to sign in again with this
          password.
        </p>

        <div class="bar">
          <a href="/users" class="btn">
            Done
          </a>
        </div>
      </div>
    </StaffShell>
  );
}
