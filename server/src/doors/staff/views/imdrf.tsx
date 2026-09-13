/**
 * The read-only IMDRF terminology browser every signed-in role reads.
 *
 * The page itself is server-rendered, same as every other staff page. The tree/search panels are
 * the one place this door fetches JSON client-side rather than a full page per click — expanding
 * one branch of a few-thousand-row hierarchy, or typing into a search box, would otherwise mean a
 * full-page reload per keystroke or per twisty. `/assets/imdrf-browser.js` (loaded below, same
 * opt-in-per-page pattern as `f4Find`/`railScript`) is what renders those panels from the JSON the
 * routes in `routes/imdrf.ts` return — this file draws the page shell around it and nothing more.
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

export function ImdrfBrowserPage({
  releases,
  selected,
  summary,
  viewerRole,
  viewerName,
}: ImdrfBrowserPageProps): JSX.Element {
  return (
    <StaffShell
      title="IMDRF Terminology — AE Reports"
      pageTitle="IMDRF Terminology"
      role={viewerRole}
      fullName={viewerName}
      active="imdrf"
    >
      {releases.length === 0 ? (
        <p class="hint">No IMDRF terminology has been published yet.</p>
      ) : (
        <>
          <nav class="rail-nav" aria-label="IMDRF releases" style="flex-direction: row; gap: 8px;">
            {releases.map((release) => (
              <a
                href={`/imdrf?release=${release.id}`}
                class={selected?.id === release.id ? "btn" : "btn ghost"}
              >
                {release.releaseYear}
              </a>
            ))}
          </nav>

          {selected && (
            <div data-imdrf-browser data-release-id={selected.id}>
              <div class="f">
                <input
                  type="search"
                  data-imdrf-search
                  placeholder="Search terminology…"
                  aria-label="Search terminology"
                />
              </div>

              <nav
                class="rail-nav"
                aria-label="Annex"
                style="flex-direction: row; flex-wrap: wrap; gap: 8px;"
              >
                {summary.map((row, i) => (
                  <button
                    type="button"
                    class={i === 0 ? "btn on" : "btn ghost"}
                    data-imdrf-annex={row.annex}
                  >
                    {row.annex} — {ANNEX_TITLES[row.annex] ?? ""} ({row.count})
                  </button>
                ))}
              </nav>

              <div style="display:flex; gap:24px; align-items:flex-start;">
                <div data-imdrf-results hidden style="flex:1;" />
                <div data-imdrf-tree style="flex:1;" />
                <div data-imdrf-detail style="flex:1;" />
              </div>
            </div>
          )}
        </>
      )}
      {selected && <script src="/assets/imdrf-browser.js" defer></script>}
    </StaffShell>
  );
}
