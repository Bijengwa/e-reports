import type { FastifyReply } from "fastify";
import { IconBack } from "../../../views/shared/icons.js";
import { StaffShell } from "./shell.js";

export type ForbiddenPageProps = {
  /** The reader's role, so the rail offers them what they can actually reach. */
  role?: string | undefined;
  /** The signed-in person, for the title bar. */
  fullName?: string | undefined;
  /** 404 when the case is not there to be had; 403 when it is, but not for this reader. */
  status?: 403 | 404;
  /**
   * The refused request was trying to change something. Said out loud, because the one thing a
   * reader must not come away believing is that their save went through.
   */
  unsaved?: boolean;
};

/**
 * The answer to a signed-in user refused one case — not a whole area.
 *
 * A role barred from an area never sees a page at all: `requireRole` sends it to its dashboard.
 * This is for the refusals that happen in the middle of ordinary work, where a silent redirect
 * would mislead: the assessment was handed to someone else, the case has moved to its next step,
 * or the case does not exist. An Officer who pressed Save on a reassigned assessment and landed
 * on the dashboard would reasonably think it had saved.
 *
 * It renders inside the shell because whoever sees it is signed in, and the rail is how they get
 * somewhere they are allowed. It says no more than it must: which case, and why, stays with the
 * people who can see it.
 */
export function ForbiddenPage({
  role,
  fullName,
  status = 403,
  unsaved = false,
}: ForbiddenPageProps = {}): JSX.Element {
  const notFound = status === 404;
  const heading = notFound ? "Not found" : "Not available";

  return (
    <StaffShell
      title={`${heading} — e-reports`}
      pageTitle={heading}
      role={role}
      fullName={fullName}
    >
      <div class="staff-head">
        <div class="sp">
          <p class="hint">
            {notFound
              ? "This case could not be found."
              : "This case is not assigned to you, or it has already moved on to its next step."}
            {unsaved && " Nothing was saved."}
          </p>
        </div>
      </div>

      <a href="/dashboard" class="btn ghost">
        <IconBack />
        Back to the dashboard
      </a>
    </StaffShell>
  );
}

/**
 * Refuse one case. Every per-case refusal goes through here, so the status and whether to say
 * "nothing was saved" are decided once rather than at each route: anything but a GET was an
 * attempt to change something.
 */
export function refuse(reply: FastifyReply, role: string, status: 403 | 404 = 403) {
  return reply
    .status(status)
    .html(ForbiddenPage({ role, status, unsaved: reply.request.method !== "GET" }));
}
