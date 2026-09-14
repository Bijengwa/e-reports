/**
 * A tiny in-process TTL cache for published, immutable IMDRF reads.
 *
 * A published release never changes — the whole point of the draft/published lifecycle
 * (`docs/imdrf-terminology.md`) is that publishing freezes it. That is what makes caching its
 * reads safe without any invalidation logic: the TTL below only bounds memory, it is never what
 * keeps an entry correct. `cached-query-service.ts` is the only caller, and it is the one that
 * decides *when* a result may be cached (only once it has seen `status = 'published'` on the
 * release the result came from) — this module has no way to know that on its own and does not
 * try to.
 *
 * Every key is namespaced by release id (`imdrf:{releaseId}:...`), so two releases — 2026 and
 * 2027, coexisting indefinitely per the release model — can never contaminate each other's
 * entries, and there is nothing to invalidate when a later release is imported or published: it
 * simply writes under its own keys.
 *
 * Process-local and unbounded-in-time-but-bounded-in-size on purpose: this application has no
 * shared cache today, and IMDRF terminology read traffic (many assessors, immutable data) is
 * exactly the case an in-process cache serves well without inventing a dependency the codebase
 * does not otherwise have.
 */

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

/** Generous, since a published release never goes stale — this only keeps the process's memory
 *  from growing forever across many releases and many terms. */
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

/** A soft ceiling on how many entries this process holds at once. */
const MAX_ENTRIES = 20_000;

/**
 * Oldest-inserted-first eviction, which `Map`'s own iteration order gives for free without a
 * second structure to keep in step. An approximation of LRU, not true LRU — good enough for a
 * cache whose entries are correct for as long as they exist at all, where the only thing eviction
 * protects is memory rather than correctness.
 */
function evictIfFull(): void {
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) return;
    store.delete(oldest);
  }
}

export function getCached<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (hit === undefined) return undefined;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
  evictIfFull();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Test-only: drops every cached entry, so one test's IMDRF fixtures never leak into another's. */
export function clearImdrfCache(): void {
  store.clear();
}
