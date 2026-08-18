import { Layout } from "../../../views/shared/layout.js";

/**
 * The answer to a signed-in user who is not allowed here.
 *
 * 403 rather than a redirect to the dashboard. The two guards above this one redirect because
 * there is somewhere to send the user — sign in, or set your password — and following that
 * redirect is how they get in. There is no such route out of "your role does not include this",
 * so a redirect would silently drop the request and read as though the page did not exist.
 *
 * It names the role required rather than only refusing. Which roles exist is not a secret — the
 * dashboard prints the reader's own — and a bare refusal only sends someone to ask a colleague
 * what they were supposed to click.
 */
export function ForbiddenPage(): JSX.Element {
  return (
    <Layout title="Not permitted — AE Reports" locale="en" bodyClass="staff">
      <main class="staff-shell">
        <div class="staff-head">
          <div class="sp">
            <p class="eyebrow">403</p>
            <h1>Not permitted</h1>
            <p class="hint">Only an administrator can manage staff accounts.</p>
          </div>
        </div>

        <a href="/dashboard" class="btn ghost">
          Back to the dashboard
        </a>
      </main>
    </Layout>
  );
}
