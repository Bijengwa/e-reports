import type { FastifyBaseLogger } from "fastify";

/**
 * How often the service requests its own address.
 *
 * Render's free tier stops an instance after 15 minutes with no inbound request. Five leaves room
 * for two pings in a row to fail before the window closes.
 */
export const KEEP_ALIVE_INTERVAL_MS = 5 * 60_000;

/** A ping that has not answered in this long is abandoned; the next tick tries again. */
const PING_TIMEOUT_MS = 10_000;

export type KeepAliveOptions = {
  /** One of this app's own public addresses — a door's `/healthz`. */
  url: string;
  log: FastifyBaseLogger;
  /** Injected by tests. */
  fetch?: typeof globalThis.fetch;
};

/**
 * Keep an idle-sleeping host from spinning the service down by requesting our own public URL on a
 * timer.
 *
 * The request leaves the container and comes back in through the host's proxy, which is what the
 * host counts as traffic — a loopback request to 127.0.0.1 would never reach that proxy and would
 * keep nothing awake. Because it runs inside the instance it cannot wake one that is already
 * asleep: it holds the service up from each boot onward.
 *
 * Returns a function that stops the timer.
 */
export function startKeepAlive(opts: KeepAliveOptions): () => void {
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  const ping = async (): Promise<void> => {
    try {
      const response = await fetchImpl(opts.url, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
      // The body is never read; cancelling it releases the connection straight away.
      await response.body?.cancel();

      if (response.ok) {
        opts.log.debug({ url: opts.url }, "keep-alive ping answered");
      } else {
        opts.log.warn({ url: opts.url, status: response.status }, "keep-alive ping refused");
      }
    } catch (error) {
      opts.log.warn({ url: opts.url, err: error }, "keep-alive ping failed");
    }
  };

  const timer = setInterval(() => void ping(), KEEP_ALIVE_INTERVAL_MS);
  // The listening socket is what keeps the process running; this timer must never be the reason.
  timer.unref();

  opts.log.info(
    { url: opts.url, everyMinutes: KEEP_ALIVE_INTERVAL_MS / 60_000 },
    "keep-alive enabled",
  );

  return () => clearInterval(timer);
}
