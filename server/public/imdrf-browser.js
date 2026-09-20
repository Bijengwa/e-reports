/*
 * The IMDRF terminology page: a lazy hierarchy, a release-wide search, and a term's own details
 * opened in place.
 *
 * Four rules hold throughout.
 *
 * Nothing is loaded before it is asked for. The server renders seven section headings; this file
 * fetches an annex's groups when that section is opened, a group's terms when that group is
 * opened, and a term's definition when that term is opened — never sooner, and never twice. A
 * container that has already been filled is hidden and shown again, not refetched.
 *
 * Paging is the server's. No list here is ever fetched whole and filtered in the browser; every
 * page arrives with a cursor and "Show more" spends it. Annex E alone is over a thousand rows.
 *
 * Search asks the database, over the whole release. It is not a filter over what happens to be
 * on screen — most of the release never is. Opening a result walks the term's own lineage back
 * down through the page, loading only the branches on that path.
 *
 * Indent is a `data-depth` attribute, never an inline style: the CSP `style-src 'self'` drops a
 * `padding-left` written from script, which is how an earlier draft of this tree arrived flat.
 *
 * Opt-in like the door's other scripts: a page with no `[data-imdrf-browser]` does nothing.
 */
(function () {
  "use strict";

  var SEARCH_DEBOUNCE_MS = 250;
  var MIN_QUERY = 2;
  /** How far a reveal will page through one container looking for a term before giving up. */
  var MAX_REVEAL_PAGES = 40;

  /* The F004 item each annex answers, so a search result can say where in the page it lives.
     The same seven pairs the server renders the section headings from (`domain/f004.ts`); they
     are a property of the form, which does not change between releases. */
  var SECTION_NO = {
    G: "3.1.1",
    A: "3.1.2",
    F: "3.2.1",
    E: "3.2.2",
    B: "3.3.1",
    C: "3.3.2",
    D: "3.3.3",
  };

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

  /** The loading shape, matching the one the server renders into the opening veil. */
  function skeleton(rows) {
    var html = '<div class="imdrf-skel" aria-hidden="true">';
    for (var i = 0; i < rows; i += 1) {
      html += '<div class="imdrf-skel-row" data-n="' + String(i % 3) + '"></div>';
    }
    return html + "</div>";
  }

  function getJson(url) {
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (response) {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    });
  }

  ready(function () {
    var root = document.querySelector("[data-imdrf-browser]");
    if (!root) return;

    var releaseId = root.getAttribute("data-release-id");
    var searchInput = root.querySelector("[data-imdrf-search]");
    var searchNote = root.querySelector("[data-imdrf-search-note]");
    var resultsEl = root.querySelector("[data-imdrf-results]");
    var treeEl = root.querySelector("[data-imdrf-tree]");
    var bootEl = root.querySelector("[data-imdrf-boot]");
    var sections = Array.prototype.slice.call(root.querySelectorAll("[data-imdrf-section]"));

    var searchTimer = null;
    var searchSeq = 0;
    var selectedId = null;

    /** How to fetch the next page of a filled container, keyed by the container element. */
    var pagers = new WeakMap();

    var base = "/imdrf/releases/" + encodeURIComponent(releaseId);

    function termsUrl(params, cursor) {
      return base + "/terms?" + params + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    }

    function annexPager(annex) {
      return function (cursor) {
        return getJson(termsUrl("annex=" + encodeURIComponent(annex), cursor));
      };
    }

    function childPager(parentId) {
      return function (cursor) {
        return getJson(termsUrl("parentId=" + encodeURIComponent(parentId), cursor));
      };
    }

    /* ---- rows --------------------------------------------------------------- */

    function rowHtml(row, depth) {
      var hasChildren = row.hasChildren === true;
      return (
        '<div class="imdrf-row" data-id="' +
        escapeHtml(row.id) +
        '" data-code="' +
        escapeHtml(row.code) +
        '" data-has-children="' +
        (hasChildren ? "true" : "false") +
        '" data-open="false" data-depth="' +
        String(Math.min(depth, 4)) +
        '">' +
        '<button type="button" class="imdrf-term" data-role="term" aria-expanded="false">' +
        '<span class="imdrf-caret" aria-hidden="true"></span>' +
        "<code>" +
        escapeHtml(row.code) +
        "</code>" +
        '<span class="imdrf-term-name">' +
        escapeHtml(row.term) +
        "</span>" +
        "</button>" +
        '<div class="imdrf-body" data-role="body" hidden></div>' +
        "</div>"
      );
    }

    /**
     * Append a page of rows, plus a "Show more" button when the server said there is another.
     *
     * Appending rather than replacing is what makes the second and third page work: someone who
     * has paged a thousand-row annex has not asked to be sent back to the top.
     */
    function appendPage(container, data, depth, fetchMore) {
      var more = container.querySelector(":scope > .imdrf-more");
      if (more) more.remove();

      var fragment = document.createElement("div");
      fragment.innerHTML = data.rows
        .map(function (row) {
          return rowHtml(row, depth);
        })
        .join("");

      var added = Array.prototype.slice.call(fragment.children);
      added.forEach(function (child) {
        container.appendChild(child);
      });
      added.forEach(function (child) {
        bindRow(child, depth);
      });

      if (!container.children.length) {
        container.innerHTML = note("No terms here.");
        return;
      }

      if (!data.nextCursor) {
        pagers.set(container, null);
        return;
      }

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

      pagers.set(container, function () {
        return fetchMore(data.nextCursor).then(function (next) {
          appendPage(container, next, depth, fetchMore);
          return true;
        });
      });
    }

    /**
     * Fill a container with its first page, showing a skeleton while it is in flight.
     *
     * Resolves either way. A failed load leaves a message in the container rather than a
     * half-drawn tree, and the caller's own state (the twisty, the veil) still settles.
     */
    function fillFirstPage(container, depth, fetchMore, skeletonRows) {
      container.innerHTML = skeleton(skeletonRows || 4);
      return fetchMore(null)
        .then(function (data) {
          container.innerHTML = "";
          appendPage(container, data, depth, fetchMore);
          return true;
        })
        .catch(function () {
          container.innerHTML = note("Could not load these terms. Try again.", "hint danger");
          return false;
        });
    }

    /* ---- a term's own details ----------------------------------------------- */

    /**
     * What an officer came for: the code, what it means, and a way to take the code away.
     *
     * The "preferred terminology level 1/2/3" list this pane used to print is gone — those are
     * F004's own field names for what is simply this term's path, and the path says it in one
     * line. The status warning stays: a retired or non-selectable code has to be refused before
     * it is copied, not after the form is rejected.
     */
    function detailHtml(term) {
      var statusText = String(term.status || "");
      var lowered = statusText.toLowerCase();
      var unusable = lowered.indexOf("retired") !== -1 || lowered.indexOf("not selectable") !== -1;

      var html = "";

      var path = (Array.isArray(term.lineage) ? term.lineage : [])
        .slice(0, -1)
        .map(function (step) {
          return escapeHtml(step.code) + " " + escapeHtml(step.term);
        })
        .join(" › ");
      if (path) html += '<p class="imdrf-path">' + path + "</p>";

      if (unusable) {
        html +=
          '<p class="imdrf-warn">' +
          escapeHtml(statusText) +
          " — this code should not be used on a new assessment.</p>";
      } else if (statusText) {
        html += '<p><span class="tag">' + escapeHtml(statusText) + "</span></p>";
      }

      html +=
        '<p class="imdrf-def">' +
        (term.definition
          ? escapeHtml(term.definition)
          : '<span class="imdrf-nodef">IMDRF publishes no definition for this term.</span>') +
        "</p>";

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
      if (meta) html += '<dl class="imdrf-meta">' + meta + "</dl>";

      html +=
        '<p class="imdrf-actions">' +
        '<button type="button" class="btn ghost btn-sm" data-copy="' +
        escapeHtml(term.code) +
        '">Copy code</button></p>';

      return html;
    }

    function bindCopy(container) {
      var button = container.querySelector("[data-copy]");
      if (!button || !navigator.clipboard) return;
      button.addEventListener("click", function () {
        navigator.clipboard.writeText(button.getAttribute("data-copy")).then(
          function () {
            button.textContent = "Copied";
            setTimeout(function () {
              button.textContent = "Copy code";
            }, 1600);
          },
          function () {
            button.textContent = "Press Ctrl+C";
          },
        );
      });
    }

    /* ---- rows: open and close ----------------------------------------------- */

    function markSelected(termId) {
      selectedId = termId;
      root.querySelectorAll(".imdrf-term.on").forEach(function (button) {
        button.classList.remove("on");
      });
      if (!termId) return;
      var match = root.querySelector('.imdrf-row[data-id="' + termId + '"] > .imdrf-term');
      if (match) match.classList.add("on");
    }

    /**
     * Open one row: its details, and — when it has any — its children.
     *
     * Both are fetched once. A row that has been opened and closed again is shown from what is
     * already in the page, which is what makes an accordion cheap to use rather than a request
     * per click.
     */
    function openRow(rowEl, depth) {
      var button = rowEl.querySelector(':scope > [data-role="term"]');
      var body = rowEl.querySelector(':scope > [data-role="body"]');
      var termId = rowEl.getAttribute("data-id");

      rowEl.setAttribute("data-open", "true");
      button.setAttribute("aria-expanded", "true");
      body.hidden = false;

      if (rowEl.getAttribute("data-filled") === "true") return Promise.resolve(true);
      rowEl.setAttribute("data-filled", "true");

      var hasChildren = rowEl.getAttribute("data-has-children") === "true";
      body.innerHTML =
        '<div class="imdrf-detail" data-role="detail">' +
        skeleton(2) +
        "</div>" +
        (hasChildren ? '<div class="imdrf-children" data-role="children"></div>' : "");

      var detailEl = body.querySelector('[data-role="detail"]');
      var childrenEl = body.querySelector('[data-role="children"]');

      var detail = getJson(base + "/terms/" + encodeURIComponent(termId))
        .then(function (term) {
          detailEl.innerHTML = detailHtml(term);
          bindCopy(detailEl);
          return true;
        })
        .catch(function () {
          detailEl.innerHTML = note("Could not load this term. Try again.", "hint danger");
          return false;
        });

      if (!childrenEl) return detail;

      return Promise.all([detail, fillFirstPage(childrenEl, depth + 1, childPager(termId), 4)]).then(
        function (results) {
          return results[1];
        },
      );
    }

    function closeRow(rowEl) {
      var button = rowEl.querySelector(':scope > [data-role="term"]');
      var body = rowEl.querySelector(':scope > [data-role="body"]');
      rowEl.setAttribute("data-open", "false");
      button.setAttribute("aria-expanded", "false");
      body.hidden = true;
    }

    function bindRow(rowEl, depth) {
      if (!rowEl.classList || !rowEl.classList.contains("imdrf-row")) return;
      var button = rowEl.querySelector(':scope > [data-role="term"]');
      if (!button) return;

      if (rowEl.getAttribute("data-id") === selectedId) button.classList.add("on");

      button.addEventListener("click", function () {
        markSelected(rowEl.getAttribute("data-id"));
        if (rowEl.getAttribute("data-open") === "true") closeRow(rowEl);
        else openRow(rowEl, depth);
      });
    }

    /* ---- sections ------------------------------------------------------------ */

    /**
     * Open a section: the annex's own top level.
     *
     * The consolidated IMDRF export carries a bare annex-root record (`code: "G"`) that the
     * single-annex exports omit, so an annex's top level is either the groups themselves or one
     * root holding them. A page that rendered the root would show the reader a heading called
     * "G" under a heading that already said (G); so when the top level is exactly that one
     * single-letter row, its children are fetched in its place and the groups are what appear.
     */
    function loadSection(sectionEl) {
      var annex = sectionEl.getAttribute("data-imdrf-section");
      var body = sectionEl.querySelector('[data-role="section-body"]');

      body.innerHTML = skeleton(5);
      return getJson(termsUrl("annex=" + encodeURIComponent(annex), null))
        .then(function (data) {
          var only = data.rows.length === 1 && !data.nextCursor ? data.rows[0] : null;
          if (only && String(only.code).length === 1 && only.hasChildren) {
            return fillFirstPage(body, 0, childPager(only.id), 5);
          }
          body.innerHTML = "";
          appendPage(body, data, 0, annexPager(annex));
          return true;
        })
        .catch(function () {
          body.innerHTML = note("Could not load this section. Try again.", "hint danger");
          return false;
        });
    }

    function openSection(sectionEl) {
      var button = sectionEl.querySelector('[data-role="section-toggle"]');
      var body = sectionEl.querySelector('[data-role="section-body"]');

      sectionEl.setAttribute("data-open", "true");
      button.setAttribute("aria-expanded", "true");
      body.hidden = false;

      if (sectionEl.getAttribute("data-loaded") === "true") return Promise.resolve(true);
      sectionEl.setAttribute("data-loaded", "true");
      return loadSection(sectionEl);
    }

    function closeSection(sectionEl) {
      var button = sectionEl.querySelector('[data-role="section-toggle"]');
      var body = sectionEl.querySelector('[data-role="section-body"]');
      sectionEl.setAttribute("data-open", "false");
      button.setAttribute("aria-expanded", "false");
      body.hidden = true;
    }

    sections.forEach(function (sectionEl) {
      var button = sectionEl.querySelector('[data-role="section-toggle"]');
      button.addEventListener("click", function () {
        if (sectionEl.getAttribute("data-open") === "true") closeSection(sectionEl);
        else openSection(sectionEl);
      });
    });

    /* ---- revealing a search result ------------------------------------------- */

    /**
     * Find one already-rendered row inside a container, paging the container until it appears.
     *
     * A term reached from search may sit on the fourth page of its group. Paging to it is still
     * cheaper than the alternative the page refuses to take — loading the group whole — and the
     * bound stops a mismatched id (a stale result, a term moved between releases) from walking a
     * thousand rows looking for something that is not there.
     */
    function findRow(container, id, budget) {
      var match = container.querySelector(':scope > .imdrf-row[data-id="' + id + '"]');
      if (match) return Promise.resolve(match);
      if (budget <= 0) return Promise.resolve(null);

      var next = pagers.get(container);
      if (!next) return Promise.resolve(null);

      return next()
        .then(function () {
          return findRow(container, id, budget - 1);
        })
        .catch(function () {
          return null;
        });
    }

    /**
     * Open a term found by search: its section, every group above it, then the term itself.
     *
     * Driven by the term's own lineage rather than by its code string. `getTermLineage` walks
     * `parent_term_id`, so the path is what the database says it is — and the consolidated
     * export's bare annex root, which this page does not render, is simply a step with nothing
     * on screen to match and is stepped over.
     */
    function revealTerm(termId, annex) {
      var sectionEl = root.querySelector('[data-imdrf-section="' + annex + '"]');
      if (!sectionEl) return;

      var body = sectionEl.querySelector('[data-role="section-body"]');

      getJson(base + "/terms/" + encodeURIComponent(termId))
        .then(function (term) {
          return openSection(sectionEl).then(function () {
            var steps = (Array.isArray(term.lineage) ? term.lineage : []).map(function (step) {
              return step.id;
            });
            if (steps.indexOf(termId) === -1) steps.push(termId);

            // Walk down one container at a time. Each row found is opened, which is what fills
            // the container the next step is looked for in.
            return steps.reduce(function (chain, stepId) {
              return chain.then(function (state) {
                if (!state.container) return state;
                return findRow(state.container, stepId, MAX_REVEAL_PAGES).then(function (rowEl) {
                  // A step with no row on screen is the export's own annex root: keep the
                  // container as it is and look for the next step in the same place.
                  if (!rowEl) return state;
                  return openRow(rowEl, state.depth).then(function () {
                    return {
                      container: rowEl.querySelector(
                        ':scope > [data-role="body"] > [data-role="children"]',
                      ),
                      depth: state.depth + 1,
                      rowEl: rowEl,
                    };
                  });
                });
              });
            }, Promise.resolve({ container: body, depth: 0, rowEl: null }));
          });
        })
        .then(function (state) {
          var rowEl = state && state.rowEl;
          if (!rowEl) return;
          markSelected(termId);
          clearSearch();
          rowEl.scrollIntoView({ block: "center" });
          var button = rowEl.querySelector(':scope > [data-role="term"]');
          if (button) button.focus();
        })
        .catch(function () {
          /* the result stays on screen; nothing was lost */
        });
    }

    /* ---- search --------------------------------------------------------------- */

    function resultHtml(row) {
      // The group a term came out of, read off its own stored code chain: "G|G01|G01001" — the
      // segment before this one. A group row has no segment before it but its annex letter, and
      // the section line already says that, so it gets the section alone.
      var chain = String(row.codeHierarchy || "").split("|");
      var parent = chain.length > 1 ? chain[chain.length - 2] : "";
      if (parent.length <= 1) parent = "";

      return (
        '<button type="button" class="imdrf-result" data-id="' +
        escapeHtml(row.id) +
        '" data-annex="' +
        escapeHtml(row.annex) +
        '">' +
        '<span class="imdrf-result-main"><code>' +
        escapeHtml(row.code) +
        "</code><span>" +
        escapeHtml(row.term) +
        "</span></span>" +
        '<span class="imdrf-result-where">' +
        escapeHtml((SECTION_NO[row.annex] || "") + " (" + row.annex + ")") +
        (parent ? " → " + escapeHtml(parent) : "") +
        "</span>" +
        "</button>"
      );
    }

    function showResults(on) {
      resultsEl.hidden = !on;
      treeEl.hidden = on;
      if (searchNote) searchNote.hidden = !on;
    }

    function clearSearch() {
      searchSeq += 1;
      if (searchTimer) clearTimeout(searchTimer);
      if (searchInput) searchInput.value = "";
      resultsEl.innerHTML = "";
      if (searchNote) searchNote.textContent = "";
      showResults(false);
    }

    function bindResults() {
      resultsEl.querySelectorAll("[data-id]").forEach(function (button) {
        button.addEventListener("click", function () {
          revealTerm(button.getAttribute("data-id"), button.getAttribute("data-annex"));
        });
      });
    }

    function appendResults(data, query, page) {
      var more = resultsEl.querySelector(".imdrf-more");
      if (more) more.remove();
      resultsEl.insertAdjacentHTML("beforeend", data.rows.map(resultHtml).join(""));
      bindResults();

      if (!data.nextCursor) return;

      var button = document.createElement("button");
      button.type = "button";
      button.className = "imdrf-more";
      button.textContent = "Show more results";
      button.addEventListener("click", function () {
        button.disabled = true;
        button.textContent = "Loading…";
        page(data.nextCursor)
          .then(function (next) {
            appendResults(next, query, page);
          })
          .catch(function () {
            button.disabled = false;
            button.textContent = "Show more results";
          });
      });
      resultsEl.appendChild(button);
    }

    /**
     * Search the release, not the page.
     *
     * No `annex` is sent: the officer typing here may not know which of the seven items the word
     * they saw belongs to, and answering only out of the sections that happen to be open would
     * make the box a filter over an accident. Scoping stays where it is genuinely a constraint —
     * the F004 picker, which may only offer codes that field accepts.
     */
    function runSearch(query) {
      var seq = ++searchSeq;
      var page = function (cursor) {
        return getJson(
          base +
            "/search?q=" +
            encodeURIComponent(query) +
            (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        );
      };

      showResults(true);
      resultsEl.innerHTML = skeleton(4);
      if (searchNote) searchNote.textContent = "Searching the whole release…";

      page(null)
        .then(function (data) {
          if (seq !== searchSeq) return; // a later keystroke owns this region now
          resultsEl.innerHTML = "";
          if (!data.rows.length) {
            if (searchNote) searchNote.textContent = "";
            resultsEl.innerHTML = note('Nothing in this release matches "' + query + '".');
            return;
          }
          if (searchNote) {
            searchNote.textContent =
              "Results from every annex. Choose one to open it in the hierarchy.";
          }
          appendResults(data, query, page);
        })
        .catch(function () {
          if (seq !== searchSeq) return;
          if (searchNote) searchNote.textContent = "";
          resultsEl.innerHTML = note("Search failed. Try again.", "hint danger");
        });
    }

    if (searchInput) {
      searchInput.addEventListener("input", function () {
        var query = searchInput.value.trim();
        if (searchTimer) clearTimeout(searchTimer);

        if (query.length < MIN_QUERY) {
          searchSeq += 1;
          resultsEl.innerHTML = "";
          if (searchNote) searchNote.textContent = "";
          showResults(false);
          return;
        }

        searchTimer = setTimeout(function () {
          runSearch(query);
        }, SEARCH_DEBOUNCE_MS);
      });

      // Enter is the impatient reader's "search now"; Escape is their way back to the hierarchy.
      // Enter is cancelled as a submit either way: this input has no form to file, and a stray
      // navigation here would lose the reader's place.
      searchInput.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          clearSearch();
          return;
        }
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (searchTimer) clearTimeout(searchTimer);
        if (searchInput.value.trim().length >= MIN_QUERY) runSearch(searchInput.value.trim());
      });
    }

    /* ---- the opening load ------------------------------------------------------ */

    function dismissBoot() {
      if (!bootEl) return;
      bootEl.remove();
      bootEl = null;
    }

    // The first section is opened for the reader, so the page opens on terminology rather than on
    // seven closed headings. It is the same lazy path every other section takes — one annex's top
    // level, nothing below it — and the veil comes down when it settles, either way.
    var firstSection = sections[0];
    if (firstSection) {
      openSection(firstSection).then(dismissBoot, dismissBoot);
    } else {
      dismissBoot();
    }
  });
})();
