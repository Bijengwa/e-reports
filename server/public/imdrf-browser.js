/*
 * The IMDRF terminology browser: annex tree (expand-on-demand), search-with-debounce, and a term
 * detail panel. Every list here comes from the server already paged — nothing in this file ever
 * fetches "all terms" and filters client-side. Opt-in like the door's other scripts: a page with
 * no `[data-imdrf-browser]` container loads this file (it is only ever referenced from the one
 * page that has one) and does nothing.
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

    function termRowHtml(row, depth) {
      var indent = "padding-left:" + depth * 16 + "px";
      var caret = row.hasChildren
        ? '<span class="imdrf-caret" aria-hidden="true">›</span>'
        : '<span class="imdrf-caret" aria-hidden="true"></span>';
      return (
        '<div class="imdrf-row" style="' +
        indent +
        '" data-id="' +
        escapeHtml(row.id) +
        '" data-has-children="' +
        row.hasChildren +
        '" data-expanded="false">' +
        '<button type="button" class="imdrf-row-btn" data-role="toggle">' +
        caret +
        "</button>" +
        '<button type="button" class="imdrf-row-btn imdrf-row-label" data-role="detail">' +
        "<code>" +
        escapeHtml(row.code) +
        "</code> " +
        escapeHtml(row.term) +
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
          .join("") || '<p class="hint">No terms.</p>';
    }

    function attachRowHandlers(container, depth) {
      var rows = container.querySelectorAll(":scope > .imdrf-row");
      rows.forEach(function (rowEl) {
        var toggleBtn = rowEl.querySelector('[data-role="toggle"]');
        var labelBtn = rowEl.querySelector('[data-role="detail"]');
        var childrenEl = rowEl.querySelector('[data-role="children"]');

        labelBtn.addEventListener("click", function () {
          loadDetail(rowEl.getAttribute("data-id"));
        });

        if (rowEl.getAttribute("data-has-children") !== "true") return;

        toggleBtn.addEventListener("click", function () {
          var expanded = rowEl.getAttribute("data-expanded") === "true";
          if (expanded) {
            rowEl.setAttribute("data-expanded", "false");
            childrenEl.innerHTML = "";
            toggleBtn.querySelector(".imdrf-caret").textContent = "›";
            return;
          }
          fetch(
            "/imdrf/releases/" +
              releaseId +
              "/terms?parentId=" +
              encodeURIComponent(rowEl.getAttribute("data-id")),
          )
            .then(function (r) {
              return r.json();
            })
            .then(function (data) {
              renderRows(childrenEl, data.rows, depth + 1);
              attachRowHandlers(childrenEl, depth + 1);
              rowEl.setAttribute("data-expanded", "true");
              toggleBtn.querySelector(".imdrf-caret").textContent = "⌄";
            });
        });
      });
    }

    function loadAnnex(annex) {
      treeEl.innerHTML = '<p class="hint">Loading…</p>';
      detailEl.innerHTML = "";
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
      detailEl.innerHTML = '<p class="hint">Loading…</p>';
      fetch("/imdrf/releases/" + releaseId + "/terms/" + encodeURIComponent(termId))
        .then(function (r) {
          return r.json();
        })
        .then(function (term) {
          if (!term) {
            detailEl.innerHTML = '<p class="hint">Not found.</p>';
            return;
          }
          var isRetired = String(term.status || "").toLowerCase().indexOf("retired") !== -1;
          var status = term.status
            ? '<span class="tag' +
              (isRetired ? " muted" : "") +
              '">' +
              escapeHtml(term.status) +
              "</span>"
            : "";
          var html =
            '<div class="card card-b">' +
            '<p class="eyebrow">' +
            escapeHtml(term.annex) +
            " · Level " +
            term.level +
            "</p>" +
            "<h3><code>" +
            escapeHtml(term.code) +
            "</code></h3>" +
            "<p>" +
            escapeHtml(term.term) +
            "</p>";
          if (status) html += "<p>" + status + "</p>";
          html +=
            '<p class="hint">Hierarchy: ' +
            escapeHtml(String(term.codeHierarchy).split("|").join(" › ")) +
            "</p>";
          if (term.definition) html += "<p>" + escapeHtml(term.definition) + "</p>";
          if (term.statusDescription) {
            html += '<p class="hint">' + escapeHtml(term.statusDescription) + "</p>";
          }
          if (term.nonImdrfCode) {
            html += '<p class="hint">Non-IMDRF code: ' + escapeHtml(term.nonImdrfCode) + "</p>";
          }
          if (term.primaryCategory) {
            html +=
              '<p class="hint">Primary category: ' + escapeHtml(term.primaryCategory) + "</p>";
          }
          if (term.secondaryCategory) {
            html +=
              '<p class="hint">Secondary category: ' +
              escapeHtml(term.secondaryCategory) +
              "</p>";
          }
          html += "</div>";
          detailEl.innerHTML = html;
        });
    }

    annexButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        annexButtons.forEach(function (b) {
          b.classList.remove("on");
        });
        btn.classList.add("on");
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
          fetch("/imdrf/releases/" + releaseId + "/search?q=" + encodeURIComponent(query))
            .then(function (r) {
              return r.json();
            })
            .then(function (data) {
              treeEl.hidden = true;
              resultsEl.hidden = false;
              renderRows(resultsEl, data.rows, 0);
              attachRowHandlers(resultsEl, 0);
            });
        }, 300);
      });
    }
  });
})();
