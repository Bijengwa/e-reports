import { describe, expect, it } from "vitest";
import {
  computeDueAt,
  countdownLabel,
  deadlineStateOf,
  formatDuration,
  NEAR_DEADLINE_MS,
} from "../src/domain/assignment.js";

describe("formatDuration", () => {
  it("shows weeks down through seconds once weeks are present", () => {
    // 2 weeks, 3 days, 4 hours, 18 minutes, 21 seconds.
    const ms = ((((2 * 7 + 3) * 24 + 4) * 60 + 18) * 60 + 21) * 1000;
    expect(formatDuration(ms)).toBe("2w 03d 04h 18m 21s");
  });

  it("drops weeks once none remain", () => {
    const ms = ((3 * 24 + 7) * 60 + 22) * 60 * 1000;
    expect(formatDuration(ms)).toBe("3d 07h 22m 00s");
  });

  it("drops down to minutes and seconds once under an hour", () => {
    expect(formatDuration((4 * 60 + 31) * 1000)).toBe("4m 31s");
  });

  it("shows plain seconds once under a minute", () => {
    expect(formatDuration(9 * 1000)).toBe("9s");
  });

  it("floors to 0s rather than going negative", () => {
    expect(formatDuration(-500)).toBe("0s");
  });
});

describe("deadlineStateOf", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("is completed whenever the work is done, whatever the deadline says", () => {
    const pastDue = new Date(now.getTime() - 1);
    expect(deadlineStateOf(now, pastDue, true)).toBe("completed");
  });

  it("is none when there is no deadline at all", () => {
    expect(deadlineStateOf(now, null, false)).toBe("none");
  });

  it("is on-track well before the deadline", () => {
    const dueAt = new Date(now.getTime() + NEAR_DEADLINE_MS * 3);
    expect(deadlineStateOf(now, dueAt, false)).toBe("on-track");
  });

  it("is near right at the threshold", () => {
    const dueAt = new Date(now.getTime() + NEAR_DEADLINE_MS);
    expect(deadlineStateOf(now, dueAt, false)).toBe("near");
  });

  it("is near just inside the threshold", () => {
    const dueAt = new Date(now.getTime() + NEAR_DEADLINE_MS - 1000);
    expect(deadlineStateOf(now, dueAt, false)).toBe("near");
  });

  it("is overdue the instant the deadline passes", () => {
    const dueAt = new Date(now.getTime() - 1);
    expect(deadlineStateOf(now, dueAt, false)).toBe("overdue");
  });
});

describe("countdownLabel", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("reads Completed regardless of the deadline", () => {
    expect(countdownLabel(now, new Date(now.getTime() - 1), true)).toBe("Completed");
  });

  it("reads No deadline when none was ever set", () => {
    expect(countdownLabel(now, null, false)).toBe("No deadline");
  });

  it("shows the remaining time while on track", () => {
    const dueAt = computeDueAt(now, 3, "days");
    expect(countdownLabel(now, dueAt, false)).toBe("3d 00h 00m 00s");
  });

  it("prefixes OVERDUE and shows elapsed time once the deadline has passed", () => {
    const dueAt = new Date(now.getTime() - (4 * 3600 + 21 * 60 + 8) * 1000);
    expect(countdownLabel(now, dueAt, false)).toBe("OVERDUE · 4h 21m 08s");
  });
});
