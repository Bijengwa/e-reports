import { sql } from "drizzle-orm";
import { createDatabase, type Database, type DatabaseHandle } from "../../src/db/client.js";

/**
 * Whether the database-backed cases should run.
 *
 * `pnpm test` does not load `.env`, so this is false there and the suites skip.
 * `pnpm test:integration` loads it, so they run. The variable is read rather than the connection
 * attempted, because deciding to skip must not itself need a database.
 */
export const INTEGRATION_ENABLED = Boolean(process.env.TEST_DATABASE_URL);

/**
 * Refuses to hand back a connection unless it is unmistakably a test database.
 *
 * The bootstrap advisory lock is per-database and the teardown truncates three tables, so a
 * misconfigured run against the development database would be destructive rather than merely
 * confusing. Error messages name the database but never the credentials.
 */
export function requireTestDatabase(): { ownerUrl: string; appUrl: string } {
  const ownerUrl = process.env.TEST_DATABASE_URL;
  const appUrl = process.env.TEST_APP_DATABASE_URL;

  if (!ownerUrl || !appUrl) {
    throw new Error(
      "TEST_DATABASE_URL and TEST_APP_DATABASE_URL must both be set to run integration tests.",
    );
  }

  if (ownerUrl === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must not equal DATABASE_URL.");
  }

  const name = new URL(ownerUrl).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run against "${name}": the test database name must end in _test.`);
  }

  return { ownerUrl, appUrl };
}

/** Owner connection: applies migrations and truncates. */
export function openOwner(): DatabaseHandle {
  return createDatabase(requireTestDatabase().ownerUrl);
}

/**
 * Restricted connection, used for every command under test.
 *
 * Running the commands as the owner would exercise a superset of production's privileges and
 * prove nothing about them — the tests would pass while the container failed on a missing grant.
 */
export function openApp(): DatabaseHandle {
  return createDatabase(requireTestDatabase().appUrl);
}

/**
 * TRUNCATE, never DELETE. Migration 0001 puts a BEFORE UPDATE OR DELETE row trigger on
 * audit_log that raises for every role including the owner; row triggers do not fire on
 * TRUNCATE. CASCADE is needed because sessions and audit_log both reference users.
 */
export async function truncateAll(owner: Database): Promise<void> {
  await owner.execute(sql`TRUNCATE users, sessions, audit_log RESTART IDENTITY CASCADE`);
}
