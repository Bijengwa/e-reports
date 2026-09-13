/*
 * The IMDRF terminology handbook: annex tree (expand-on-demand), search-with-debounce, and a term
 * document pane. Every list here comes from the server already paged — nothing in this file ever
 * fetches "all terms" and filters client-side. Opt-in like the door's other scripts: a page with
 * no `[data-imdrf-browser]` container loads this file (it is only ever referenced from the one
 * page that has one) and does nothing.
 *
 * Indent is a `data-depth` attribute, never an inline style: the CSP `style-src 'self'` would
 * drop a `padding-left` written here, which is how an earlier draft of this tree arrived flat.
 */
(function () {
  "use strict";

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

  function emptyHint(text) {
    return '<p class="hint">' + escapeHtml(text) + "</p>";
  }

  ready(function () {
    var root = document.querySelector("[data-imdrf-browser]");
    if (!root) return;

    var releaseId = root.getAttribute("data-release-id");
    var searchInput = root.querySelector("[data-imdrf-search]");
    var resultsEl = root.querySelector("[data-imdrf-results]");
    var treeEl = root.querySelector("[data-imdrf-tree]");
    var detailEl = root.querySelector("[data-imdrf-detail]");
    var annexButtons = root.querySelectorAll("[data-imdrf-annex]");
    var searchTimer = null;
    var selectedId = null;

    function termRowHtml(row, depth) {
      var hasChildren = row.hasChildren === true;
      return (
        '<div class="imdrf-row" data-id="' +
        escapeHtml(row.id) +
        '" data-has-children="' +
        hasChildren +
        '" data-expanded="false" data-depth="' +
        String(depth) +
        '">' +
        '<button type="button" class="imdrf-toggle" data-role="toggle"' +
        (hasChildren ? ' aria-expanded="false" aria-label="Expand"' : ' tabindex="-1"') +
        ">" +
        '<span class="imdrf-caret" aria-hidden="true"></span>' +
        "</button>" +
        '<button type="button" class="imdrf-term-btn" data-role="detail">' +
        "<code>" +
        escapeHtml(row.code) +
        "</code>" +
        "<span>" +
        escapeHtml(row.term) +
        "</span>" +
        "</button>" +
        '<div class="imdrf-children" data-role="children"></div>' +
        "</div>"
      );
    }

    function renderRows(container, rows, depth) {
      container.innerHTML =
        rows
          .map(function (row) {
            return termRowHtml(row, depth);
          })
          .join("") || emptyHint("No terms.");
    }

    function markSelected(termId) {
      selectedId = termId;
      root.querySelectorAll(".imdrf-term-btn.on").forEach(function (btn) {
        btn.classList.remove("on");
      });
      if (!termId) return;
      var match = root.querySelector('.imdrf-row[data-id="' + termId + '"] > .imdrf-term-btn');
      if (match) match.classList.add("on");
    }

    function attachRowHandlers(container, depth) {
      var rows = container.querySelectorAll(":scope > .imdrf-row");
      rows.forEach(function (rowEl) {
        var toggleBtn = rowEl.querySelector('[data-role="toggle"]');
        var labelBtn = rowEl.querySelector('[data-role="detail"]');
        var childrenEl = rowEl.querySelector('[data-role="children"]');
        var termId = rowEl.getAttribute("data-id");

        if (termId === selectedId) labelBtn.classList.add("on");

        labelBtn.addEventListener("click", function () {
          markSelected(termId);
          loadDetail(termId);
        });

        if (rowEl.getAttribute("data-has-children") !== "true") return;

        toggleBtn.addEventListener("click", function () {
          var expanded = rowEl.getAttribute("data-expanded") === "true";
          if (expanded) {
            rowEl.setAttribute("data-expanded", "false");
            toggleBtn.setAttribute("aria-expanded", "false");
            toggleBtn.setAttribute("aria-label", "Expand");
            childrenEl.innerHTML = "";
            return;
          }
          fetch(
            "/imdrf/releases/" +
              releaseId +
              "/terms?parentId=" +
              encodeURIComponent(termId),
          )
            .then(function (r) {
              return r.json();
            })
            .then(function (data) {
              renderRows(childrenEl, data.rows, depth + 1);
              attachRowHandlers(childrenEl, depth + 1);
              rowEl.setAttribute("data-expanded", "true");
              toggleBtn.setAttribute("aria-expanded", "true");
              toggleBtn.setAttribute("aria-label", "Collapse");
            });
        });
      });
    }

    function resetDetail() {
      selectedId = null;
      detailEl.innerHTML = emptyHint("Choose a term from the list to read its definition.");
    }

    function loadAnnex(annex) {
      treeEl.innerHTML = emptyHint("Loading…");
      resultsEl.innerHTML = "";
      resultsEl.hidden = true;
      treeEl.hidden = false;
      resetDetail();
      fetch("/imdrf/releases/" + releaseId + "/terms?annex=" + encodeURIComponent(annex))
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          renderRows(treeEl, data.rows, 0);
          attachRowHandlers(treeEl, 0);
        });
    }

    function loadDetail(termId) {
      detailEl.innerHTML = emptyHint("Loading…");
      fetch("/imdrf/releases/" + releaseId + "/terms/" + encodeURIComponent(termId))
        .then(function (r) {
          return r.json();
        })
        .then(function (term) {
          if (!term) {
            detailEl.innerHTML = emptyHint("Not found.");
            return;
          }
          var statusText = String(term.status || "");
          var lowered = statusText.toLowerCase();
          var isQuiet =
            lowered.indexOf("retired") !== -1 || lowered.indexOf("not selectable") !== -1;
          var status = statusText
            ? '<span class="tag' +
              (isQuiet ? " muted" : "") +
              '">' +
              escapeHtml(statusText) +
              "</span>"
            : "";
          var crumb = String(term.codeHierarchy || "")
            .split("|")
            .filter(Boolean)
            .join(" › ");
          var html =
            '<p class="eyebrow">Annex ' +
            escapeHtml(term.annex) +
            " · Level " +
            escapeHtml(term.level) +
            "</p>" +
            '<h2 class="imdrf-entry-code"><code>' +
            escapeHtml(term.code) +
            "</code></h2>" +
            '<p class="imdrf-entry-term">' +
            escapeHtml(term.term) +
            "</p>";
          if (status) html += "<p>" + status + "</p>";
          if (crumb && crumb !== String(term.code)) {
            html += '<p class="imdrf-entry-crumb">' + escapeHtml(crumb) + "</p>";
          }
          if (term.definition) {
            html += '<p class="imdrf-entry-def">' + escapeHtml(term.definition) + "</p>";
          }
          if (term.statusDescription) {
            html += '<p class="hint">' + escapeHtml(term.statusDescription) + "</p>";
          }
          var meta = "";
          if (term.nonImdrfCode) {
            meta +=
              "<div><dt>Non-IMDRF code</dt><dd>" +
              escapeHtml(term.nonImdrfCode) +
              "</dd></div>";
          }
          if (term.primaryCategory) {
            meta +=
              "<div><dt>Primary category</dt><dd>" +
              escapeHtml(term.primaryCategory) +
              "</dd></div>";
          }
          if (term.secondaryCategory) {
            meta +=
              "<div><dt>Secondary category</dt><dd>" +
              escapeHtml(term.secondaryCategory) +
              "</dd></div>";
          }
          if (meta) html += '<dl class="imdrf-entry-meta">' + meta + "</dl>";
          detailEl.innerHTML = html;
        });
    }

    annexButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        annexButtons.forEach(function (b) {
          b.classList.remove("on");
        });
        btn.classList.add("on");
        if (searchInput) searchInput.value = "";
        loadAnnex(btn.getAttribute("data-imdrf-annex"));
      });
    });

    if (searchInput) {
      searchInput.addEventListener("input", function () {
        var query = searchInput.value;
        if (searchTimer) clearTimeout(searchTimer);
        if (query.trim() === "") {
          resultsEl.innerHTML = "";
          resultsEl.hidden = true;
          treeEl.hidden = false;
          return;
        }
        searchTimer = setTimeout(function () {
          resultsEl.innerHTML = emptyHint("Searching…");
          treeEl.hidden = true;
          resultsEl.hidden = false;
          fetch("/imdrf/releases/" + releaseId + "/search?q=" + encodeURIComponent(query))
            .then(function (r) {
              return r.json();
            })
            .then(function (data) {
              renderRows(resultsEl, data.rows, 0);
              attachRowHandlers(resultsEl, 0);
            });
        }, 300);
      });
    }

    var firstAnnex = root.querySelector(".imdrf-annex.on, [data-imdrf-annex]");
    if (firstAnnex) loadAnnex(firstAnnex.getAttribute("data-imdrf-annex"));
  });
})();
