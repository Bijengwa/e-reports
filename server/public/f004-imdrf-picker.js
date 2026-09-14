/*
 * The controlled-terminology picker embedded in an F004's own Section 3 (and in a secondary
 * assessor's Disagree/Supplied replacement grid for the same seven rows).
 *
 * Enhancement only, on the same footing as `imdrf-browser.js`: everything this fills in is also
 * enforced server-side (`domain/imdrf/f004-integration.ts`) when the form is saved, so a browser
 * that blocks this script leaves a disclosure ("Change"/"Select") that opens onto an inert search
 * box, never a form that can be corrupted by disabling JavaScript — there is nothing here for the
 * assessor to type free text into either way. Search is always server-side and always paged;
 * nothing here ever fetches "every term of an annex" into the page.
 *
 * The markup this attaches to is `<details data-imdrf-picker>` (`reports/components/f004.tsx`'s
 * `ImdrfPicker`): a `<summary>` showing either the chosen term or "Choose an IMDRF term…", and a
 * body holding the search box and results. Opening/closing the disclosure is the browser's own
 * native behaviour; this script only fills in what happens inside it and updates the summary once
 * a term is picked.
 *
 * Opt-in like the door's other scripts: a page with no `[data-imdrf-picker]` does nothing.
 */
(function () {
  "use strict";

  var SEARCH_DEBOUNCE_MS = 250;
  var RESULTS_LIMIT = 20;
  // Below this, a single keystroke would dump a large slice of an annex — see the module comment.
  var MIN_QUERY_LENGTH = 2;

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  function escapeHtml(text) {
    return String(text === null || text === undefined ? "" : text).replace(
      /[&<>"']/g,
      function (ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
      },
    );
  }

  function getJson(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    });
  }

  function isNotSelectable(row) {
    return typeof row.status === "string" && row.status.toLowerCase().indexOf("not selectable") !== -1;
  }

  /** A category the assessor cannot stop at: has children of its own, or IMDRF itself marks it
   *  "Not selectable" — the same two conditions `f004-integration.ts` enforces server-side. */
  function isCategory(row) {
    return row.hasChildren === true || isNotSelectable(row);
  }

  function hint(text) {
    return '<p class="imdrf-pick-hint">' + escapeHtml(text) + "</p>";
  }

  function renderResults(container, rows, onPick) {
    if (rows.length === 0) {
      container.innerHTML = hint("No matching terms.");
      return;
    }

    container.innerHTML =
      '<ul class="imdrf-pick-list">' +
      rows
        .map(function (row) {
          var category = isCategory(row);
          var indent = Math.max(0, (row.level || 1) - 1);
          var rowClass = "imdrf-pick-result" + (category ? " imdrf-pick-result-category" : "");

          return (
            '<li class="' +
            rowClass +
            '" style="--imdrf-depth: ' +
            String(indent) +
            '">' +
            '<span class="imdrf-pick-result-main">' +
            "<code>" +
            escapeHtml(row.code) +
            "</code>" +
            '<span class="imdrf-pick-result-term">' +
            escapeHtml(row.term) +
            "</span>" +
            "</span>" +
            (category
              ? '<span class="imdrf-pick-result-note">Not selectable — choose a more specific term</span>'
              : '<button type="button" class="btn btn-sm" data-imdrf-select="' +
                escapeHtml(row.id) +
                '">Select</button>') +
            "</li>"
          );
        })
        .join("") +
      "</ul>";

    Array.prototype.slice.call(container.querySelectorAll("[data-imdrf-select]")).forEach(function (
      btn,
    ) {
      btn.addEventListener("click", function () {
        onPick(btn.getAttribute("data-imdrf-select"));
      });
    });
  }

  function fillHiddenFields(root, term) {
    var levelInputs = Array.prototype.slice.call(root.querySelectorAll("[data-imdrf-level]"));
    var lineage = Array.isArray(term.lineage) ? term.lineage : [];
    var annex = root.getAttribute("data-annex") || "";
    // Skip the annex's own root marker (a bare annex letter), the same rule
    // `f004-integration.ts` applies server-side, so an annex imported with or without that row
    // fills the same boxes either way.
    var named = lineage.filter(function (step) {
      return step.code !== annex;
    });

    levelInputs.forEach(function (input, index) {
      var step = named[index];
      input.value = step ? step.term : "";
    });

    var codeInput = root.querySelector("[data-imdrf-code]");
    if (codeInput) codeInput.value = term.code;

    var termIdSelector = root.getAttribute("data-term-id-input");
    var termIdInput = termIdSelector ? root.querySelector(termIdSelector) : null;
    if (termIdInput) termIdInput.value = term.id;

    return named;
  }

  function chosenSummaryHtml(term, ancestry) {
    var names = ancestry.map(function (step) {
      return step.term;
    });
    return (
      '<span class="imdrf-pick-chosen">' +
      '<span class="imdrf-pick-code">' +
      escapeHtml(term.code) +
      "</span>" +
      '<span class="imdrf-pick-term">' +
      escapeHtml(term.term) +
      "</span>" +
      (names.length
        ? '<span class="imdrf-pick-hierarchy">' + escapeHtml(names.join(" › ")) + "</span>"
        : "") +
      "</span>"
    );
  }

  ready(function () {
    var roots = Array.prototype.slice.call(document.querySelectorAll("[data-imdrf-picker]"));

    roots.forEach(function (root) {
      var searchInput = root.querySelector("[data-imdrf-pick-search]");
      var resultsEl = root.querySelector("[data-imdrf-pick-results]");
      var summaryMain = root.querySelector("[data-imdrf-pick-summary-main]");
      var actionEl = root.querySelector("[data-imdrf-pick-action]");
      if (!searchInput || !resultsEl) return;

      var releaseId = root.getAttribute("data-release-id") || "";
      var annex = root.getAttribute("data-annex") || "";
      var searchTimer = null;
      var searchSeq = 0;

      function runSearch(query) {
        var trimmed = query.trim();

        if (!releaseId) {
          resultsEl.innerHTML = hint("No published IMDRF release is available yet.");
          return;
        }
        if (trimmed.length < MIN_QUERY_LENGTH) {
          resultsEl.innerHTML = hint(
            "Type at least " + String(MIN_QUERY_LENGTH) + " characters to search.",
          );
          return;
        }

        var seq = ++searchSeq;
        resultsEl.innerHTML = hint("Searching…");

        getJson(
          "/imdrf/releases/" +
            encodeURIComponent(releaseId) +
            "/search?annex=" +
            encodeURIComponent(annex) +
            "&q=" +
            encodeURIComponent(trimmed) +
            "&limit=" +
            String(RESULTS_LIMIT),
        )
          .then(function (data) {
            if (seq !== searchSeq) return; // a faster keystroke already replaced this
            renderResults(resultsEl, data.rows || [], function (termId) {
              getJson("/imdrf/releases/" + encodeURIComponent(releaseId) + "/terms/" + termId)
                .then(function (term) {
                  if (isCategory(term)) {
                    // Refused server-side regardless; here it is simply not offered as done.
                    resultsEl.innerHTML = hint(
                      "That is a category, not a specific term — search for something more specific.",
                    );
                    return;
                  }
                  var ancestry = fillHiddenFields(root, term);
                  if (summaryMain) summaryMain.innerHTML = chosenSummaryHtml(term, ancestry);
                  if (actionEl) actionEl.textContent = "Change";
                  root.open = false;
                })
                .catch(function () {
                  resultsEl.innerHTML = hint("Could not load that term. Try again.");
                });
            });
          })
          .catch(function () {
            if (seq !== searchSeq) return;
            resultsEl.innerHTML = hint("Could not search. Try again.");
          });
      }

      searchInput.addEventListener("input", function () {
        window.clearTimeout(searchTimer);
        var query = searchInput.value;
        searchTimer = window.setTimeout(function () {
          runSearch(query);
        }, SEARCH_DEBOUNCE_MS);
      });

      // Re-opening the disclosure (native `<details>` toggle) is the moment to focus the search
      // box and show the minimum-length hint again, rather than whatever was left over from the
      // previous search.
      root.addEventListener("toggle", function () {
        if (!root.open) return;
        searchInput.value = "";
        resultsEl.innerHTML = hint(
          "Type at least " + String(MIN_QUERY_LENGTH) + " characters to search.",
        );
        searchInput.focus();
      });
    });
  });
})();
