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

    function setOpen(on) {
      root.classList.toggle("rail-open", on);
      if (burger) burger.setAttribute("aria-expanded", on ? "true" : "false");
      if (scrim) scrim.hidden = !on;
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
