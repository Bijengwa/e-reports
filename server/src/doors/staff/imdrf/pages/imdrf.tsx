
import { IMDRF_GROUPS } from "../../../../domain/f004.js";
import type { ReleaseSummary } from "../../../../domain/imdrf/query-service.js";
import { ANNEX_DESCRIPTIONS, type AnnexSummary } from "../../../../domain/imdrf/types.js";
import { asset } from "../../../../views/shared/asset.js";
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

function SectionStrip(): JSX.Element {
  return (
    <nav class="imdrf-nav" data-nav-strip aria-label="Terminology sections">
      <div class="imdrf-nav-track" data-imdrf-nav-track>
        {SECTIONS.map((section) => (
          <button type="button" class="imdrf-nav-item" data-imdrf-jump={section.annex}>
            <span class="imdrf-nav-no" safe>
              {section.no} ({section.annex})
            </span>
            <span class="vh">{ANNEX_DESCRIPTIONS[section.annex]}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

/**
 * Which release is open, in the title bar.
 *
 * It belongs beside the page's name and the signed-in name because that is what it is: a fact
 * about the whole page, true of every term under it, and not one of the terms. It used to head
 * the body as a block of labelled metadata — document code, release, term count, publication
 * date — which put four facts nobody had asked for between the reader and the terminology.
 *
 * With one published release this is a plain caption. With more than one it is the chooser, kept
 * as a native `<details>` so it opens, closes and is keyboard-reachable with the script blocked.
 */
function ReleaseBadge({
  releases,
  selected,
}: {
  releases: ReleaseSummary[];
  selected: ReleaseSummary;
}): JSX.Element {
  if (releases.length < 2) {
    return (
      <span class="top-release">
        <span class="top-release-word">Release</span> {selected.releaseYear}
      </span>
    );
  }

  return (
    <details class="top-release imdrf-release">
      <summary aria-label="Change release">
        <span class="top-release-word">Release</span> {selected.releaseYear}
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
      title="IMDRF terminology — e-reports"
      pageTitle="IMDRF terminology"
      titleExtra={selected ? <ReleaseBadge releases={releases} selected={selected} /> : undefined}
      pageCss="imdrf"
      role={viewerRole}
      fullName={viewerName}
      active="imdrf"
    >
      {releases.length === 0 || selected === null ? (
        <div class="imdrf-empty">
          <p class="imdrf-empty-h">No terminology is published</p>
          <p class="hint">
            An administrator has not yet published an IMDRF release. Until one is published there is
            nothing to browse here, and F004 section 3 has no codes to draw on.
          </p>
        </div>
      ) : (
        <>
 
          <SectionStrip />

          <div class="imdrf-page" data-imdrf-browser data-release-id={selected.id}>

            <search class="imdrf-searchzone">
              <label class="vh" for="imdrf-search">
                Search IMDRF terminology
              </label>
              <div class="imdrf-searchbar">
                <span class="imdrf-searchicon" aria-hidden="true"></span>
                <input
                  type="search"
                  id="imdrf-search"
                  class="imdrf-search"
                  data-imdrf-search
                  placeholder="Search codes, terms and definitions…"
                  aria-describedby="imdrf-search-scope imdrf-search-note"
                  autocomplete="off"
                  {...{ spellcheck: "false" }}
                />
              </div>
              {/* What the box actually does, said once and permanently, rather than a tip that
                appears after the reader has already guessed. It is the truth of the query in
                `searchTerms`: code, term and definition, over the whole release. */}
              <p class="imdrf-search-scope" id="imdrf-search-scope">
                Searches codes, terms and definitions across all {SECTIONS.length} annexes of this
                release.
              </p>
              <p class="imdrf-search-note" id="imdrf-search-note" data-imdrf-search-note hidden></p>
            </search>

            {/* Search results replace the hierarchy rather than sitting beside it: one region of
              the page answers "what am I looking at", and a result list that opened alongside
              would leave the reader deciding which of two lists was the live one. */}
            <section
              class="imdrf-results"
              data-imdrf-results
              aria-label="Search results"
              aria-live="polite"
              hidden
            ></section>

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
        </>
      )}
      {selected && <script src={asset("imdrf-browser.js")} defer></script>}
    </StaffShell>
  );
}
