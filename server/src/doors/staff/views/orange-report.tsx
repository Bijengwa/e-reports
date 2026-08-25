// Type-only, and that matters: `reports.tsx` imports the component below, so a value import here
// would close a runtime cycle between the two modules. A type import is erased.
import type { Children } from "@kitajs/html";
import { FORM_TITLE } from "../../../domain/reports.js";
import type { ReportDetail } from "./reports.js";

/**
 * How a report reached us, in words. Defined here rather than in `reports.tsx` because it is part
 * of the Orange Report's own identity — `reports.tsx` re-exports it for the register's channel
 * column, which is the same fact in a table cell.
 */
export const CHANNEL_LABELS: Record<string, string> = {
  online_form: "Online form",
  email: "Email",
  hard_copy: "Hard copy",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `17 Aug 2026`, written out rather than left as an ISO date.
 *
 * The register prints `YYYY-MM-DD` because it is a dense list read by column. The received date is
 * read as a sentence — "Received 17 Aug 2026" — and a written month is what stops `2026-08-19` and
 * `2026-09-18` looking alike at a glance. Same format the workload's own rows use.
 */
export function receivedDay(at: Date): string {
  const on = new Date(at);
  return `${String(on.getUTCDate()).padStart(2, "0")} ${MONTHS[on.getUTCMonth()]} ${on.getUTCFullYear()}`;
}

/**
 * The surface the Orange Report is read on, wherever its content is shown.
 *
 * The identity card alone was not enough. A reader who scrolled past it met the report's own
 * answers rendered in the staff app's green-and-white cards, indistinguishable from an assessment
 * — so the colour said "this is the Orange Report" for one card and then stopped saying it for the
 * document itself. The F001 on paper is orange all the way down, and the whole point of the
 * identity is that F001 data is recognisable on sight.
 *
 * A scope class, never a change to `.card`, `.btn` or `.report-group` themselves. Those are shared
 * staff components and the assessment workflow is built out of them; repainting them globally
 * would make the entire application orange and destroy the distinction this exists to draw. Every
 * rule lives under `.orange-report-surface` in the stylesheet, so the treatment reaches exactly
 * what is inside this element and nothing else.
 *
 * The official document title is printed here rather than in the identity card because this is
 * where the reader is looking at the document. The card is a reference to it and stays short.
 */
export function OrangeReportSurface({
  report,
  withIdentity,
  children,
}: {
  report: Pick<ReportDetail, "number" | "receivedAt" | "channel" | "formVersion" | "deviceName">;
  /**
   * Print the identity card at the top of the surface.
   *
   * For the drawers, where this surface is the only thing on screen and the reader has nothing
   * else telling them which report they opened. The report page and the officer's work item carry
   * the full identity in their own headers a few lines above, and a second copy of the number
   * under it would be the page saying the same thing twice.
   */
  withIdentity?: boolean;
  children?: Children;
}): JSX.Element {
  return (
    <div class="orange-report-surface">
      {withIdentity === true ? <OrangeReportIdentity report={report} compact /> : <></>}
      <p class="orange-doc-title" safe>
        {FORM_TITLE}
      </p>
      {children}
    </div>
  );
}

/**
 * The Orange Report's identity, wherever the original report is on screen.
 *
 * The staff app shows three different documents and a reader has to be able to tell them apart at
 * a glance: the Orange Report a member of the public filed, the internal assessment work, and the
 * Final Document the manager approved. Only the first of the three is orange, and it is orange
 * everywhere — the report page, both assessment workspaces, the officer's work item and the final
 * document all mount this same block.
 *
 * One component rather than a class anyone can reach for, on purpose. "Consistent Orange Report
 * identity" is a promise about what the colour MEANS, and a rule that lives in a stylesheet is one
 * every page is free to borrow for something that is not the report. The identity is the number,
 * the date it was received and the form it arrived on — so it cannot be applied to anything that
 * does not have those three.
 *
 * The received date is the original submission date and never anything else. An assessment has its
 * own dates, printed under the assessment's own heading; nothing here reads them.
 */
export function OrangeReportIdentity({
  report,
  compact,
}: {
  report: Pick<ReportDetail, "number" | "receivedAt" | "channel" | "formVersion" | "deviceName">;
  /** Inside a drawer or a card that already has a heading, where the device name would repeat. */
  compact?: boolean;
}): JSX.Element {
  return (
    <div class={compact === true ? "orange-id is-compact" : "orange-id"}>
      {/* The nickname the office uses, and the form code that makes it findable on paper. The
          document's full official title is printed on the surface below, where the reader is
          looking at the document itself rather than at a reference to it. */}
      <p class="orange-id-kind">Orange Report · F001</p>
      <p class="orange-id-no" safe>
        {report.number}
      </p>
      {compact === true ? (
        <></>
      ) : (
        <p class="orange-id-device" safe>
          {report.deviceName}
        </p>
      )}
      <p class="orange-id-meta">
        <span>
          Received <b safe>{receivedDay(report.receivedAt)}</b>
        </span>
        <span safe>{CHANNEL_LABELS[report.channel] ?? report.channel}</span>
        <span safe>{report.formVersion}</span>
      </p>
    </div>
  );
}
