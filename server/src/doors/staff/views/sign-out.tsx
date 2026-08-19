import { BrandMark } from "../../../views/shared/brand-mark.js";
import { Layout } from "../../../views/shared/layout.js";

/**
 * Asks before ending the session.
 *
 * A page rather than a scripted dialog. Signing out changes state on the server, and a
 * confirmation that only exists when JavaScript runs is a confirmation that quietly is not there
 * for the person whose browser blocked it — the CSP already forbids the inline handler such a
 * dialog usually reaches for. This way the question is part of the response, and the answer is
 * still a POST, so the Lax cookie keeps another origin from submitting it.
 *
 * It uses the sign-in card rather than the staff shell on purpose. Sign-out is reachable one scope
 * out from the rest of the app, so a user still held at the forced password change can arrive here
 * — and the shell's rail would offer them pages they cannot open.
 */
export function SignOutPage(): JSX.Element {
  return (
    <Layout title="Sign out — AE Reports" locale="en" bodyClass="staff-login">
      <div class="login-card">
        <div class="login-header">
          <BrandMark />
          <h1>Sign out</h1>
          <p>You will need your password to come back.</p>
        </div>

        <form method="POST" action="/logout">
          <div class="bar modal-actions">
            {/* Back to where they were going, not to the page they came from: a referrer is the
                browser's to send or withhold, and this is the one destination always open. */}
            <a href="/dashboard" class="btn ghost">
              Cancel
            </a>
            <button type="submit" class="btn">
              Sign out
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
