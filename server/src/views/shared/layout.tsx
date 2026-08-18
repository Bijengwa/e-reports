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
        {/* Enhancement only — the form works with this blocked, because every rule it applies is
            also enforced server-side. Served from our own origin to satisfy the CSP. */}
        <script src="/assets/orange-form.js" defer></script>
        {/* Also enhancement only, and also served from our own origin to satisfy the CSP. The
            field works without it; the script only ever changes the input's `type`. */}
        {passwordToggle && <script src="/assets/password-toggle.js" defer></script>}
      </head>
      <body class={bodyClass ?? ""}>{children}</body>
    </html>
  );
}
