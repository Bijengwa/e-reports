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

        if (field.type === "checkbox") {
          // A checkbox group is satisfied once ANY option is checked, not once every option is.
          // Native `required` on each checkbox demands all of them, so it is left off here and
          // "at least one" is enforced below instead, the one thing `required` cannot express.
          field.required = false;
          if (!met) {
            field.checked = false;
            field.setCustomValidity("");
          }
          continue;
        }

        // Mirrors the server rule: switched on means mandatory, not merely available.
        field.required = met;

        // A value left behind by a since-changed answer would be posted back as a hidden
        // input on the next step, so clear it the moment it stops applying.
        if (!met) field.value = "";
      }

      updateCheckboxGroupValidity(wrap, met);
    }
  }

  /**
   * Enforces "at least one checked" on every checkbox group inside a dependent wrap. HTML's
   * `required` cannot express this for a checkbox group — set on each box it demands all of
   * them — so this reports the group invalid, via `setCustomValidity`, only while it is switched
   * on and nothing in it is checked.
   */
  function updateCheckboxGroupValidity(wrap, met) {
    var groups = {};
    var checkboxes = wrap.querySelectorAll('input[type="checkbox"]');

    for (var i = 0; i < checkboxes.length; i++) {
      var name = checkboxes[i].name;
      groups[name] = groups[name] || [];
      groups[name].push(checkboxes[i]);
    }

    for (var name in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, name)) continue;

      var group = groups[name];
      var anyChecked = group.some(function (cb) {
        return cb.checked;
      });
      var message = met && !anyChecked ? "Select at least one option." : "";

      for (var k = 0; k < group.length; k++) {
        group[k].setCustomValidity(message);
      }
    }
  }

  /**
   * Previews the full name the server will derive, so the reporter is not left staring at a blank
   * read-only box while they type. Purely cosmetic: `domain/form-schema.ts#deriveDeviceFullName`
   * is what actually decides the stored value, and does so again on every submit regardless of
   * what this script wrote here.
   */
  function applyDeviceName(form) {
    var deviceName = form.querySelector("#device_name");
    var brand = form.querySelector("#brand_name");
    var common = form.querySelector("#common_name");
    if (!deviceName || !brand || !common) return;

    var parts = [];
    if (brand.value.trim() !== "") parts.push(brand.value.trim());
    if (common.value.trim() !== "") parts.push(common.value.trim());
    deviceName.value = parts.join(" — ");
  }

  function start() {
    var form = document.querySelector("form[data-orange-form]");
    if (!form) return;

    apply(form);
    applyDeviceName(form);

    form.addEventListener("change", function () {
      apply(form);
    });

    // `input` rather than `change`, so the preview updates as the reporter types rather than only
    // once the field loses focus.
    form.addEventListener("input", function (event) {
      var target = event.target;
      if (target && (target.id === "brand_name" || target.id === "common_name")) {
        applyDeviceName(form);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
