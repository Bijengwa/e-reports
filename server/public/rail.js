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
     * Has the document moved under the title bar?
     *
     * The bar draws a shadow once it has, and nothing while it has not — see `:root.page-scrolled
     * .top`.
     *
     * There is deliberately no copy of the rail's links across the top on a narrow screen. The
     * drawer behind the menu button is the one navigation; a second strip of the same links under
     * the title bar read as a toolbar that did not belong there.
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
