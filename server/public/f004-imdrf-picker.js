/*
 * The controlled-terminology picker embedded in an F004's own Section 3 (and in a secondary
 * assessor's Disagree/Supplied replacement grid for the same seven rows).
 *
 * Enhancement only, on the same footing as `imdrf-browser.js`: everything this fills in is also
 * enforced server-side (`domain/imdrf/f004-integration.ts`) when the form is saved, so a browser
 * that blocks this script leaves a working "Choose term…" button that does nothing rather than a
 * form that can be corrupted by disabling JavaScript. Search is always server-side and always
 * paged — nothing here ever fetches "every term of an annex" into the page.
 *
 * Opt-in like the door's other scripts: a page with no `[data-imdrf-picker]` does nothing.
 */
(function () {
  "use strict";

  var SEARCH_DEBOUNCE_MS = 250;
  var RESULTS_LIMIT = 20;

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value).replace(
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

  function currentReleaseId(root) {
    var selectId = root.getAttribute("data-release-select");
    if (selectId) {
      var select = document.getElementById(selectId);
      return select && select.value ? select.value : "";
    }
    return root.getAttribute("data-release-id") || "";
  }

  function fillFrom(root, term) {
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
  }

  function closePanel(panel, button) {
    panel.hidden = true;
    if (button) button.setAttribute("aria-expanded", "false");
  }

  function renderResults(container, rows, onPick) {
    if (rows.length === 0) {
      container.innerHTML = '<p class="hint">No matching terms.</p>';
      return;
    }

    container.innerHTML = rows
      .map(function (row) {
        return (
          '<button type="button" class="imdrf-pick-row" data-id="' +
          escapeHtml(row.id) +
          '" data-has-children="' +
          (row.hasChildren === true) +
          '"><code>' +
          escapeHtml(row.code) +
          "</code><span>" +
          escapeHtml(row.term) +
          "</span>" +
          (row.hasChildren
            ? '<em class="hint"> — has more specific terms; keep typing to reach one</em>'
            : "") +
          "</button>"
        );
      })
      .join("");

    Array.prototype.slice.call(container.querySelectorAll(".imdrf-pick-row")).forEach(function (
      btn,
    ) {
      btn.addEventListener("click", function () {
        onPick(btn.getAttribute("data-id"));
      });
    });
  }

  ready(function () {
    var roots = Array.prototype.slice.call(document.querySelectorAll("[data-imdrf-picker]"));

    roots.forEach(function (root) {
      var openButton = root.querySelector("[data-imdrf-pick-open]");
      var panel = root.querySelector("[data-imdrf-pick-panel]");
      if (!openButton || !panel) return;

      var searchInput = panel.querySelector("[data-imdrf-pick-search]");
      var resultsEl = panel.querySelector("[data-imdrf-pick-results]");
      var searchTimer = null;
      var searchSeq = 0;

      function runSearch(query) {
        var releaseId = currentReleaseId(root);
        var annex = root.getAttribute("data-annex") || "";
        if (!releaseId) {
          resultsEl.innerHTML =
            '<p class="hint">Choose the IMDRF release above first.</p>';
          return;
        }
        if (query.trim() === "") {
          resultsEl.innerHTML = '<p class="hint">Type a code or a term to search.</p>';
          return;
        }

        var seq = ++searchSeq;
        resultsEl.innerHTML = '<p class="hint">Searching…</p>';

        getJson(
          "/imdrf/releases/" +
            encodeURIComponent(releaseId) +
            "/search?annex=" +
            encodeURIComponent(annex) +
            "&q=" +
            encodeURIComponent(query) +
            "&limit=" +
            String(RESULTS_LIMIT),
        )
          .then(function (data) {
            if (seq !== searchSeq) return; // a faster keystroke already replaced this
            renderResults(resultsEl, data.rows || [], function (termId) {
              getJson(
                "/imdrf/releases/" + encodeURIComponent(releaseId) + "/terms/" + termId,
              ).then(function (term) {
                if (term.hasChildren) {
                  // Chosen anyway is refused server-side; here it is simply not offered as done.
                  resultsEl.innerHTML =
                    '<p class="hint">That is a category, not a specific term — search for something more specific within it.</p>';
                  return;
                }
                fillFrom(root, term);
                closePanel(panel, openButton);
              });
            });
          })
          .catch(function () {
            if (seq !== searchSeq) return;
            resultsEl.innerHTML = '<p class="hint">Could not search. Try again.</p>';
          });
      }

      openButton.addEventListener("click", function () {
        var opening = panel.hidden;
        panel.hidden = !opening;
        openButton.setAttribute("aria-expanded", opening ? "true" : "false");
        if (opening && searchInput) {
          searchInput.value = "";
          resultsEl.innerHTML = '<p class="hint">Type a code or a term to search.</p>';
          searchInput.focus();
        }
      });

      if (searchInput) {
        searchInput.addEventListener("input", function () {
          window.clearTimeout(searchTimer);
          var query = searchInput.value;
          searchTimer = window.setTimeout(function () {
            runSearch(query);
          }, SEARCH_DEBOUNCE_MS);
        });
      }
    });
  });
})();
