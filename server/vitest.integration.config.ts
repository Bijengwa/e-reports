import { defineConfig } from "vitest/config";

/**
 * Vitest does not read `.env` into `process.env`, and `--env-file` cannot be passed through
 * `NODE_OPTIONS`. Node's own loader is used instead, so this file is parsed exactly the way
 * `pnpm dev` parses it — and `vite` is not importable here anyway, being a transitive dependency
 * under pnpm's strict layout.
 *
 * Node leaves variables that are already set alone, which is what keeps the fail-closed path
 * reachable: `TEST_DATABASE_URL= pnpm test:integration` defines an empty string, the file does not
 * replace it, and the global setup throws.
 */
try {
  process.loadEnvFile();
} catch {
  // No .env here. CI supplies the variables directly, and the global setup refuses to run
  // without them, so a missing file must not be an error in its own right.
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/require-db.ts"],
    // Workers get their own process. Passing these explicitly means a worker cannot decide to
    // skip a case that the global setup already insisted on being able to run.
    env: {
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      TEST_APP_DATABASE_URL: process.env.TEST_APP_DATABASE_URL ?? "",
    },
    // The cases share three tables and truncate between runs, so they cannot overlap.
    fileParallelism: false,
  },
});
