import type { Children } from "@kitajs/html";
import { BrandMark } from "../../../views/shared/brand-mark.js";
import { Layout } from "../../../views/shared/layout.js";

export type StaffShellProps = {
  /** The document title, which the browser tab shows. */
  title: string;
  /**
   * The page's name, shown in the title bar.
   *
   * The bar carries this and nothing else. Everything that might have gone beside it — counts,
   * actions, filters — belongs in the page, because the bar's height is fixed and anything that
   * can wrap would either be clipped or force it to grow.
   */
  pageTitle: string;
  /**
   * The reader's role, which decides what the rail offers.
   *
   * Optional because the 403 page renders through this shell, and the one branch that answers 403
   * without a session has no role to give. A missing role is read as "not an administrator".
   */
  role?: string | undefined;
  /** Which entry is the page being shown, so the rail can mark it. */
  active?: "dashboard" | "reports" | "users" | "activity";
  children?: Children;
};

/** Stroke icons, sized and coloured by CSS so one rule covers the rail in both its states. */
function IconDashboard(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </svg>
  );
}

function IconReports(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  );
}

function IconUsers(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.6 20a6.4 6.4 0 0 1 12.8 0" />
      <path d="M16.2 5.2a3.4 3.4 0 0 1 0 5.8" />
      <path d="M17.8 14.4A6.4 6.4 0 0 1 21.4 20" />
    </svg>
  );
}

function IconActivity(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
    </svg>
  );
}

function IconSignOut(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h9" />
    </svg>
  );
}

function IconMenu(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

/**
 * Both directions are rendered and CSS shows one.
 *
 * The alternative is the script rewriting the button's contents on every toggle, which would put
 * the arrow's meaning in two places — the markup and the handler — and let them disagree.
 */
function IconCollapse(): JSX.Element {
  return (
    <svg class="when-open" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14 7l-5 5 5 5" />
      <path d="M19 4v16" />
    </svg>
  );
}

function IconExpand(): JSX.Element {
  return (
    <svg class="when-collapsed" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10 7l5 5-5 5" />
      <path d="M5 4v16" />
    </svg>
  );
}

/**
 * The frame around every page past the forced password change.
 *
 * Deliberately not `views/shared/`: that holds `Layout`, which is the one shell both doors share.
 * This one is the staff door's alone, and the public door must never grow a link into it.
 *
 * The rail is a column beside the page, never a strip above it. It is `position: sticky` at full
 * viewport height, so it stays put while the page scrolls, and its own nav scrolls inside it if
 * the list ever outgrows the screen. Below 900px it becomes a drawer over the page rather than
 * rearranging itself — a horizontal bar of links is not a smaller sidebar, it is a different
 * thing that happens to fit.
 *
 * The rail is rendered for every role, but the administrator's two entries are rendered only for
 * an administrator. That is presentation, not access control — `requireRole` refuses the routes
 * whatever the rail shows — but a link that answers 403 when clicked is a worse page than no link,
 * so the two agree.
 *
 * `/change-password` deliberately does not use this. It is reached before the gate these pages sit
 * behind, and a rail whose every link bounced back to it would promise a portal that is not open
 * yet.
 */
export function StaffShell({
  title,
  pageTitle,
  role,
  active,
  children,
}: StaffShellProps): JSX.Element {
  const isAdministrator = role === "administrator";

  return (
    <Layout title={title} locale="en" bodyClass="staff" railScript>
      <div class="shell">
        {/* `on-dark` is what recolours the mark for the rail: white folder, green cross. The
            paths are the same ones the sign-in card renders. */}
        <aside class="rail on-dark" id="rail">
          <div class="brand">
            <BrandMark />
          </div>

          <nav class="rail-nav" aria-label="Staff navigation">
            <a
              href="/dashboard"
              class={active === "dashboard" ? "on" : ""}
              aria-current={active === "dashboard" ? "page" : undefined}
            >
              <IconDashboard />
              <span class="rail-label">Dashboard</span>
            </a>

            {/* Everyone's, because everyone may read the register. What differs by role is what
                a person may do with a report, and this slice gives nobody anything to do. */}
            <a
              href="/reports"
              class={active === "reports" ? "on" : ""}
              aria-current={active === "reports" ? "page" : undefined}
            >
              <IconReports />
              <span class="rail-label">Reports</span>
            </a>

            {isAdministrator && (
              <>
                <a
                  href="/users"
                  class={active === "users" ? "on" : ""}
                  aria-current={active === "users" ? "page" : undefined}
                >
                  <IconUsers />
                  <span class="rail-label">Staff accounts</span>
                </a>
                <a
                  href="/activity"
                  class={active === "activity" ? "on" : ""}
                  aria-current={active === "activity" ? "page" : undefined}
                >
                  <IconActivity />
                  <span class="rail-label">Activity</span>
                </a>
              </>
            )}
          </nav>

          {/* A POST, not a link: signing out changes state, and a Lax cookie is withheld from a
              cross-site POST, which is what stops another origin doing it for the user. */}
          <div class="rail-foot">
            <form method="POST" action="/logout">
              <button type="submit" class="rail-signout">
                <IconSignOut />
                <span class="rail-label">Sign out</span>
              </button>
            </form>

            {/* The rail's own control, on the rail. Collapsing is something you do to this
                column, so it belongs here rather than in the title bar — the bar's one button
                is the drawer's, and only exists at widths where the rail is off-canvas. */}
            <button
              type="button"
              class="rail-collapse"
              data-rail-collapse
              aria-controls="rail"
              aria-expanded="true"
              aria-label="Collapse the sidebar"
            >
              <IconCollapse />
              <IconExpand />
              <span class="rail-label">Collapse</span>
            </button>
          </div>
        </aside>

        <div class="main">
          <header class="top">
            {/* Shown only once the rail is off-canvas. Rendered server-side rather than by the
                script, so it is part of the page rather than something that appears late. */}
            <button
              type="button"
              class="top-burger"
              data-rail-open
              aria-controls="rail"
              aria-expanded="false"
              aria-label="Open the sidebar"
            >
              <IconMenu />
            </button>

            <h1 safe>{pageTitle}</h1>
          </header>

          <main class="staff-main">{children}</main>
        </div>

        {/* Hidden until the drawer opens. `hidden` rather than a class, so it is inert to
            assistive tech as well as invisible. */}
        <div class="scrim" data-rail-scrim hidden></div>
      </div>
    </Layout>
  );
}
