import type { Children } from "@kitajs/html";
import { Layout } from "../../../views/shared/layout.js";
import { Logo } from "../../../views/shared/logo.js";

export type StaffShellProps = {
  title: string;
  /**
   * The reader's role, which decides what the rail offers.
   *
   * Optional because the 403 page renders through this shell, and the one branch that answers 403
   * without a session has no role to give. A missing role is read as "not an administrator".
   */
  role?: string | undefined;
  /** Which entry is the page being shown, so the rail can mark it. */
  active?: "dashboard" | "users" | "activity";
  children?: Children;
};

/**
 * The frame around every page past the forced password change.
 *
 * Deliberately not `views/shared/`: that holds `Layout`, which is the one shell both doors share.
 * This one is the staff door's alone, and the public door must never grow a link into it.
 *
 * The rail is rendered for every role, but the administrator's two entries are rendered only for
 * an administrator. That is presentation, not access control — `requireRole` refuses the routes
 * whatever the rail shows — but a link that answers 403 when clicked is a worse page than no link,
 * so the two agree.
 *
 * `/change-password` deliberately does not use this. It is reached before the gate these pages sit
 * behind, and a rail whose every link bounced the user back to `/change-password` would promise a
 * portal that is not open yet.
 */
export function StaffShell({ title, role, active, children }: StaffShellProps): JSX.Element {
  const isAdministrator = role === "administrator";

  return (
    <Layout title={title} locale="en" bodyClass="staff">
      <div class="staff-app">
        {/* `on-dark` is what recolours the mark for the rail: white folder, green cross. The
            paths are the same ones the sign-in card renders. */}
        <nav class="rail on-dark" aria-label="Staff navigation">
          <div class="rail-brand">
            <Logo />
            <span>
              <b class="rail-name">AE Reports</b>
              <span class="rail-sub">TMDA · Device vigilance</span>
            </span>
          </div>

          <ul class="rail-nav">
            <li>
              <a
                href="/dashboard"
                class={active === "dashboard" ? "on" : ""}
                aria-current={active === "dashboard" ? "page" : undefined}
              >
                Dashboard
              </a>
            </li>

            {isAdministrator && (
              <>
                <li>
                  <a
                    href="/users"
                    class={active === "users" ? "on" : ""}
                    aria-current={active === "users" ? "page" : undefined}
                  >
                    Staff accounts
                  </a>
                </li>
                <li>
                  <a
                    href="/activity"
                    class={active === "activity" ? "on" : ""}
                    aria-current={active === "activity" ? "page" : undefined}
                  >
                    Activity
                  </a>
                </li>
              </>
            )}
          </ul>

          {/* A POST, not a link: signing out changes state, and a Lax cookie is withheld from a
              cross-site POST, which is what stops another origin doing it for the user. */}
          <form method="POST" action="/logout" class="rail-out">
            <button type="submit" class="rail-signout">
              Sign out
            </button>
          </form>
        </nav>

        <main class="staff-main">{children}</main>
      </div>
    </Layout>
  );
}
