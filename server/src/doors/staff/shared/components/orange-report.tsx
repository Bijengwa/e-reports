// Type-only, and that matters: nothing in this module should close a runtime cycle with a page
// that imports it.
import type { Children } from "@kitajs/html";
import type { ReportDetail } from "../../../../domain/report-detail.js";
import { FORM_TITLE } from "../../../../domain/reports.js";

/**
 * How a report reached us, in words. Part of the Orange Report's own identity.
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
 * A scope class, never a change to `.card`, `.btn` or `.report-group` themselves. Every rule lives
 * under `.orange-report-surface` in the stylesheet, so the treatment reaches exactly what is inside
 * this element and nothing else.
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
   * else telling them which report they opened.
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
 * One component rather than a class anyone can reach for, on purpose: "consistent Orange Report
 * identity" is a promise about what the colour MEANS. The identity is the number, the date it was
 * received and the form it arrived on.
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
