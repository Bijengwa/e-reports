/**
 * The read-only IMDRF terminology handbook every signed-in role reads.
 *
 * The page itself is server-rendered, same as every other staff page. The tree/search panels are
 * the one place this door fetches JSON client-side rather than a full page per click — expanding
 * one branch of a few-thousand-row hierarchy, or typing into a search box, would otherwise mean a
 * full-page reload per keystroke or per twisty. `/assets/imdrf-browser.js` (loaded below, same
 * opt-in-per-page pattern as `f4Find`/`railScript`) is what renders those panels from the JSON the
 * routes in `routes/imdrf.ts` return — this file draws the page shell around it and nothing more.
 *
 * Layout follows the rest of the door: the title bar carries the page name alone, `.staff-head`
 * introduces the document, and year switching (when more than one release is published) is the
 * same tab bar Workload already uses. The reader itself is a two-pane handbook — annex list and
 * term tree on the left, the selected term as a document on the right — not a second copy of the
 * rail. No inline styles: `style-src 'self'` would drop them, which is how an earlier draft of
 * this page arrived with its layout missing.
 */

import type { ReleaseSummary } from "../../../domain/imdrf/query-service.js";
import type { AnnexSummary } from "../../../domain/imdrf/types.js";
import { StaffShell } from "./shell.js";

const ANNEX_TITLES: Record<string, string> = {
  A: "Medical Device Problem",
  B: "Type of Investigation",
  C: "Investigation Findings",
  D: "Investigation Conclusion",
  E: "Clinical Signs, Symptoms or Conditions",
  F: "Health Impact",
  G: "Medical Device Component",
};

export type ImdrfBrowserPageProps = {
  releases: ReleaseSummary[];
  selected: ReleaseSummary | null;
  summary: AnnexSummary[];
  viewerRole: string;
  viewerName: string;
};

function termTotal(summary: AnnexSummary[]): number {
  return summary.reduce((sum, row) => sum + row.count, 0);
}

export function ImdrfBrowserPage({
  releases,
  selected,
  summary,
  viewerRole,
  viewerName,
}: ImdrfBrowserPageProps): JSX.Element {
  const total = termTotal(summary);

  return (
    <StaffShell
      title="IMDRF terminology — AE Reports"
      pageTitle="IMDRF terminology"
      role={viewerRole}
      fullName={viewerName}
      active="imdrf"
    >
      {releases.length === 0 || selected === null ? (
        <div class="staff-head">
          <div class="sp">
            <p class="hint">No IMDRF terminology has been published yet.</p>
          </div>
        </div>
      ) : (
        <div class="imdrf-page" data-imdrf-browser data-release-id={selected.id}>
          <div class="staff-head">
            <div class="sp">
              <p class="eyebrow">
                Release {selected.releaseYear}
                {selected.documentCode && (
                  <>
                    {" · "}
                    <span safe>{selected.documentCode}</span>
                  </>
                )}
              </p>
              <h2 safe>{selected.title ?? "IMDRF Adverse Event Terminology"}</h2>
              <p class="hint">
                A read-only handbook of published IMDRF codes and definitions. Officers look terms
                up here while assessing a report.
                {total > 0 && (
                  <>
                    {" "}
                    {total.toLocaleString("en")} term{total === 1 ? "" : "s"} across{" "}
                    {summary.length} annex{summary.length === 1 ? "" : "es"}.
                  </>
                )}
              </p>
            </div>
            <input
              type="search"
              class="imdrf-search"
              data-imdrf-search
              placeholder="Search code, term or definition…"
              aria-label="Search terminology"
            />
          </div>

          {releases.length > 1 && (
            <nav class="wl-tabs" aria-label="IMDRF releases">
              {releases.map((release) => {
                const on = selected.id === release.id;
                return (
                  <a
                    href={`/imdrf?release=${release.id}`}
                    class={on ? "on" : ""}
                    aria-current={on ? "true" : undefined}
                  >
                    {release.releaseYear}
                  </a>
                );
              })}
            </nav>
          )}

          <div class="imdrf-reader">
            <aside class="imdrf-toc">
              <nav class="imdrf-annexes" aria-label="Annex">
                {summary.map((row, i) => (
                  <button
                    type="button"
                    class={i === 0 ? "imdrf-annex on" : "imdrf-annex"}
                    data-imdrf-annex={row.annex}
                  >
                    <span class="imdrf-annex-code" safe>
                      {row.annex}
                    </span>
                    <span class="imdrf-annex-name">{ANNEX_TITLES[row.annex] ?? ""}</span>
                    <span class="imdrf-annex-count">{row.count}</span>
                  </button>
                ))}
              </nav>
              <div class="imdrf-list" data-imdrf-tree></div>
              <div class="imdrf-list" data-imdrf-results hidden></div>
            </aside>
            <article class="imdrf-doc" data-imdrf-detail>
              <p class="hint">Choose a term from the list to read its definition.</p>
            </article>
          </div>
        </div>
      )}
      {selected && <script src="/assets/imdrf-browser.js" defer></script>}
    </StaffShell>
  );
}
