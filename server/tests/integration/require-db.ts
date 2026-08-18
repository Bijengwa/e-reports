import { requireTestDatabase } from "./helpers.js";

/**
 * Runs before the integration suite and throws when the database is not configured.
 *
 * `pnpm test` skips these tests when the variables are absent, which keeps it green on any
 * machine. That is only safe if some other command refuses to be green for the same reason —
 * otherwise a CI run with no database passes while silently skipping the race test, which is
 * exactly the self-congratulating outcome this tier exists to prevent.
 */
export default function setup(): void {
  requireTestDatabase();
}
