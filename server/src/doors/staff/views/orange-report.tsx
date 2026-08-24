// Type-only, and that matters: `reports.tsx` imports the component below, so a value import here
// would close a runtime cycle between the two modules. A type import is erased.
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
      <p class="orange-id-kind">Orange Adverse Event Report</p>
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
