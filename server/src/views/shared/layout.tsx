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
  children,
}: LayoutProps): JSX.Element {
  return (
    <html lang={locale}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="same-origin" />
        <title>{title}</title>
        <link rel="stylesheet" href="/assets/app.css" />
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
      </head>
      <body class={bodyClass ?? ""}>{children}</body>
    </html>
  );
}
