import { BrandMark } from "../../../views/shared/brand-mark.js";
import { Layout } from "../../../views/shared/layout.js";

export type SignOutPageProps = {
  /** Whose session is about to end, so the reader can see they are leaving the right account. */
  fullName: string;
};

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
export function SignOutPage({ fullName }: SignOutPageProps): JSX.Element {
  return (
    <Layout title="Sign out — AE Reports" locale="en" bodyClass="staff-login">
      <div class="login-card">
        <div class="login-header">
          <BrandMark />
          <h1>Sign out?</h1>
          <p>
            You are signed in as <strong safe>{fullName}</strong>.
          </p>
        </div>

        <form method="POST" action="/logout">
          <div class="bar">
            <button type="submit" class="btn danger">
              Sign out
            </button>
            {/* Back to where they were going, not to the page they came from: a referrer is the
                browser's to send or withhold, and this is the one destination always open. */}
            <a href="/dashboard" class="btn ghost">
              Stay signed in
            </a>
          </div>
        </form>
      </div>
    </Layout>
  );
}
