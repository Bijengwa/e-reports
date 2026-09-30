import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export type DatabaseHandle = {
  db: Database;
  close: () => Promise<void>;
};

/**
 * postgres.js opens connections lazily, so building this does not touch the network. That keeps
 * route tests runnable without a live database.
 */
export function createDatabase(url: string): DatabaseHandle {
  const sql = postgres(url, {
    max: 10,
    // Close a connection that has sat unused for a minute, before the other end does. Neon's
    // pooler and its scale-to-zero compute drop idle connections on their own schedule; a pooled
    // connection that was cut while idle is only discovered when a request tries to use it, and
    // that request pays for the failure and the reconnect. Closing it ourselves means the next
    // request simply opens a fresh one.
    idle_timeout: 60,
    // Give up on a connection attempt after 10s rather than the default 30s, so a database that
    // cannot be reached shows an error page instead of a page that seems to load forever.
    connect_timeout: 10,
  });
  const db = drizzle(sql, { schema });

  return {
    db,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
  }
}
