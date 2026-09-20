/*
 * The staff rail: collapse on a wide screen, off-canvas on a narrow one.
 *
 * Loaded without `defer`, unlike the other scripts here, and that is deliberate. The collapsed
 * class has to be on <html> before the first paint or someone who collapsed the rail watches it
 * appear wide and then snap shut on every page load. A server-rendered app navigates by full page
 * load, so that flash would happen constantly. The inline script that would normally do this is
 * forbidden by the CSP, so it is a small blocking file instead, and it touches only
 * document.documentElement — the one element that exists this early.
 *
 * Collapsed is a preference and persists. Open is not: the drawer starts shut on every page,
 * because a drawer left open across a navigation is a drawer covering the page you asked for.
 */
(function () {
  "use strict";

  var root = document.documentElement;
  var KEY = "ae.rail.collapsed";

  function stored() {
    // Private browsing and blocked storage both throw here. A preference is not worth an
    // exception that would stop the rest of this file running.
    try {
      return localStorage.getItem(KEY);
    } catch (error) {
      return null;
    }
  }

  function remember(value) {
    try {
      localStorage.setItem(KEY, value);
    } catch (error) {
      /* nothing to do: the rail still works, it just will not be remembered */
    }
  }

  if (stored() === "1") root.classList.add("rail-collapsed");

  /*
   * A page restored from the back-forward cache asks the server again.
   *
   * The server is the authority on whether a session is still live, and it stays the authority:
   * this builds no client-side authentication, holds no token and decides nothing. Every page
   * behind the session gate is already sent with `Cache-Control: no-store`, which is what forbids
   * the history cache — but not every engine treats no-store as disqualifying for BFCache, and a
   * page that IS restored is redrawn from a memory snapshot without a request being made at all.
   * The result was the reported defect: sign out, press Back, and the last report is on screen,
   * fully drawn, belonging to a session that no longer exists.
   *
   * `event.persisted` is true only for that case — a genuine BFCache restore — so an ordinary
   * navigation, a reload and a first paint are all untouched. Reloading asks the server, and the
   * session guard answers: still signed in, the same page comes back; signed out or expired, it
   * redirects to the sign-in page. Nothing on screen survives a revalidation it fails.
   *
   * Registered here rather than in a file of its own because this script is already loaded by
   * every page inside the staff shell, and by nothing outside it.
   */
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) window.location.reload();
  });

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var collapse = document.querySelector("[data-rail-collapse]");
    var burger = document.querySelector("[data-rail-open]");
    var scrim = document.querySelector("[data-rail-scrim]");

    function setCollapsed(on) {
      root.classList.toggle("rail-collapsed", on);
      remember(on ? "1" : "0");
      if (collapse) {
        collapse.setAttribute("aria-expanded", on ? "false" : "true");
        collapse.setAttribute("aria-label", on ? "Expand the sidebar" : "Collapse the sidebar");
      }
    }

    /*
     * Opening and closing the drawer, and moving focus with it.
     *
     * The panel is `visibility: hidden` while shut (see the drawer block in css/shell.css), which
     * is what keeps the off-canvas copy of the navigation out of the tab order and out of the
     * accessibility tree — so a reader on a phone meets one navigation, not two. That same rule
     * is why focus has to be placed deliberately: opening a panel nobody is focused in would
     * leave the next Tab back at the top of the document, and closing one that IS focused would
     * drop focus on the body.
     */
    function setOpen(on) {
      var wasOpen = root.classList.contains("rail-open");
      root.classList.toggle("rail-open", on);
      if (burger) burger.setAttribute("aria-expanded", on ? "true" : "false");
      if (scrim) scrim.hidden = !on;

      if (on && !wasOpen) {
        var first = document.querySelector(".rail-nav a");
        if (first) {
          /*
           * Straight away, and once more on the next frame if that did not take.
           *
           * The panel is `visibility: hidden` while shut, and a hidden element cannot be focused.
           * Adding the class makes it visible in the same task, so the first call is normally the
           * one that works — the retry is for the engine that has not settled the style yet. Not
           * a frame callback alone: `requestAnimationFrame` does not run at all while the tab is
           * not being painted, which would leave the drawer open with focus still behind it.
           */
          first.focus();
          if (document.activeElement !== first) {
            requestAnimationFrame(function () {
              first.focus();
            });
          }
        }
        return;
      }

      // Coming back: only take focus if it is about to be lost with the panel it was in.
      if (!on && wasOpen && burger) {
        var rail = document.getElementById("rail");
        if (rail && rail.contains(document.activeElement)) burger.focus();
      }
    }

    if (collapse) {
      setCollapsed(root.classList.contains("rail-collapsed"));
      collapse.addEventListener("click", function () {
        setCollapsed(!root.classList.contains("rail-collapsed"));
      });
    }

    if (burger) {
      burger.addEventListener("click", function () {
        setOpen(!root.classList.contains("rail-open"));
      });
    }

    if (scrim) {
      scrim.addEventListener("click", function () {
        setOpen(false);
      });
    }

    // Escape closes the drawer, which is what anyone who has met a drawer will try first.
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && root.classList.contains("rail-open")) setOpen(false);
    });

    /*
     * The tool strip: which tool am I in, and what else is there, while the page scrolls.
     *
     * Only below 900px, and only for a few seconds at a time. Above that width the rail is a
     * column that is always on screen, so the active entry never leaves and there is nothing to
     * restore; below it the rail is off-canvas and a reader half way down a long page has no
     * answer to "where am I" but the title bar.
     *
     * The links are the rail's own, cloned — not a second list written out again, which would be
     * two navigations to keep in step and one of them wrong the first time an entry is gated
     * differently. The rail stays the canonical navigation; this is a projection of it, and while
     * it is on screen the rail's own panel is `visibility: hidden`, so only one of the two is
     * ever reachable.
     *
     * A page that carries a permanent navigation of its own across the top declares
     * `[data-nav-strip]` — the IMDRF terminology page does, with its row of coding items — and
     * this whole mechanism stands down there. One strip across the top of a page, never two.
     *
     * It appears on scroll and holds for seven seconds after the reader stops touching it. The
     * hold is reset by anything that says the reader is still working with it — more scrolling,
     * a pointer over it, a focus in it, a key pressed in it — and it will not leave at all while
     * it is hovered or holds focus, because a strip that vanished under the thumb reaching for it
     * would be worse than no strip.
     *
     * It is `position: fixed` (css/shell.css), so appearing and disappearing never change the
     * height of the document: the paragraph being read does not move.
     */
    var TOOLS_HOLD_MS = 7000;

    (function toolStrip() {
      var nav = document.querySelector(".rail-nav");
      var top = document.querySelector(".top");
      if (!nav || !top || !top.parentNode) return;

      // A page with a permanent navigation of its own needs no transient copy of the rail.
      if (document.querySelector("[data-nav-strip]")) return;

      var narrow = window.matchMedia("(max-width: 900px)");
      var strip = null;
      var timer = null;
      var pinned = false;
      /* Set the moment the reader scrolls the strip by hand. From then on the active entry is
         left where they put it rather than being pulled back to the middle on every reappearance. */
      var steered = false;

      /*
       * Fade whichever end still has links past it, and neither when everything fits.
       *
       * Measured rather than assumed: the rail is gated by role, so the strip is four entries for
       * an administrator and seven for an officer, and only one of those overflows a 360px phone.
       */
      function edges() {
        if (!strip) return;
        var slack = strip.scrollWidth - strip.clientWidth;
        if (slack <= 1) {
          strip.removeAttribute("data-edge");
          return;
        }
        var atStart = strip.scrollLeft <= 1;
        var atEnd = strip.scrollLeft >= slack - 1;
        strip.setAttribute("data-edge", atStart ? "end" : atEnd ? "start" : "both");
      }

      /*
       * Bring the tool being read into the strip's own view.
       *
       * `scrollLeft` on the strip, never `scrollIntoView`: the latter walks up the ancestors and
       * scrolls the document too, so asking for a link that is 40px off the right edge would
       * also jump the page the reader is in the middle of.
       */
      function revealActive() {
        if (!strip || steered) return;
        var on = strip.querySelector("a.on");
        if (!on) return;
        strip.scrollLeft = Math.max(0, on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2);
        edges();
      }

      function items() {
        return strip ? Array.prototype.slice.call(strip.querySelectorAll("a")) : [];
      }

      function build() {
        if (strip) return;
        strip = document.createElement("nav");
        strip.className = "top-tools";
        strip.setAttribute("aria-label", "Staff tools");
        Array.prototype.forEach.call(nav.querySelectorAll("a"), function (link) {
          strip.appendChild(link.cloneNode(true));
        });
        top.parentNode.insertBefore(strip, top.nextSibling);

        // Still being used is still being needed: any of these re-arms the hold.
        ["pointerdown", "pointermove", "focusin", "wheel", "touchstart"].forEach(function (name) {
          strip.addEventListener(name, hold, { passive: true });
        });

        strip.addEventListener("scroll", function () {
          steered = true;
          edges();
          hold();
        }, { passive: true });

        strip.addEventListener("pointerenter", function (event) {
          // A touch fires this and often never fires the matching leave, which would pin the
          // strip open for the rest of the page. Only a cursor can hover.
          if (event.pointerType !== "mouse") return;
          pinned = true;
          hold();
        });

        strip.addEventListener("pointerleave", function () {
          pinned = false;
          hold();
        });

        strip.addEventListener("focusout", function (event) {
          if (!strip.contains(event.relatedTarget)) hold();
        });

        /*
         * Left and right walk the strip, Home and End reach its ends.
         *
         * Tab still steps through every entry in document order — nothing here takes a link out
         * of the tab sequence. This is the extra a horizontally scrolling row earns: the reader
         * can see the row is a row, and expects the arrows to follow it.
         */
        strip.addEventListener("keydown", function (event) {
          var step =
            event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          var links = items();
          if (!links.length) return;

          if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            links[event.key === "Home" ? 0 : links.length - 1].focus();
            hold();
            return;
          }
          if (!step) return;

          var at = links.indexOf(document.activeElement);
          if (at === -1) return;
          event.preventDefault();
          links[(at + step + links.length) % links.length].focus();
          hold();
        });

        revealActive();
        edges();
      }

      /** Re-arm the seven seconds, unless the reader is holding the strip open. */
      function hold() {
        if (timer) clearTimeout(timer);
        if (!strip) return;
        if (pinned || strip.contains(document.activeElement)) return;
        timer = setTimeout(hide, TOOLS_HOLD_MS);
      }

      function hide() {
        root.classList.remove("tools-on");
      }

      function show() {
        if (!narrow.matches) return;
        // The drawer is the whole navigation, opened on purpose. Its transient copy stays away.
        if (root.classList.contains("rail-open")) return;
        build();
        root.classList.add("tools-on");
        hold();
      }

      function apply() {
        if (narrow.matches) {
          // Coming down from a width where the strip was torn off: measure again before it shows.
          if (strip) edges();
          return;
        }
        if (timer) clearTimeout(timer);
        hide();
        steered = false;
        pinned = false;
        if (strip) {
          strip.remove();
          strip = null;
        }
      }

      if (narrow.addEventListener) narrow.addEventListener("change", apply);
      else if (narrow.addListener) narrow.addListener(apply);

      window.addEventListener("resize", function () {
        if (strip) edges();
      });

      /*
       * Ten reactions a second at most, not one per scroll event.
       *
       * A trackpad fires scroll dozens of times a second, and every one of those was previously a
       * clearTimeout/setTimeout pair. Collapsing the burst is also what keeps the class from being
       * taken off and put back inside one frame — the flicker this used to show on a long page.
       *
       * A clock rather than `requestAnimationFrame`: rAF does not run while the tab is not being
       * painted, so a reader who scrolled, switched away and came back would find the strip had
       * never been asked to appear. The class toggle is not worth a frame callback anyway.
       */
      var last = 0;
      window.addEventListener(
        "scroll",
        function () {
          var now = Date.now();
          if (now - last < 100) return;
          last = now;
          show();
        },
        { passive: true },
      );
    })();

    /*
     * Has the document moved under the title bar?
     *
     * The bar draws a shadow once it has, and nothing while it has not — see `:root.page-scrolled
     * .top`. Its own listener rather than a line inside the strip's, because the strip stands
     * down on a page that carries its own navigation and the bar is on every page either way.
     */
    (function pageShadow() {
      function apply() {
        root.classList.toggle("page-scrolled", window.scrollY > 4);
      }

      window.addEventListener("scroll", apply, { passive: true });
      // A page restored part way down (a back navigation, an anchor) is already scrolled.
      apply();
    })();

    /*
     * Sign out asks first.
     *
     * The link already points at a page that asks, so this only upgrades the question to a dialog
     * on the page the user is already looking at. If `showModal` is missing -- an old browser --
     * the click is left alone and the navigation happens, which is the same question either way.
     */
    var signout = document.querySelector("[data-signout]");
    var dialog = document.querySelector("[data-signout-dialog]");

    if (signout && dialog && typeof dialog.showModal === "function") {
      signout.addEventListener("click", function (event) {
        // Let a middle-click or a modified click open the fallback page in the usual way.
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;

        event.preventDefault();
        setOpen(false);
        dialog.showModal();
      });

      /*
       * A click on the backdrop cancels, which Escape already does for free.
       *
       * The backdrop is not an element of its own: clicking it dispatches a click whose target is
       * the dialog itself, while anything inside reports one of the dialog's children. The padding
       * sits on .modal-body precisely so that test stays exact — with padding on the dialog, a
       * click on its own margin would read as a backdrop click and close the question.
       *
       * close() without a value is a cancel: it submits nothing.
       */
      dialog.addEventListener("click", function (event) {
        if (event.target === dialog) dialog.close();
      });
    }
  });
})();
