export function ChangePasswordPage(props: { error?: string; isForced?: boolean }) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Change Password — AE Reports</title>
        <link rel="stylesheet" href="/assets/staff.css" />
      </head>
      <body class="staff-login">
        <div class="login-card">
          <div class="login-header">
            <h1>Change Password</h1>
            {props.isForced ? (
              <p>You must set a new password before continuing.</p>
            ) : (
              <p>Update your password</p>
            )}
          </div>

          {props.error && <div class="alert alert-error">{props.error}</div>}

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
                minlength="10"
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
                minlength="10"
                autocomplete="new-password"
              />
            </div>

            <button type="submit" class="btn btn-primary">
              Update Password
            </button>
          </form>
        </div>
      </body>
    </html>
  );
}
