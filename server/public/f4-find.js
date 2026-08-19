/*
 * The assessment page's two small enhancements: find-in-F004, and Escape for the report drawer.
 *
 * Neither is load-bearing. The drawer opens and closes from a checkbox and its labels with this
 * file blocked; the find box is then an input that simply does nothing. Everything below only ever
 * adds or removes classes, moves the scroll position, or unchecks a checkbox — nothing here
 * decides what an assessment says, and nothing here can submit one.
 *
 * The find box lives outside the F004's <form> (see views/f004.tsx), so Enter cannot press Save
 * draft. Enter is still cancelled here, because a browser that ever associated the two would make
 * that the default, and a search that quietly filed a draft would be a bad surprise to debug.
 */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    /* ---- the report drawer ------------------------------------------------ */

    var drawer = document.querySelector("[data-a1-drawer]");

    if (drawer) {
      // Escape is what anyone who has met a drawer tries first. The scrim and the Close label
      // already work without this; it only saves the reach.
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && drawer.checked) drawer.checked = false;
      });
    }

    /* ---- find in this F004 ------------------------------------------------ */

    var input = document.querySelector("[data-f4-find]");
    if (!input) return;

    var count = document.querySelector("[data-f4-find-count]");
    var previous = document.querySelector("[data-f4-find-prev]");
    var next = document.querySelector("[data-f4-find-next]");

    // Headings and labels, which is what someone hunting through a long form is reading. Not the
    // section bars: the jump row above already reaches those by name.
    var targets = document.querySelectorAll(".f4 .f4-blocktitle, .f4 .f4-label, .f4 .f4-imdrf-h");

    var hits = [];
    var at = -1;

    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
    var scrolling = reduced && reduced.matches ? "auto" : "smooth";

    function paint() {
      for (var i = 0; i < targets.length; i++) {
        targets[i].classList.remove("f4-find-hit", "f4-find-dim", "f4-find-current");
      }

      if (hits.length === 0) return;

      for (var j = 0; j < targets.length; j++) {
        var isHit = false;

        for (var k = 0; k < hits.length; k++) {
          if (hits[k] === targets[j]) {
            isHit = true;
            break;
          }
        }

        targets[j].classList.add(isHit ? "f4-find-hit" : "f4-find-dim");
      }

      if (at >= 0) hits[at].classList.add("f4-find-current");
    }

    function say() {
      if (!count) return;

      if (input.value.trim() === "") count.textContent = "";
      else if (hits.length === 0) count.textContent = "No matches";
      else count.textContent = String(at + 1) + " of " + String(hits.length);
    }

    function steppable(on) {
      if (previous) previous.disabled = !on;
      if (next) next.disabled = !on;
    }

    function show() {
      if (at < 0) return;
      // Centred rather than aligned to the top: the staff header and the jump bar are both sticky,
      // and centring clears whatever height they happen to be without this file knowing it.
      hits[at].scrollIntoView({ block: "center", behavior: scrolling });
    }

    function search() {
      var query = input.value.trim().toLowerCase();

      hits = [];
      if (query !== "") {
        for (var i = 0; i < targets.length; i++) {
          if (targets[i].textContent.toLowerCase().indexOf(query) !== -1) hits.push(targets[i]);
        }
      }

      at = hits.length > 0 ? 0 : -1;
      paint();
      say();
      steppable(hits.length > 1);
      show();
    }

    function step(by) {
      if (hits.length === 0) return;

      at = (at + by + hits.length) % hits.length;
      paint();
      say();
      show();
    }

    input.addEventListener("input", search);
    // Fires on the native clear (×) too, which "input" alone misses in some browsers.
    input.addEventListener("search", search);

    input.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    });

    if (previous) {
      previous.addEventListener("click", function () {
        step(-1);
      });
    }

    if (next) {
      next.addEventListener("click", function () {
        step(1);
      });
    }

    steppable(false);
  });
})();
