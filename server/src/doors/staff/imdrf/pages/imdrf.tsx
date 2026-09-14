/**
 * The read-only IMDRF terminology handbook every signed-in role reads.
 *
 * What this page is FOR decides its shape. Nobody opens it to browse IMDRF: they open it holding
 * a report, with F004 section 3 in front of them, needing the one code that goes in one coding
 * box. So the page is organised by that question — the seven F004 coding items, each bound to the
 * annex its code must come from — rather than by the workbook's own A–G filing order, which is a
 * fact about the source document and not about the work.
 *
 * Two readers arrive. One knows the code, or most of it, and wants the box: they type into the
 * search, which ranks an exact code first (see `searchTerms`). One knows only what they saw and
 * not which of seven boxes it belongs in: they get the questions restated in plain language, an
 * annex tree to drill, and an opening panel that says what to do — which is why the right pane's
 * empty state is a short guide rather than the one grey sentence it used to be.
 *
 * Release switching is a chip in the header, not a tab bar. A tab bar gave a second-order fact
 * ("which published year am I reading") a full row and equal weight with the annexes, and at two
 * releases it already read as the page's primary navigation. The current release is what an
 * officer wants in every case but one; the menu keeps that one case reachable without paying a
 * row for it.
 *
 * The page itself is server-rendered like every other staff page. The tree, the search results
 * and the term document are the one place this door fetches JSON client-side — expanding a branch
 * of a few-thousand-row hierarchy would otherwise be a full page load per twisty.
 * `/assets/imdrf-browser.js` renders those three panels; this file draws everything around them.
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

/** The seven F004 coding items, flattened, each carrying the group heading it sits under. */
const CODING_ITEMS = IMDRF_GROUPS.flatMap((group) =>
  group.items.map((item) => ({
    no: `${group.no}.${item.letter}`,
    groupTitle: group.title,
    annex: item.annexLetter,
    question: item.question,
    levels: item.levels,
  })),
);

function termTotal(summary: AnnexSummary[]): number {
  return summary.reduce((sum, row) => sum + row.count, 0);
}

function countFor(summary: AnnexSummary[], annex: string): number {
  return summary.find((row) => row.annex === annex)?.count ?? 0;
}

/**
 * The release chip.
 *
 * A bare label when there is one published release, because a menu of one is a control that lies
 * about having a choice in it. A native `<details>` when there is more than one: it opens, closes
 * and is keyboard-reachable with the script blocked, which a div-and-JS dropdown would not be.
 */
function ReleaseChip({
  releases,
  selected,
}: {
  releases: ReleaseSummary[];
  selected: ReleaseSummary;
}): JSX.Element {
  const label = (
    <>
      Release {selected.releaseYear}
      {selected.documentCode && (
        <>
          {" · "}
          <span safe>{selected.documentCode}</span>
        </>
      )}
    </>
  );

  if (releases.length < 2) return <p class="imdrf-release-flat">{label}</p>;

  return (
    <details class="imdrf-release">
      <summary aria-label="Change release">
        {label}
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
 * The right pane before a term is chosen.
 *
 * The old page spent this space on one grey sentence. It is the largest region on the screen and
 * the first thing an officer who has never coded a report sees, so it carries the instructions
 * instead: what the page is for, the seven questions with the F004 item each one answers, and the
 * one fact that changes how the form is filled — that only the coding box is typed, and the
 * preferred-terminology levels follow from it.
 */
function StartPanel({ summary }: { summary: AnnexSummary[] }): JSX.Element {
  return (
    <div class="imdrf-start">
      <p class="eyebrow">Start here</p>
      <h3 class="imdrf-start-h">Find the code for an F004 section 3 field</h3>
      <p class="imdrf-start-lede">
        Pick the question you are answering above, then either type what you saw ("battery leaked",
        "burn") or the code you already have. Choose a term and this pane shows its definition and
        the exact value to enter.
      </p>

      <ol class="imdrf-steps">
        <li>
          <span class="imdrf-step-n">1</span>
          <span>
            Choose the F004 item you are filling. Each one draws from one annex, so the search is
            narrowed to codes you are allowed to use there.
          </span>
        </li>
        <li>
          <span class="imdrf-step-n">2</span>
          <span>
            Search in plain words, or browse the tree from the broadest term down. Search also
            matches definitions, so a word from the report often finds the term.
          </span>
        </li>
        <li>
          <span class="imdrf-step-n">3</span>
          <span>
            Read the definition before you take the code. Copy the code into the coding box in F004
            — the preferred terminology levels are filled from it, not typed.
          </span>
        </li>
      </ol>

      <p class="imdrf-start-h2">The seven coding items</p>
      <ul class="imdrf-qlist">
        {CODING_ITEMS.map((item) => (
          <li>
            <button type="button" class="imdrf-qbtn" data-imdrf-scope={item.annex}>
              <span class="imdrf-qno" safe>
                {item.no}
              </span>
              <span class="imdrf-qtext">
                <span class="imdrf-qq" safe>
                  {item.question}
                </span>
                <span class="imdrf-qmeta">
                  Annex {item.annex} · {ANNEX_DESCRIPTIONS[item.annex]} ·{" "}
                  {countFor(summary, item.annex).toLocaleString("en")} terms
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
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
          <div class="staff-head imdrf-head">
            <div class="sp">
              <h2 safe>{selected.title ?? "IMDRF Adverse Event Terminology"}</h2>
              <p class="hint">
                The codes F004 section 3 asks for, with their definitions. Read-only.
                {total > 0 && (
                  <>
                    {" "}
                    {total.toLocaleString("en")} term{total === 1 ? "" : "s"} across{" "}
                    {summary.length} annex{summary.length === 1 ? "" : "es"}.
                  </>
                )}
              </p>
            </div>
            <ReleaseChip releases={releases} selected={selected} />
          </div>

          {/*
            The scope bar. These are F004's items, not the workbook's annexes, because "3.1.2 —
            what went wrong with the device" is a question an officer can answer from the report
            in front of them and "Annex A" is not. The annex still shows, small, since it is what
            the paper cites.
          */}
          <fieldset class="imdrf-scopes">
            <legend class="imdrf-scopes-legend">Which F004 field are you coding?</legend>
            {CODING_ITEMS.map((item, i) => (
              <button
                type="button"
                class={i === 0 ? "imdrf-scope on" : "imdrf-scope"}
                data-imdrf-scope={item.annex}
                data-imdrf-scope-no={item.no}
                data-imdrf-scope-question={item.question}
                aria-pressed={i === 0 ? "true" : "false"}
              >
                <span class="imdrf-scope-no" safe>
                  {item.no}
                </span>
                <span class="imdrf-scope-name">{ANNEX_DESCRIPTIONS[item.annex]}</span>
                <span class="imdrf-scope-annex" safe>
                  {item.annex}
                </span>
              </button>
            ))}
          </fieldset>

          <div class="imdrf-searchbar">
            <div class="imdrf-searchwrap">
              <span class="imdrf-searchicon" aria-hidden="true"></span>
              <input
                type="search"
                class="imdrf-search"
                data-imdrf-search
                placeholder="Search this annex — a code, a term, or what you saw…"
                aria-label="Search terminology"
                autocomplete="off"
                spellcheck={false}
              />
            </div>
            <p class="imdrf-scope-hint" data-imdrf-scope-hint></p>
          </div>

          <div class="imdrf-reader">
            <aside class="imdrf-toc">
              <p class="imdrf-toc-h" data-imdrf-toc-head>
                Browse
              </p>
              <div class="imdrf-list" data-imdrf-tree></div>
              <div class="imdrf-list" data-imdrf-results hidden></div>
            </aside>
            <article class="imdrf-doc" data-imdrf-detail>
              <StartPanel summary={summary} />
            </article>
          </div>
        </div>
      )}
      {selected && <script src="/assets/imdrf-browser.js" defer></script>}
    </StaffShell>
  );
}
