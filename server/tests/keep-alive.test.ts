import type { FastifyBaseLogger } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { KEEP_ALIVE_INTERVAL_MS, startKeepAlive } from "../src/keep-alive.js";

const URL = "https://staff.example.test/healthz";

function fakeLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  } as unknown as FastifyBaseLogger & Record<"info" | "warn" | "debug", ReturnType<typeof vi.fn>>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("keep-alive", () => {
  it("stays well inside Render's 15-minute idle window", () => {
    expect(KEEP_ALIVE_INTERVAL_MS).toBeLessThan(15 * 60_000);
  });

  it("requests the URL once per interval, not at boot", async () => {
    const fetch = vi.fn(async () => new Response("ok"));
    const stop = startKeepAlive({ url: URL, log: fakeLog(), fetch });

    expect(fetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(URL, expect.objectContaining({ signal: expect.anything() }));

    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS * 2);
    expect(fetch).toHaveBeenCalledTimes(3);

    stop();
  });

  it("stops when told to", async () => {
    const fetch = vi.fn(async () => new Response("ok"));
    const stop = startKeepAlive({ url: URL, log: fakeLog(), fetch });

    stop();
    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS * 3);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("warns and keeps going when a ping fails", async () => {
    const log = fakeLog();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(new Response("nope", { status: 503 }))
      .mockResolvedValue(new Response("ok"));
    const stop = startKeepAlive({ url: URL, log, fetch });

    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS * 3);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenCalledTimes(2);

    stop();
  });
});

describe("KEEP_ALIVE_URL", () => {
  const base = {
    PUBLIC_HOST: "public.test",
    STAFF_HOST: "staff.test",
    DATABASE_URL: "postgres://x@localhost/y",
  };

  it("is off unless set", () => {
    expect(loadConfig(base).KEEP_ALIVE_URL).toBeUndefined();
  });

  it("accepts an https address", () => {
    expect(loadConfig({ ...base, KEEP_ALIVE_URL: URL }).KEEP_ALIVE_URL).toBe(URL);
  });

  it("refuses something that is not a web address, at boot", () => {
    expect(() => loadConfig({ ...base, KEEP_ALIVE_URL: "staff.test/healthz" })).toThrow(
      /KEEP_ALIVE_URL/,
    );
  });
});
