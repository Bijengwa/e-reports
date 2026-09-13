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
