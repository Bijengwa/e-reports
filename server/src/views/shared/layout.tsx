import type { Children } from "@kitajs/html";
import type { Locale } from "../../i18n/index.js";

export type { Locale };

export type LayoutProps = {
  title: string;
  locale: Locale;
  /** Applied to <body>; the public door uses this to select the orange palette. */
  bodyClass?: string;
  /**
   * Load the show/hide enhancement for password fields.
   *
   * Opt-in and off by default, so a page with no password field does not fetch a script that
   * would find nothing to do — the orange form's markup is unchanged by this prop existing.
   */
  passwordToggle?: boolean;
  /**
   * Load the staff rail's script, which is the one script here that must not be deferred.
   *
   * It restores the collapsed rail before the first paint; deferring it would show the rail wide
   * and then snap it shut on every page load. Opt-in for the same reason as `passwordToggle`: a
   * page without a rail must not be made to fetch it.
   */
  railScript?: boolean;
  /**
   * Load the F004 find-in-page enhancement.
   *
   * Opt-in for the same reason `passwordToggle` is: a page carrying no `[data-f4-find]` input
   * must not be made to fetch a script that would find nothing to attach to.
   */
  f4Find?: boolean;
  /**
   * Load the live countdown enhancement.
   *
   * Opt-in for the same reason `f4Find` is: a page with no `[data-countdown]` element on it must
   * not be made to fetch a script that would find nothing to attach to.
   */
  countdown?: boolean;
  /**
   * Load the Register download button's enhancement.
   *
   * Opt-in for the same reason `countdown` is: a page with no `[data-download]` button on it must
   * not be made to fetch a script that would find nothing to attach to.
   */
  registerDownload?: boolean;
  /**
   * Load the F004 IMDRF term-picker enhancement.
   *
   * Opt-in for the same reason `countdown` is: a page with no `[data-imdrf-picker]` element on it
   * must not be made to fetch a script that would find nothing to attach to.
   */
  imdrfPicker?: boolean;
  /**
   * Load the Final F004 print button's enhancement.
   *
   * Opt-in for the same reason `countdown` is: a page with no `[data-f4-print]` button on it must
   * not be made to fetch a script that would find nothing to attach to.
   */
  f4Print?: boolean;
  /**
   * Load the staff shell's own stylesheet: the rail, the title bar, and the sign-out dialog every
   * `StaffShell` page renders. `StaffShell` always sets this; a page reached before it — sign-in,
   * the forced password change — does not.
   */
  shell?: boolean;
  /** Load the sign-in / change-password card styles, shared with the 403 page's own centred card. */
  auth?: boolean;
  /**
   * Load the orange form's own stylesheet — the public submission page, and the same component
   * embedded in the staff door's "log a report" page.
   */
  orangeForm?: boolean;
  /** Load the register list page's own stylesheet. */
  register?: boolean;
  /** Load the dashboard's own stylesheet. */
  dashboard?: boolean;
  /** Load the staff accounts page's own stylesheet (the one-time password panel). */
  users?: boolean;
  /** Load the activity log's own stylesheet (the two row tones). */
  activity?: boolean;
  /** Load the IMDRF terminology browser and admin pages' shared stylesheet. */
  imdrf?: boolean;
  /**
   * Load the F004/case-display stylesheet: the assessment form, the manager's review of it, the
   * Final F004, and the report drawer — everything built from `doors/staff/shared/components`,
   * wherever one of those components is reached from.
   */
  caseCss?: boolean;
  children?: Children;
};

/**
 * The single HTML shell for both doors.
 *
 * Assets are served from our own origin. The prototype pulled IBM Plex from Google Fonts; a
 * government vigilance portal must not leak reporter traffic to a third-party CDN, so fonts are
 * self-hosted under /assets.
 */
export function Layout({
  title,
  locale,
  bodyClass,
  passwordToggle,
  railScript,
  f4Find,
  countdown,
  registerDownload,
  imdrfPicker,
  f4Print,
  shell,
  auth,
  orangeForm,
  register,
  dashboard,
  users,
  activity,
  imdrf,
  caseCss,
  children,
}: LayoutProps): JSX.Element {
  return (
    <html lang={locale}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="same-origin" />
        <title>{title}</title>
        {/* Served from our own origin like every other asset. SVG only: the portal targets current
            browsers and an .ico would be a second copy of the mark to keep in step for nothing. */}
        <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
        {/* Design tokens, resets and the primitives (buttons, cards, fields, tables) every page —
            both doors — reaches for. Everything past this one is a page's own opt-in, the same
            shape as the scripts below: a page that does not render a rail must not be made to fetch
            the rail's stylesheet, and so on for the rest. */}
        <link rel="stylesheet" href="/assets/css/base.css" />
        {shell && <link rel="stylesheet" href="/assets/css/shell.css" />}
        {auth && <link rel="stylesheet" href="/assets/css/auth.css" />}
        {orangeForm && <link rel="stylesheet" href="/assets/css/orange-form.css" />}
        {register && <link rel="stylesheet" href="/assets/css/register.css" />}
        {dashboard && <link rel="stylesheet" href="/assets/css/dashboard.css" />}
        {users && <link rel="stylesheet" href="/assets/css/users.css" />}
        {activity && <link rel="stylesheet" href="/assets/css/activity.css" />}
        {imdrf && <link rel="stylesheet" href="/assets/css/imdrf.css" />}
        {caseCss && <link rel="stylesheet" href="/assets/css/case.css" />}
        {/* Deliberately not deferred — it has to run before the rail is painted. It is a few
            hundred bytes and sets one class on <html>. */}
        {railScript && <script src="/assets/rail.js"></script>}
        {/* Enhancement only — the form works with this blocked, because every rule it applies is
            also enforced server-side. Served from our own origin to satisfy the CSP. */}
        <script src="/assets/orange-form.js" defer></script>
        {/* Also enhancement only, and also served from our own origin to satisfy the CSP. The
            field works without it; the script only ever changes the input's `type`. */}
        {passwordToggle && <script src="/assets/password-toggle.js" defer></script>}
        {/* Enhancement only, and the reason it can be: highlighting a heading is not something a
            reader needs to be told happened, so a browser that blocks this leaves the page
            exactly as readable as it was. Served from our own origin to satisfy the CSP. */}
        {f4Find && <script src="/assets/f4-find.js" defer></script>}
        {/* Enhancement only: the server has already rendered the true remaining time as of the
            response, so a browser that blocks this leaves a correct but static countdown rather
            than a broken page. Served from our own origin to satisfy the CSP. */}
        {countdown && <script src="/assets/countdown.js" defer></script>}
        {/* Enhancement only: the plain `<a href>` this button degrades to already downloads the
            file with this blocked, so a browser refusing the script leaves a working, merely
            plainer, download in its place. Served from our own origin to satisfy the CSP. */}
        {registerDownload && <script src="/assets/register.js" defer></script>}
        {/* Enhancement only: the button this attaches to has no non-script equivalent
            (`window.print()` cannot be reached from a bare href), so a browser that blocks this
            leaves the button inert rather than broken — the document itself, and the browser's own
            Ctrl+P, are both still there. Served from our own origin to satisfy the CSP. */}
        {f4Print && <script src="/assets/f4-print.js" defer></script>}
        {/* Enhancement only: the hidden term-id input and the read-only display boxes it fills
            are both rendered server-side already, so a browser refusing this leaves the picker
            button doing nothing rather than a broken form — the assessor is told to try again
            without JavaScript blocked, and nothing already chosen is lost. */}
        {imdrfPicker && <script src="/assets/f004-imdrf-picker.js" defer></script>}
      </head>
      <body class={bodyClass ?? ""}>{children}</body>
    </html>
  );
}
