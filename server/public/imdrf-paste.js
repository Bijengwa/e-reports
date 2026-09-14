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
    // Allow Ctrl+V / Cmd+V so the official JSON can be pasted.
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "v"
    ) {
      return;
    }

    // Block all other keyboard editing.
    event.preventDefault();
  });

  el.addEventListener("beforeinput", function (event) {
    // Allow actual paste input.
    if (event.inputType === "insertFromPaste") {
      return;
    }

    // Block typing, deletion, replacement, etc.
    event.preventDefault();
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
