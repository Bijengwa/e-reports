/**
 * How long an Officer has to act, translated into a concrete point in time.
 *
 * One helper for every assignment this application makes — Assessment 1 today, every secondary
 * assessment beside it — so "3 days" means the same span of wall-clock time wherever a Manager
 * sets it, and the server's clock is the only one that ever gets a vote. `now` is always passed in
 * rather than read here, so a caller under test can pin it and a real caller cannot forget which
 * clock a deadline was measured from.
 */

export const DEADLINE_UNITS = ["seconds", "minutes", "hours", "days", "weeks"] as const;
export type DeadlineUnit = (typeof DEADLINE_UNITS)[number];

/** What an assignment gets when nobody chooses otherwise. */
export const DEFAULT_DEADLINE: { value: number; unit: DeadlineUnit } = {
  value: 3,
  unit: "days",
};

const MILLISECONDS_PER_UNIT: Record<DeadlineUnit, number> = {
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
};

export function isDeadlineUnit(value: string): value is DeadlineUnit {
  return (DEADLINE_UNITS as readonly string[]).includes(value);
}

/** A whole number of at least one — the only shape a deadline's magnitude may take. */
export function isDeadlineValue(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

export function computeDueAt(now: Date, value: number, unit: DeadlineUnit): Date {
  return new Date(now.getTime() + value * MILLISECONDS_PER_UNIT[unit]);
}

/**
 * How close is close enough to warn about — one named constant rather than a threshold repeated,
 * or silently varied, wherever a countdown is drawn. Nothing in the codebase set a figure before
 * this; 24 hours is this feature's own choice, and the one place to change it if that turns out
 * wrong is here, not each caller.
 */
export const NEAR_DEADLINE_MS = 24 * 60 * 60 * 1000;

/** What a deadline display should look like right now. `none` is an assignment with no due date. */
export type DeadlineState = "none" | "on-track" | "near" | "overdue" | "completed";

/**
 * Reads one assignment's due date against the clock, for a completed one against nothing at all —
 * a finished assessment is never overdue, however late it finished.
 */
export function deadlineStateOf(now: Date, dueAt: Date | null, completed: boolean): DeadlineState {
  if (completed) return "completed";
  if (dueAt === null) return "none";
  const remainingMs = dueAt.getTime() - now.getTime();
  if (remainingMs < 0) return "overdue";
  if (remainingMs <= NEAR_DEADLINE_MS) return "near";
  return "on-track";
}

/**
 * `2w 3d 04h 18m 21s` — every unit from the largest nonzero one down to seconds, the first
 * unpadded and the rest zero-padded to two digits. Never negative: a caller past its deadline
 * passes the elapsed span instead, not this function guessing which direction to measure.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const weeks = Math.floor(totalSeconds / 604_800);
  const days = Math.floor((totalSeconds % 604_800) / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const units: ReadonlyArray<readonly [number, string]> = [
    [weeks, "w"],
    [days, "d"],
    [hours, "h"],
    [minutes, "m"],
    [seconds, "s"],
  ];
  const firstNonZero = units.findIndex(([value]) => value > 0);
  const start = firstNonZero === -1 ? units.length - 1 : firstNonZero;

  return units
    .slice(start)
    .map(([value, label], index) =>
      index === 0 ? `${value}${label}` : `${String(value).padStart(2, "0")}${label}`,
    )
    .join(" ");
}

/** The label a countdown shows right now: remaining time, "OVERDUE · " elapsed, or "Completed". */
export function countdownLabel(now: Date, dueAt: Date | null, completed: boolean): string {
  if (completed) return "Completed";
  if (dueAt === null) return "No deadline";

  const remainingMs = dueAt.getTime() - now.getTime();
  if (remainingMs < 0) return `OVERDUE · ${formatDuration(-remainingMs)}`;
  return formatDuration(remainingMs);
}
