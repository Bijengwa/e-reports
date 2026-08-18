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
  const sql = postgres(url, { max: 10 });
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
