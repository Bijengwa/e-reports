import { Layout } from "../../../views/shared/layout.js";

export type DashboardPageProps = {
  fullName: string;
  role: string;
};

/**
 * Where a fully signed-in user lands.
 *
 * Deliberately almost empty. It exists because sign-in needs a destination and because the
 * forced-password-change gate needs something to hold shut; the staff app proper is later slices.
 */
export function DashboardPage({ fullName, role }: DashboardPageProps): JSX.Element {
  return (
    <Layout title="AE Reports — Staff" locale="en" bodyClass="staff">
      <main class="staff-shell">
        <h1>AE Reports</h1>
        <p>
          Signed in as <strong safe>{fullName}</strong> (<span safe>{role}</span>)
        </p>

        {/* A POST, not a link: signing out changes state, and a Lax cookie is withheld from a
            cross-site POST, which is what stops another origin doing it for the user. */}
        <form method="POST" action="/logout">
          <button type="submit" class="btn">
            Sign out
          </button>
        </form>
      </main>
    </Layout>
  );
}
