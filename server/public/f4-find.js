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

    /* ---- sign assessment dialog -------------------------------------------- */

    // Same idiom as the staff shell's own sign-out dialog (see rail.js): a native <dialog>,
    // opened with showModal() for the backdrop, the focus trap and Escape-to-close it buys for
    // free, and closed by its own default if the script never runs. The password field inside it
    // is a real descendant of the F004's <form> — a <dialog> does not start a new form scope — so
    // "Confirm and sign" submits the whole assessment exactly as "Save draft" does.

    var signOpen = document.querySelector("[data-f4-sign-open]");
    var signDialog = document.querySelector("[data-f4-sign-dialog]");
    var signCancel = document.querySelector("[data-f4-sign-cancel]");

    if (signOpen && signDialog && typeof signDialog.showModal === "function") {
      signOpen.addEventListener("click", function () {
        signDialog.showModal();
      });

      if (signCancel) {
        signCancel.addEventListener("click", function () {
          signDialog.close();
        });
      }

      // Clicking the backdrop means the click's target is the dialog itself, never one of its
      // children — see the note on `.modal-body` padding in app.css.
      signDialog.addEventListener("click", function (event) {
        if (event.target === signDialog) signDialog.close();
      });
    }

    /* ---- section nav active state ------------------------------------------ */

    var jumpLinks = document.querySelectorAll(".f4-jump-links a");
    var sections = document.querySelectorAll(".f4-section[id]");

    if (jumpLinks.length && sections.length && "IntersectionObserver" in window) {
      var linkForId = {};
      for (var li = 0; li < jumpLinks.length; li++) {
        var href = jumpLinks[li].getAttribute("href") || "";
        if (href.charAt(0) === "#") linkForId[href.slice(1)] = jumpLinks[li];
      }

      function setActiveSection(id) {
        for (var i2 = 0; i2 < jumpLinks.length; i2++) {
          jumpLinks[i2].classList.remove("on");
          jumpLinks[i2].removeAttribute("aria-current");
        }
        var link = linkForId[id];
        if (link) {
          link.classList.add("on");
          link.setAttribute("aria-current", "true");
        }
      }

      // Whichever observed section currently has the most of itself in the band between the sticky
      // header/jump row and the bottom of the viewport wins — not just "first one intersecting",
      // which flickers between two short sections crossing the same boundary at once.
      var ratioById = {};

      var sectionObserver = new IntersectionObserver(
        function (entries) {
          for (var e = 0; e < entries.length; e++) {
            var entry = entries[e];
            if (entry.isIntersecting) ratioById[entry.target.id] = entry.intersectionRatio;
            else delete ratioById[entry.target.id];
          }

          var bestId = null;
          var bestRatio = -1;
          for (var id in ratioById) {
            if (ratioById[id] > bestRatio) {
              bestRatio = ratioById[id];
              bestId = id;
            }
          }
          if (bestId) setActiveSection(bestId);
        },
        {
          // Matches the sticky staff header + jump row height so a section only counts once it has
          // actually cleared them, and ignores the bottom third of the viewport so the *next*
          // section doesn't start winning the moment its top peeks into view.
          rootMargin: "-120px 0px -60% 0px",
          threshold: [0, 0.25, 0.5, 0.75, 1],
        },
      );

      for (var s = 0; s < sections.length; s++) sectionObserver.observe(sections[s]);

      // Clicking a link scrolls (native anchor behaviour, untouched); mark it active immediately
      // rather than waiting for the observer to catch up once the scroll settles.
      for (var lj = 0; lj < jumpLinks.length; lj++) {
        jumpLinks[lj].addEventListener("click", function (event) {
          var targetHref = event.currentTarget.getAttribute("href") || "";
          if (targetHref.charAt(0) === "#") setActiveSection(targetHref.slice(1));
        });
      }

      setActiveSection(sections[0].id);
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
