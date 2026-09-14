/*
 * The IMDRF terminology handbook: an F004-scoped search, an expand-on-demand annex tree, and a
 * term document that ends in the values to put on the form.
 *
 * Three rules hold throughout.
 *
 * Paging is the server's. Nothing here ever fetches "all terms" and filters in the browser —
 * every list arrives paged, and "Show more" spends the cursor the server handed back. Annex E
 * alone is over a thousand rows.
 *
 * Indent is a `data-depth` attribute, never an inline style. The CSP `style-src 'self'` drops a
 * `padding-left` written from script, which is how an earlier draft of this tree arrived flat.
 *
 * Scope is the F004 item, not the annex. The buttons say "3.1.2"; what they carry is the annex
 * that item's code must come from, and every search and every tree load below is narrowed by it.
 * An officer filling 3.1.2 cannot be shown an Annex F code, because they could not put it there.
 *
 * Opt-in like the door's other scripts: a page with no `[data-imdrf-browser]` does nothing.
 */
(function () {
  "use strict";

  var SEARCH_DEBOUNCE_MS = 250;

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

  function note(text, kind) {
    return '<p class="' + (kind || "hint") + '">' + escapeHtml(text) + "</p>";
  }

  function getJson(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    });
  }

  ready(function () {
    var root = document.querySelector("[data-imdrf-browser]");
    if (!root) return;

    var releaseId = root.getAttribute("data-release-id");
    var searchInput = root.querySelector("[data-imdrf-search]");
    var scopeHint = root.querySelector("[data-imdrf-scope-hint]");
    var tocHead = root.querySelector("[data-imdrf-toc-head]");
    var resultsEl = root.querySelector("[data-imdrf-results]");
    var treeEl = root.querySelector("[data-imdrf-tree]");
    var detailEl = root.querySelector("[data-imdrf-detail]");
    var scopeButtons = Array.prototype.slice.call(root.querySelectorAll("[data-imdrf-scope-no]"));

    // The server-rendered "start here" panel. Kept so that clearing a search or changing scope
    // returns the officer to the instructions rather than to a blank pane — the reader who most
    // often backs out of a term is the one who did not know where to start.
    var startPanelHtml = detailEl.innerHTML;

    var searchTimer = null;
    var selectedId = null;
    var scope = null;
    var searchSeq = 0;

    /* ---- the term tree ----------------------------------------------------- */

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

    function rowsHtml(rows, depth) {
      return rows
        .map(function (row) {
          return termRowHtml(row, depth);
        })
        .join("");
    }

    /**
     * Append a page of rows, plus a "Show more" button when the server said there is another.
     *
     * `append` rather than `replace` because this is also how the second and third page arrive:
     * an officer who has scrolled a thousand-row annex has not asked to be sent back to the top.
     */
    function appendPage(container, data, depth, fetchMore) {
      var more = container.querySelector(":scope > .imdrf-more");
      if (more) more.remove();

      var fragment = document.createElement("div");
      fragment.innerHTML = rowsHtml(data.rows, depth);
      var added = Array.prototype.slice.call(fragment.children);
      added.forEach(function (child) {
        container.appendChild(child);
      });
      attachRowHandlers(added, depth);

      if (!container.children.length) {
        container.innerHTML = note("No terms here.");
        return;
      }

      if (!data.nextCursor) return;

      var button = document.createElement("button");
      button.type = "button";
      button.className = "imdrf-more";
      button.textContent = "Show more";
      button.addEventListener("click", function () {
        button.disabled = true;
        button.textContent = "Loading…";
        fetchMore(data.nextCursor)
          .then(function (next) {
            appendPage(container, next, depth, fetchMore);
          })
          .catch(function () {
            button.disabled = false;
            button.textContent = "Show more";
          });
      });
      container.appendChild(button);
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

    function attachRowHandlers(rowEls, depth) {
      rowEls.forEach(function (rowEl) {
        if (!rowEl.classList || !rowEl.classList.contains("imdrf-row")) return;

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

          var childPage = function (cursor) {
            return getJson(
              "/imdrf/releases/" +
                releaseId +
                "/terms?parentId=" +
                encodeURIComponent(termId) +
                (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
            );
          };

          childrenEl.innerHTML = note("Loading…");
          childPage(null)
            .then(function (data) {
              childrenEl.innerHTML = "";
              appendPage(childrenEl, data, depth + 1, childPage);
              rowEl.setAttribute("data-expanded", "true");
              toggleBtn.setAttribute("aria-expanded", "true");
              toggleBtn.setAttribute("aria-label", "Collapse");
            })
            .catch(function () {
              childrenEl.innerHTML = note("Could not load these terms. Try again.", "hint danger");
            });
        });
      });
    }

    /* ---- scope ------------------------------------------------------------- */

    function showStartPanel() {
      selectedId = null;
      detailEl.innerHTML = startPanelHtml;
      bindStartPanel();
    }

    function bindStartPanel() {
      detailEl.querySelectorAll("[data-imdrf-scope]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          setScope(btn.getAttribute("data-imdrf-scope"));
          if (searchInput) searchInput.focus();
        });
      });
    }

    function setScope(annex) {
      var chosen = null;
      scopeButtons.forEach(function (btn) {
        var on = btn.getAttribute("data-imdrf-scope") === annex;
        btn.classList.toggle("on", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        if (on) chosen = btn;
      });
      if (!chosen) return;

      scope = annex;
      var no = chosen.getAttribute("data-imdrf-scope-no");
      var question = chosen.getAttribute("data-imdrf-scope-question");

      if (scopeHint) {
        scopeHint.textContent = "F004 " + no + " · Annex " + annex + " — " + question;
      }
      if (searchInput) {
        searchInput.value = "";
        searchInput.placeholder = "Search Annex " + annex + " — a code, a term, or what you saw…";
      }
      if (tocHead) tocHead.textContent = "Annex " + annex + " · browse";

      resultsEl.innerHTML = "";
      resultsEl.hidden = true;
      treeEl.hidden = false;
      showStartPanel();
      loadAnnex(annex);
    }

    function loadAnnex(annex) {
      var page = function (cursor) {
        return getJson(
          "/imdrf/releases/" +
            releaseId +
            "/terms?annex=" +
            encodeURIComponent(annex) +
            (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        );
      };

      treeEl.innerHTML = note("Loading…");
      page(null)
        .then(function (data) {
          if (scope !== annex) return; // a faster click already changed the scope
          treeEl.innerHTML = "";
          appendPage(treeEl, data, 0, page);
        })
        .catch(function () {
          treeEl.innerHTML = note("Could not load this annex. Reload the page.", "hint danger");
        });
    }

    /* ---- the term document -------------------------------------------------- */

    /**
     * The block an officer actually came for: the code to type, and the preferred terminology
     * levels that follow from it.
     *
     * Rendered from the term's lineage rather than from its own name alone, because F004 asks
     * for the level 1/2/3 terms and those are this term's ancestors. Showing them here is also
     * the check on a wrong pick — a code whose level 1 reads "Patient-Device Incompatibility"
     * when the report describes a battery fault is visibly the wrong branch, which the code
     * string alone would not have told anyone.
     */
    function f004Block(term) {
      var lineage = Array.isArray(term.lineage) ? term.lineage : [];
      var levels = lineage
        .map(function (step) {
          return (
            "<div>" +
            "<dt>Preferred terminology level " +
            escapeHtml(step.level) +
            "</dt>" +
            "<dd>" +
            escapeHtml(step.term) +
            ' <code class="imdrf-f4-code">' +
            escapeHtml(step.code) +
            "</code></dd>" +
            "</div>"
          );
        })
        .join("");

      return (
        '<section class="imdrf-f4">' +
        '<div class="imdrf-f4-head">' +
        '<p class="imdrf-f4-h">Enter in F004</p>' +
        '<button type="button" class="imdrf-copy" data-copy="' +
        escapeHtml(term.code) +
        '">Copy code</button>' +
        "</div>" +
        '<p class="imdrf-f4-code-big"><code>' +
        escapeHtml(term.code) +
        "</code></p>" +
        (levels ? '<dl class="imdrf-f4-levels">' + levels + "</dl>" : "") +
        '<p class="imdrf-f4-note">Type the code into the coding box. The preferred terminology ' +
        "levels above are filled from it \u2014 do not type them by hand.</p>" +
        "</section>"
      );
    }

    function bindCopy() {
      var button = detailEl.querySelector("[data-copy]");
      if (!button || !navigator.clipboard) return;
      button.addEventListener("click", function () {
        navigator.clipboard.writeText(button.getAttribute("data-copy")).then(
          function () {
            button.textContent = "Copied";
            button.classList.add("ok");
            setTimeout(function () {
              button.textContent = "Copy code";
              button.classList.remove("ok");
            }, 1600);
          },
          function () {
            button.textContent = "Press Ctrl+C";
          },
        );
      });
    }

    function loadDetail(termId) {
      detailEl.innerHTML = note("Loading…");
      getJson("/imdrf/releases/" + releaseId + "/terms/" + encodeURIComponent(termId))
        .then(function (term) {
          if (!term) {
            detailEl.innerHTML = note("Not found.");
            return;
          }

          var statusText = String(term.status || "");
          var lowered = statusText.toLowerCase();
          // "Retired" and "not selectable" are the two states that make a code unusable on a new
          // form. They are called out loudly rather than tagged quietly: an officer who copies a
          // retired code has to be told before they paste it, not after the form is rejected.
          var unusable =
            lowered.indexOf("retired") !== -1 || lowered.indexOf("not selectable") !== -1;

          var html = "";
          if (unusable) {
            html +=
              '<p class="imdrf-warn">' +
              escapeHtml(statusText) +
              " \u2014 this code should not be used on a new assessment." +
              "</p>";
          }

          html +=
            '<p class="eyebrow">Annex ' +
            escapeHtml(term.annex) +
            " \u00b7 Level " +
            escapeHtml(term.level) +
            "</p>" +
            '<h2 class="imdrf-entry-term">' +
            escapeHtml(term.term) +
            "</h2>";

          var crumb = (Array.isArray(term.lineage) ? term.lineage : [])
            .slice(0, -1)
            .map(function (step) {
              return escapeHtml(step.term);
            })
            .join(" \u203a ");
          if (crumb) html += '<p class="imdrf-entry-crumb">' + crumb + "</p>";

          if (!unusable && statusText) {
            html += '<p><span class="tag">' + escapeHtml(statusText) + "</span></p>";
          }

          html += f004Block(term);

          if (term.definition) {
            html +=
              '<p class="imdrf-def-h">Definition</p>' +
              '<p class="imdrf-entry-def">' +
              escapeHtml(term.definition) +
              "</p>";
          } else {
            html += note("IMDRF publishes no definition for this term.");
          }

          if (term.statusDescription) {
            html += '<p class="hint">' + escapeHtml(term.statusDescription) + "</p>";
          }

          var meta = "";
          if (term.nonImdrfCode) {
            meta += "<div><dt>Non-IMDRF code</dt><dd>" + escapeHtml(term.nonImdrfCode) + "</dd></div>";
          }
          if (term.primaryCategory) {
            meta +=
              "<div><dt>Primary category</dt><dd>" + escapeHtml(term.primaryCategory) + "</dd></div>";
          }
          if (term.secondaryCategory) {
            meta +=
              "<div><dt>Secondary category</dt><dd>" +
              escapeHtml(term.secondaryCategory) +
              "</dd></div>";
          }
          if (meta) html += '<dl class="imdrf-entry-meta">' + meta + "</dl>";

          detailEl.innerHTML = html;
          bindCopy();
        })
        .catch(function () {
          detailEl.innerHTML = note("Could not load this term. Try again.", "hint danger");
        });
    }

    /* ---- search ------------------------------------------------------------- */

    function runSearch(query) {
      var seq = ++searchSeq;
      var page = function (cursor) {
        return getJson(
          "/imdrf/releases/" +
            releaseId +
            "/search?q=" +
            encodeURIComponent(query) +
            (scope ? "&annex=" + encodeURIComponent(scope) : "") +
            (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        );
      };

      resultsEl.innerHTML = note("Searching…");
      treeEl.hidden = true;
      resultsEl.hidden = false;

      page(null)
        .then(function (data) {
          if (seq !== searchSeq) return; // a later keystroke owns the pane now
          resultsEl.innerHTML = "";
          if (!data.rows.length) {
            resultsEl.innerHTML = note(
              'Nothing in Annex ' + scope + ' matches "' + query + '". Try a shorter word, or ' +
                "check you picked the right F004 item above.",
            );
            return;
          }
          appendPage(resultsEl, data, 0, page);
        })
        .catch(function () {
          if (seq !== searchSeq) return;
          resultsEl.innerHTML = note("Search failed. Try again.", "hint danger");
        });
    }

    if (searchInput) {
      searchInput.addEventListener("input", function () {
        var query = searchInput.value;
        if (searchTimer) clearTimeout(searchTimer);

        if (query.trim() === "") {
          searchSeq++;
          resultsEl.innerHTML = "";
          resultsEl.hidden = true;
          treeEl.hidden = false;
          if (tocHead) tocHead.textContent = "Annex " + scope + " · browse";
          return;
        }

        if (tocHead) tocHead.textContent = "Results in Annex " + scope;
        searchTimer = setTimeout(function () {
          runSearch(query.trim());
        }, SEARCH_DEBOUNCE_MS);
      });

      // Enter is the impatient reader's "search now". Cancelled as a submit either way: this
      // input has no form to file, and a stray navigation here would lose the officer's place.
      searchInput.addEventListener("keydown", function (event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (searchTimer) clearTimeout(searchTimer);
        if (searchInput.value.trim() !== "") runSearch(searchInput.value.trim());
      });
    }

    scopeButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        setScope(btn.getAttribute("data-imdrf-scope"));
      });
    });

    var first = scopeButtons[0];
    if (first) setScope(first.getAttribute("data-imdrf-scope"));
  });
})();
