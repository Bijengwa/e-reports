/*
 * A tiny, page-local search over the F004's own headings and labels.
 *
 * Filters nothing out of the DOM — everything a screen reader or the browser's own Ctrl+F already
 * sees stays exactly where it is. Typing only toggles two classes: a hit is marked, everything
 * else of the same kind is dimmed, so the eye finds the match without the page reflowing under it.
 *
 * Enhancement only, and the reason it can be: the find box lives outside the F004's own <form>
 * (see views/assessment.tsx), so it can never submit an assessment, and a browser that blocks
 * this script leaves the page exactly as readable as it rendered — nothing here is load-bearing.
 */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var input = document.querySelector("[data-f4-find]");
    if (!input) return;

    var targets = document.querySelectorAll(".f4 .f4-blocktitle, .f4 .f4-label");

    function apply() {
      var query = input.value.trim().toLowerCase();

      for (var i = 0; i < targets.length; i++) {
        var el = targets[i];
        var hit = query !== "" && el.textContent.toLowerCase().indexOf(query) !== -1;
        el.classList.toggle("f4-find-hit", hit);
        el.classList.toggle("f4-find-dim", query !== "" && !hit);
      }
    }

    input.addEventListener("input", apply);
    // A native search input fires this on the clear (×) button too, which "input" alone misses
    // in some browsers.
    input.addEventListener("search", apply);
  });
})();
