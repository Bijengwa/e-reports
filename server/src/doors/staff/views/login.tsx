import { Layout } from "../../../views/shared/layout.js";
import { Logo } from "../../../views/shared/logo.js";

export type LoginPageProps = {
  error?: string;
  /** Absolute origin of the public door, e.g. http://public.localhost:3100. */
  publicFormUrl: string;
};

/**
 * Staff sign-in page.
 *
 * The credentials this form posts are not checked yet — database sessions, the `__Host-` cookie
 * and the forced first-sign-in password change land in the authentication slice. What exists now
 * is the page itself and the way out to the public door.
 *
 * The link to the orange form is deliberately absolute and cross-host. A reporter who lands on
 * the staff address needs a way across, and it must be a full origin: the two doors are separate
 * hostnames, so a relative href would keep them on the staff door.
 */
export function LoginPage({ error, publicFormUrl }: LoginPageProps): JSX.Element {
  return (
    <Layout title="Staff sign in — AE Reports" locale="en" bodyClass="staff-login" passwordToggle>
      <div class="login-card">
        <div class="login-header">
          <div class="auth-logo">
            <Logo />
          </div>
          <h1>AE Reports</h1>
          <p>Medical Device Vigilance — TMDA Staff Portal</p>
        </div>

        {error && (
          <div class="alert alert-error" safe>
            {error}
          </div>
        )}

        <form method="POST" action="/login" class="login-form">
          <div class="field">
            <label for="email">Email</label>
            <input
              type="email"
              id="email"
              name="email"
              required
              autocomplete="username"
              placeholder="name@tmda.go.tz"
            />
          </div>

          <div class="field">
            <label for="password">Password</label>
            <input
              type="password"
              id="password"
              name="password"
              required
              autocomplete="current-password"
            />
          </div>

          <button type="submit" class="btn btn-primary">
            Sign in
          </button>
        </form>

        <div class="login-footer">
          <a href={publicFormUrl} class="link-orange">
            → Go to Orange Form (public report)
          </a>
        </div>
      </div>
    </Layout>
  );
}
