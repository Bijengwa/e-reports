/**
 * The read-only IMDRF terminology reference every signed-in role reads.
 *
 * It is an ordinary staff page: `StaffShell`'s title bar above it, `staff-head` at the top of the
 * body, one native page scroll underneath. It used to be a two-pane reader that took the viewport
 * and scrolled inside itself, with its own header restating the shell's, a seven-button scope bar
 * and a column of instructions in the largest region on screen. All of that is gone. What is left
 * is the terminology, in IMDRF's own structure, and one box to search it with.
 *
 * The hierarchy is the page. Its outer level is F004's seven coding items, each bound to the one
 * annex its code must come from — `3.1.1 (G) — Medical Device Component` — because that is both
 * the workbook's structure and the question an officer arrives holding. Underneath a section sit
 * that annex's own groups (`G01`, `G02`), and underneath those the terms. Nothing below a section
 * heading is rendered until the section is opened, and nothing below a group until the group is.
 *
 * Only the seven headings and their counts are server-rendered, from one `annexSummary` query.
 * Everything else arrives from `/imdrf/releases/:id/...` as it is asked for — see
 * `/assets/imdrf-browser.js`. A release is thousands of rows; none of them are in this response.
 *
 * No inline styles anywhere: `style-src 'self'` drops them, which is how an earlier draft of this
 * page arrived with its layout missing.
 */

import { IMDRF_GROUPS } from "../../../../domain/f004.js";
import type { ReleaseSummary } from "../../../../domain/imdrf/query-service.js";
import { ANNEX_DESCRIPTIONS, type AnnexSummary } from "../../../../domain/imdrf/types.js";
import { StaffShell } from "../../shared/shell.js";

export type ImdrfBrowserPageProps = {
  releases: ReleaseSummary[];
  selected: ReleaseSummary | null;
  summary: AnnexSummary[];
  viewerRole: string;
  viewerName: string;
};

/** The seven F004 coding items, flattened — the outer level of the hierarchy on this page. */
const SECTIONS = IMDRF_GROUPS.flatMap((group) =>
  group.items.map((item) => ({
    no: `${group.no}.${item.letter}`,
    annex: item.annexLetter,
  })),
);

function countFor(summary: AnnexSummary[], annex: string): number {
  return summary.find((row) => row.annex === annex)?.count ?? 0;
}

/**
 * The release chip.
 *
 * Rendered only when there is more than one published release, because a menu of one is a control
 * that lies about having a choice in it — with a single release the header line below already
 * says which one is being read. A native `<details>`: it opens, closes and is keyboard-reachable
 * with the script blocked, which a div-and-JS dropdown would not be.
 */
function ReleaseChip({
  releases,
  selected,
}: {
  releases: ReleaseSummary[];
  selected: ReleaseSummary;
}): JSX.Element | null {
  if (releases.length < 2) return null;

  return (
    <details class="imdrf-release">
      <summary aria-label="Change release">
        Release {selected.releaseYear}
        <span class="imdrf-release-caret" aria-hidden="true"></span>
      </summary>
      <div class="imdrf-release-menu">
        <p class="imdrf-release-menu-h">Published releases</p>
        {releases.map((release) => {
          const on = release.id === selected.id;
          return (
            <a
              href={`/imdrf?release=${release.id}`}
              class={on ? "imdrf-release-opt on" : "imdrf-release-opt"}
              aria-current={on ? "true" : undefined}
            >
              <span class="imdrf-release-year">{release.releaseYear}</span>
              <span class="imdrf-release-code" safe>
                {release.documentCode ?? release.title ?? ""}
              </span>
            </a>
          );
        })}
      </div>
    </details>
  );
}

/**
 * The release line under the page title, twice: the full reference and a short one.
 *
 * Both are rendered and CSS shows one, rather than the script rewriting the line at a breakpoint.
 * A phone gets `2026 · IMDRF/AE WG/N43` where a desktop gets `IMDRF/AE WG/N43 · 2026 Release` —
 * the same two facts, ordered so the one that identifies the edition comes first in the space
 * there is. Both read the release row; neither invents a code that is not stored.
 */
function ReleaseLine({ release }: { release: ReleaseSummary }): JSX.Element {
  const code = release.documentCode;

  return (
    <p class="hint imdrf-sub">
      <span class="imdrf-sub-full">
        {code && (
          <>
            <span safe>{code}</span>
            {" · "}
          </>
        )}
        {release.releaseYear} Release
      </span>
      <span class="imdrf-sub-short">
        {release.releaseYear}
        {code && (
          <>
            {" · "}
            <span safe>{code}</span>
          </>
        )}
      </span>
    </p>
  );
}

/**
 * The shape drawn in place of content that has been asked for and has not arrived.
 *
 * Markup rather than script-built nodes so the page's opening veil and a group's own loading rows
 * are the same shape, and the shimmer has one rule governing it (`.imdrf-skel`, which
 * `prefers-reduced-motion` stills).
 */
function Skeleton({ rows }: { rows: number }): JSX.Element {
  return (
    <div class="imdrf-skel" aria-hidden="true">
      {Array.from({ length: rows }, (_unused, i) => (
        <div class="imdrf-skel-row" data-n={String(i % 3)}></div>
      ))}
    </div>
  );
}

export function ImdrfBrowserPage({
  releases,
  selected,
  summary,
  viewerRole,
  viewerName,
}: ImdrfBrowserPageProps): JSX.Element {
  return (
    <StaffShell
      title="IMDRF terminology — AE Reports"
      pageTitle="IMDRF terminology"
      pageCss="imdrf"
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
          <div class="staff-head imdrf-head">
            <div class="sp">
              <h2 class="imdrf-title">
                <span class="imdrf-title-full">IMDRF technical terminologies</span>
                <span class="imdrf-title-short">IMDRF tech terminologies</span>
              </h2>
              <ReleaseLine release={selected} />
            </div>
            <ReleaseChip releases={releases} selected={selected} />
          </div>

          <div class="imdrf-searchbar">
            <span class="imdrf-searchicon" aria-hidden="true"></span>
            <input
              type="search"
              id="imdrf-search"
              class="imdrf-search"
              data-imdrf-search
              placeholder="Search IMDRF terminology…"
              aria-label="Search IMDRF terminology"
              aria-describedby="imdrf-search-note"
              autocomplete="off"
              spellcheck={false}
            />
          </div>
          <p class="imdrf-search-note" id="imdrf-search-note" data-imdrf-search-note hidden></p>

          {/* Search results replace the hierarchy rather than sitting beside it: one region of
              the page answers "what am I looking at", and a result list that opened alongside
              would leave the reader deciding which of two lists was the live one. */}
          <div
            class="imdrf-results"
            data-imdrf-results
            role="region"
            aria-label="Search results"
            aria-live="polite"
            hidden
          ></div>

          <div class="imdrf-reader" data-imdrf-tree>
            {SECTIONS.map((section) => {
              const count = countFor(summary, section.annex);
              return (
                <section
                  class="imdrf-section"
                  data-imdrf-section={section.annex}
                  data-loaded="false"
                >
                  <h3 class="imdrf-section-h">
                    <button
                      type="button"
                      class="imdrf-section-btn"
                      data-role="section-toggle"
                      aria-expanded="false"
                      aria-controls={`imdrf-section-${section.annex}`}
                    >
                      <span class="imdrf-caret" aria-hidden="true"></span>
                      <span class="imdrf-section-no" safe>
                        {section.no} ({section.annex})
                      </span>
                      <span class="imdrf-section-name">{ANNEX_DESCRIPTIONS[section.annex]}</span>
                      <span class="imdrf-section-count">
                        {count.toLocaleString("en")} term{count === 1 ? "" : "s"}
                      </span>
                    </button>
                  </h3>
                  <div
                    class="imdrf-section-body"
                    id={`imdrf-section-${section.annex}`}
                    data-role="section-body"
                    hidden
                  ></div>
                </section>
              );
            })}

            {/* The first load, and only the first: a dim over the hierarchy with one skeleton
                surface on it. Removed by the script once the opening section settles, whether or
                not it arrived — a page that kept its veil after a failed fetch would be telling
                the reader to keep waiting for something that is not coming. */}
            <div class="imdrf-boot" data-imdrf-boot>
              <div class="imdrf-boot-card">
                <p class="imdrf-boot-h">Loading terminology…</p>
                <Skeleton rows={6} />
              </div>
            </div>
          </div>
        </div>
      )}
      {selected && <script src="/assets/imdrf-browser.js" defer></script>}
    </StaffShell>
  );
}
