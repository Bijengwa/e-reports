import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import { fastifyKitaHtml } from "@kitajs/fastify-html-plugin";
import Fastify, { type FastifyInstance } from "fastify";
import { type Config, loadConfig, publicOrigin } from "./config.js";
import { createDatabase } from "./db/client.js";
import { publicDoor } from "./doors/public/index.js";
import { staffDoor } from "./doors/staff/index.js";
import { createStorage, MAX_ATTACHMENTS } from "./storage/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Resolves to <project>/public from both src (tsx) and dist (node). */
const assetsRoot = path.join(here, "..", "public");

/**
 * Composition root.
 *
 * Everything shared sits at the root scope; each door is registered as a plain async function so
 * Fastify gives it its own encapsulation context. A public route therefore cannot reach anything
 * the staff door decorates.
 */
export async function buildServer(config: Config = loadConfig()): Promise<FastifyInstance> {
  // Request logging is silenced in tests by LOG_LEVEL=fatal rather than by
  // `disableRequestLogging`, which Fastify 5 deprecates.
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // No inline script on either door. htmx and our own scripts are served from /assets.
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    hsts:
      config.NODE_ENV === "production" ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(cookie);
  await app.register(formbody);
  await app.register(fastifyKitaHtml);

  // Attachments arrive only on the last step of the orange form. The limits are enforced here
  // rather than in the route, so a hostile upload is cut off while it streams instead of after
  // the whole body has been read into memory.
  await app.register(multipart, {
    limits: {
      fileSize: config.MAX_UPLOAD_MB * 1024 * 1024,
      files: MAX_ATTACHMENTS,
      fields: 100,
    },
    throwFileSizeLimit: true,
  });

  // Assets are deliberately unconstrained by host — both doors need them.
  await app.register(staticFiles, { root: assetsRoot, prefix: "/assets/" });

  app.decorate(
    "storage",
    createStorage({ driver: config.STORAGE_DRIVER, root: config.STORAGE_ROOT }),
  );

  const database = createDatabase(config.DATABASE_URL);
  app.decorate("db", database.db);
  app.addHook("onClose", async () => {
    await database.close();
  });

  await app.register(publicDoor, { host: config.PUBLIC_HOST });
  await app.register(staffDoor, {
    host: config.STAFF_HOST,
    publicOrigin: publicOrigin(config),
    sessionIdleMinutes: config.SESSION_IDLE_MINUTES,
    sessionAbsoluteHours: config.SESSION_ABSOLUTE_HOURS,
  });

  return app;
}

export async function start(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);
  await app.listen({ host: config.HOST, port: config.PORT });
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  start().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
