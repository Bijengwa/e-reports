import { loadConfig } from "../config.js";
import { createDatabase } from "../db/client.js";
import { createAdmin } from "./create-admin.js";
import { resetPassword } from "./reset-password.js";
import type { CommandResult } from "./result.js";

const HELP = `AE Reports staff account tool.

  create          --email=<address> --name="<full name>"
                  Creates the first administrator. Refuses once one exists.

  reset-password  --email=<address>
                  Issues a new temporary password and ends that user's sessions.

Both print a temporary password once, to stdout. It stops working as soon as the
user sets their own. Read it, deliver it, do not store it.

Anyone who can run these commands can already reach the database directly, so
they are a break-glass tool, not a privilege boundary. The guard on 'create'
prevents accidents -- running it twice, or two operators at once -- not an
operator holding DATABASE_URL.

Exit codes: 0 success, 1 refused, 2 invalid input, 3 unexpected failure.
`;

/**
 * Parses --key=value pairs.
 *
 * There is deliberately no password flag. argv is visible in `ps` and is written to shell
 * history, so a password must never be able to arrive that way; the commands generate their own.
 * An email and a name are not secret, so they travel here quite happily.
 */
function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};

  for (const arg of argv) {
    // Destructured rather than indexed: the project compiles with noUncheckedIndexedAccess, so
    // a capture group is `string | undefined` however certain the regex makes it.
    const [, key, value] = /^--([^=]+)=(.*)$/.exec(arg) ?? [];
    if (key !== undefined && value !== undefined) flags[key] = value;
  }

  return flags;
}

function exitCodeFor(result: CommandResult): number {
  switch (result.status) {
    case "ok":
      return 0;
    case "refused":
      return 1;
    case "invalid":
      return 2;
  }
}

async function main(): Promise<number> {
  const [subcommand, ...rest] = process.argv.slice(2);

  if (!subcommand || subcommand === "--help" || subcommand === "help") {
    process.stdout.write(HELP);
    // Asking for help is success; being given nothing to do is not.
    return subcommand ? 0 : 2;
  }

  const flags = parseFlags(rest);
  const config = loadConfig();
  const handle = createDatabase(config.DATABASE_URL);

  try {
    let result: CommandResult;

    switch (subcommand) {
      case "create":
        result = await createAdmin(handle.db, {
          email: flags.email ?? "",
          name: flags.name ?? "",
        });
        break;
      case "reset-password":
        result = await resetPassword(handle.db, { email: flags.email ?? "" });
        break;
      default:
        process.stderr.write(`Unknown command: ${subcommand}\n\n${HELP}`);
        return 2;
    }

    // Reached only after the command's transaction committed, so a rolled-back row can never
    // have its password printed. The outcome goes to stderr and the secret to stdout, so
    // `admin create ... > password.txt` captures only the secret while the operator still sees
    // what happened. Written straight to the stream rather than through the application logger,
    // which would carry it into log aggregation.
    process.stderr.write(`${result.message}\n`);
    if (result.status === "ok") {
      process.stdout.write(`Temporary password: ${result.password}\n`);
    }

    return exitCodeFor(result);
  } finally {
    await handle.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `Unexpected failure: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 3;
  });
