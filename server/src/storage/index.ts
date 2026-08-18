import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where attachment bytes live.
 *
 * The database stores only a key. Report photographs can run to several megabytes and can contain
 * patient-identifying detail, so they belong in an object store that can be backed up, expired and
 * access-controlled on its own terms — never in a jsonb column.
 *
 * Local development writes to the filesystem; the VPS runs MinIO behind the same interface. Only
 * `createStorage` knows which, and it is the one place a second driver gets added.
 */

export type StoredObject = {
  objectKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
};

export type PutInput = {
  data: Buffer;
  /** As supplied by the browser — untrusted, and sanitised before it reaches any path. */
  filename: string;
  mimeType: string;
};

export interface StorageAdapter {
  put(input: PutInput): Promise<StoredObject>;
  read(objectKey: string): Promise<Buffer>;
}

/**
 * What a reporter may attach.
 *
 * A deliberate allow-list, not a block-list: the reporter needs photographs of a device and the
 * occasional scanned page, and every other content type is a liability on a public,
 * unauthenticated endpoint.
 */
export const ALLOWED_MIME_TYPES: Readonly<Record<string, string>> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
};

export const MAX_ATTACHMENTS = 5;

export function isAllowedMimeType(mimeType: string): boolean {
  return Object.hasOwn(ALLOWED_MIME_TYPES, mimeType);
}

/**
 * Reduce a browser-supplied filename to something that cannot escape the storage root.
 *
 * Everything outside a conservative character set goes, along with any directory component, so
 * `../../etc/passwd` becomes `etc_passwd`. The original name is preserved separately in the
 * database for display; this value only ever forms part of a key.
 */
export function sanitizeFilename(raw: string): string {
  const base = path
    .basename(raw)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "");
  const trimmed = base.slice(0, 80);
  return trimmed === "" ? "attachment" : trimmed;
}

/**
 * Filesystem-backed storage, rooted at `root`.
 *
 * Keys are `<year>/<uuid>-<name>`: the year keeps directories from growing without bound, and the
 * uuid means two reporters attaching `photo.jpg` never collide.
 */
export function createFilesystemStorage(root: string): StorageAdapter {
  const absoluteRoot = path.resolve(root);

  /** Resolve a key under the root, refusing anything that climbs out of it. */
  function resolveKey(objectKey: string): string {
    const full = path.resolve(absoluteRoot, objectKey);

    if (full !== absoluteRoot && !full.startsWith(absoluteRoot + path.sep)) {
      throw new Error(`Object key escapes the storage root: ${objectKey}`);
    }

    return full;
  }

  return {
    async put({ data, filename, mimeType }: PutInput): Promise<StoredObject> {
      const objectKey = `${new Date().getUTCFullYear()}/${randomUUID()}-${sanitizeFilename(filename)}`;
      const destination = resolveKey(objectKey);

      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, data);

      return {
        objectKey,
        filename,
        mimeType,
        sizeBytes: data.byteLength,
        // Lets a later integrity check prove the bytes on disk are the bytes that were reported.
        checksumSha256: createHash("sha256").update(data).digest("hex"),
      };
    },

    async read(objectKey: string): Promise<Buffer> {
      return readFile(resolveKey(objectKey));
    },
  };
}

export type StorageConfig = {
  driver: "filesystem";
  root: string;
};

export function createStorage(config: StorageConfig): StorageAdapter {
  return createFilesystemStorage(config.root);
}

declare module "fastify" {
  interface FastifyInstance {
    storage: StorageAdapter;
  }
}
