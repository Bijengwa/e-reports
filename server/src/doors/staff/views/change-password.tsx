import { MIN_PASSWORD_LENGTH } from "../../../auth/password.js";
import { BrandMark } from "../../../views/shared/brand-mark.js";
import { Layout } from "../../../views/shared/layout.js";

export type ChangePasswordPageProps = {
  error?: string;
  /** True on the forced first sign-in, when the rest of the portal is still shut. */
  isForced?: boolean;
};

/**
 * Where a user sets their own password.
 *
 * `minlength` is rendered from the same constant the route enforces, so the browser cannot
 * promise a rule the server does not apply, or refuse one it would have accepted.
 */
export function ChangePasswordPage({ error, isForced }: ChangePasswordPageProps): JSX.Element {
  return (
    <Layout title="Change Password — AE Reports" locale="en" bodyClass="staff-login" passwordToggle>
      <div class="login-card">
        <div class="login-header">
          <BrandMark />
          <h1>Change Password</h1>
          {isForced ? (
            <p>You must set a new password before continuing.</p>
          ) : (
            <p>Update your password</p>
          )}
        </div>

        {error && (
          <div class="alert alert-error" safe>
            {error}
          </div>
        )}

        <form method="POST" action="/change-password" class="login-form">
          <div class="field">
            <label for="currentPassword">Current Password</label>
            <input
              type="password"
              id="currentPassword"
              name="currentPassword"
              required
              autocomplete="current-password"
            />
          </div>

          <div class="field">
            <label for="newPassword">New Password</label>
            <input
              type="password"
              id="newPassword"
              name="newPassword"
              required
              minlength={MIN_PASSWORD_LENGTH}
              autocomplete="new-password"
            />
          </div>

          <div class="field">
            <label for="confirmPassword">Confirm New Password</label>
            <input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              required
              minlength={MIN_PASSWORD_LENGTH}
              autocomplete="new-password"
            />
          </div>

          <button type="submit" class="btn btn-primary">
            Update Password
          </button>
        </form>
      </div>
    </Layout>
  );
}
