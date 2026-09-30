import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Resolves to <project>/public from both src/views/shared (tsx) and dist/views/shared (node). */
const assetsRoot = path.join(here, "..", "..", "..", "public");

/**
 * Hashes are fixed for the life of a production process: the files under /public only change with
 * a deploy, and a deploy is a new process. In development they are read on every render, so an
 * edited stylesheet shows on the next reload without restarting the server.
 */
const memoize = process.env.NODE_ENV === "production";
const versions = new Map<string, string | null>();

function versionOf(relative: string): string | null {
  const known = versions.get(relative);
  if (known !== undefined) return known;

  let version: string | null;
  try {
    const bytes = readFileSync(path.join(assetsRoot, relative));
    version = createHash("sha256").update(bytes).digest("hex").slice(0, 10);
  } catch {
    // A missing file is a 404 the browser will report on its own; the page must still render.
    version = null;
  }

  if (memoize) versions.set(relative, version);
  return version;
}

/**
 * The address of a file under /public, stamped with a hash of its contents.
 *
 * The stamp is what lets `/assets` be cached for a year without a browser ever holding a stale
 * copy: a changed file is a changed address, so the old cached copy is simply never asked for
 * again. See the cache headers where `/assets` is registered in `server.ts`.
 *
 * `relative` is the path under /public, e.g. `css/base.css`.
 */
export function asset(relative: string): string {
  const version = versionOf(relative);
  return version === null ? `/assets/${relative}` : `/assets/${relative}?v=${version}`;
}
