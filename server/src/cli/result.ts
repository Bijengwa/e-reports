/**
 * Outcomes a command anticipated.
 *
 * Anything unexpected is deliberately absent: it propagates as a thrown exception, which the
 * entry point catches and maps to exit 3. "An administrator already exists" is an answer;
 * a dead database is not.
 */
export type CommandResult =
  | { status: "ok"; message: string; password: string }
  | { status: "refused"; message: string }
  | { status: "invalid"; message: string };
