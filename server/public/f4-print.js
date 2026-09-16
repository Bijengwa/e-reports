/*
 * The Final F004's print button.
 *
 * `[data-f4-print]` is a real <button type="button">, so with this blocked it is inert rather
 * than broken — there is no bare href underneath it a browser could fall back to, because
 * `window.print()` has no non-script equivalent. A reader with scripting off still has the
 * document itself and, on most browsers, their own Ctrl+P — this button is a convenience over
 * that, not the only way to reach it.
 *
 * What gets printed is decided entirely by the CSS already loaded on the page — the same
 * `@media print` rules that hide `.rail`, `.top` and `.f4-toolbar` for the print stylesheet's own
 * sake also apply here, so this script prints exactly whichever Final F004 presentation (Clean or
 * Assessment History) the reader currently has open. Nothing here decides that; it only calls the
 * browser's own print dialog.
 */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var button = document.querySelector("[data-f4-print]");
    if (!button) return;

    button.addEventListener("click", function () {
      window.print();
    });
  });
})();
