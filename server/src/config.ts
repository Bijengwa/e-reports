import { z } from "zod";

/**
 * Every value the process needs, parsed once at boot.
 *
 * Anything invalid throws before the server listens, so a misconfigured deployment fails
 * immediately and loudly rather than at the first request that happens to need the value.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  /** Host header for the public orange form, port included. */
  PUBLIC_HOST: z.string().min(1),
  /** Host header for the staff portal, port included. */
  STAFF_HOST: z.string().min(1),

  DATABASE_URL: z.string().min(1),

  /**
   * Sliding idle window for a staff session, in minutes. Each request pushes it back.
   *
   * The ceiling is a day: anything longer is an absolute lifetime wearing an idle window's name,
   * and `SESSION_ABSOLUTE_HOURS` is the honest place to say that.
   */
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  /** Hard ceiling on a staff session, measured from sign-in. Never extended by activity. */
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(168).default(12),

  /** Attachment bytes never go in the database — only the key does. */
  STORAGE_DRIVER: z.enum(["filesystem"]).default("filesystem"),
  STORAGE_ROOT: z.string().min(1).default("./var/storage"),
  /** Per-file ceiling. A device photograph from a phone is a few MB; ten is generous. */
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(10),
});

export type Config = Readonly<z.infer<typeof EnvSchema>>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = EnvSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  // The two doors are isolated by hostname. If they collapse to the same host the
  // separation silently stops existing, so refuse to start.
  if (result.data.PUBLIC_HOST === result.data.STAFF_HOST) {
    throw new Error(
      "PUBLIC_HOST and STAFF_HOST must differ — the public and staff doors are isolated by hostname.",
    );
  }

  return Object.freeze(result.data);
}

/**
 * Absolute origin of the public door.
 *
 * The staff login page links across to the orange form, and the two doors are separate hostnames,
 * so that link cannot be relative. Development serves plain http on *.localhost; anything else is
 * assumed to be behind TLS.
 */
export function publicOrigin(config: Config): string {
  const scheme = config.NODE_ENV === "production" ? "https" : "http";
  return `${scheme}://${config.PUBLIC_HOST}`;
}
