import { StaffShell } from "./shell.js";

export type DashboardPageProps = {
  fullName: string;
  role: string;
};

/**
 * Where a fully signed-in user lands.
 *
 * Still almost empty, and now honestly so: the rail carries navigation and sign-out, so this page
 * is only the greeting. What an administrator can actually do lives behind the rail's two extra
 * entries rather than behind links repeated here.
 */
export function DashboardPage({ fullName, role }: DashboardPageProps): JSX.Element {
  return (
    <StaffShell title="AE Reports — Staff" role={role} active="dashboard">
      <div class="staff-head">
        <div class="sp">
          <h1>Dashboard</h1>
          <p class="hint">
            Signed in as <strong safe>{fullName}</strong> (<span safe>{role}</span>)
          </p>
        </div>
      </div>

      <p class="hint">Reports arrive here in a later slice.</p>
    </StaffShell>
  );
}
