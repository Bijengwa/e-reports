/**
 * Conditional fields on the orange form.
 *
 * Pure enhancement. Every rule this script appears to enforce is also enforced on the server by
 * `domain/form-schema.ts`, and the form is fully usable with this file blocked — a dependent input
 * simply stays enabled and the server rejects the step instead. Nothing here is a guarantee; it
 * exists so a reporter is not asked for the date they informed the supplier when they have just
 * answered "No".
 *
 * The rules themselves live in the markup as data attributes, generated from the same table the
 * validator reads. This script knows only how to obey them.
 */
(function () {
  "use strict";

  /** Values currently selected for a control group, whether radios, checkboxes or a plain input. */
  function controllingValues(form, name) {
    var picked = [];
    var inputs = form.querySelectorAll('[name="' + CSS.escape(name) + '"]');

    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var isTickable = input.type === "checkbox" || input.type === "radio";

      if (isTickable ? input.checked : input.value !== "") {
        picked.push(input.value);
      }
    }

    return picked;
  }

  function apply(form) {
    var wraps = form.querySelectorAll("[data-requires-field]");

    for (var i = 0; i < wraps.length; i++) {
      var wrap = wraps[i];
      var on = wrap.getAttribute("data-requires-field");
      var wanted = (wrap.getAttribute("data-requires-values") || "").split("|");
      var current = controllingValues(form, on);

      var met = wanted.some(function (value) {
        return current.indexOf(value) !== -1;
      });

      wrap.classList.toggle("is-off", !met);

      var fields = wrap.querySelectorAll("input, textarea, select");

      for (var j = 0; j < fields.length; j++) {
        var field = fields[j];
        field.disabled = !met;
        // Mirrors the server rule: switched on means mandatory, not merely available.
        field.required = met;

        // A value left behind by a since-changed answer would be posted back as a hidden
        // input on the next step, so clear it the moment it stops applying.
        if (!met) field.value = "";
      }
    }
  }

  function start() {
    var form = document.querySelector("form[data-orange-form]");
    if (!form) return;

    apply(form);
    form.addEventListener("change", function () {
      apply(form);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
