/**
 * Paste-only affordance for the IMDRF JSON textarea (`/imdrf/manage/import`).
 *
 * A UX affordance only, never a security boundary: `keydown`, `beforeinput` and `cut` are
 * intercepted so an administrator cannot free-type or edit the pasted payload, but `paste` itself
 * is always allowed, and an explicit "Clear" button empties the field to let them start over. The
 * server independently parses and validates whatever text actually arrives in the request body,
 * regardless of how this script behaved or whether it ran at all.
 */
(function () {
  "use strict";

  document.querySelectorAll("[data-paste-only]").forEach(function (el) {
    el.addEventListener("keydown", function (event) {
      event.preventDefault();
    });
    el.addEventListener("beforeinput", function (event) {
      if (event.inputType !== "insertFromPaste") {
        event.preventDefault();
      }
    });
    el.addEventListener("cut", function (event) {
      event.preventDefault();
    });
  });

  document.querySelectorAll("[data-paste-clear]").forEach(function (button) {
    button.addEventListener("click", function () {
      var targetId = button.getAttribute("data-paste-clear");
      var target = targetId ? document.getElementById(targetId) : null;
      if (target) {
        target.value = "";
        target.focus();
      }
    });
  });
})();
