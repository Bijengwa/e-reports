import { countdownLabel, type DeadlineState, deadlineStateOf } from "../../../../domain/assignment.js";

/**
 * One assignment's deadline, wherever it is shown — the Manager's assignment history, the
 * Officer's own list. The server computes the true state and an initial label at render time
 * (`due_at` is the one authority; nothing here recomputes it from the browser's clock); the same
 * `data-due-at` and `data-completed` this element carries are what `countdown.js` reads to keep it
 * ticking after the page has loaded, without ever asking the server again.
 */
export function Countdown({
  dueAt,
  completed,
  now = new Date(),
}: {
  dueAt: Date | null;
  completed: boolean;
  /** Overridable only so a test can pin what "right now" means; a real caller never passes this. */
  now?: Date;
}): JSX.Element {
  const state: DeadlineState = deadlineStateOf(now, dueAt, completed);
  const label = countdownLabel(now, dueAt, completed);

  return (
    <span
      class={`countdown countdown-${state}`}
      data-countdown
      data-due-at={dueAt === null ? undefined : dueAt.toISOString()}
      data-completed={completed ? "true" : undefined}
      safe
    >
      {label}
    </span>
  );
}

