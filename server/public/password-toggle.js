/*
 * Show/hide for password fields.
 *
 * Enhancement only. The control is built here rather than rendered server-side, so a browser with
 * JavaScript blocked shows a plain password field instead of a dead button that does nothing.
 *
 * The value is never read, copied, stored or logged — the only thing this touches is the `type`
 * attribute. Toggling that is the whole feature, and reading `input.value` at any point would put
 * a password somewhere it has no reason to be.
 */
(function () {
  "use strict";

  var EYE =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12Z"/>' +
    '<circle cx="12" cy="12" r="3.25"/></svg>';

  var EYE_OFF =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c7 0 10.5 6.5 10.5 6.5a17 17 0 0 1-3.4 4.1"/>' +
    '<path d="M6.4 7.6A16.7 16.7 0 0 0 1.5 12S5 18.5 12 18.5a9.9 9.9 0 0 0 3.9-.77"/>' +
    '<path d="M9.9 9.9a3.25 3.25 0 0 0 4.3 4.3"/>' +
    '<path d="m3 3 18 18"/></svg>';

  function enhance(input) {
    var wrap = document.createElement("div");
    wrap.className = "pw-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var button = document.createElement("button");
    // Never "submit": inside a form, a bare button would post it.
    button.type = "button";
    button.className = "pw-toggle";
    button.innerHTML = EYE;
    button.setAttribute("aria-label", "Show password");
    button.setAttribute("aria-pressed", "false");

    button.addEventListener("click", function () {
      var shown = input.getAttribute("type") === "text";

      input.setAttribute("type", shown ? "password" : "text");
      button.innerHTML = shown ? EYE : EYE_OFF;
      button.setAttribute("aria-label", shown ? "Show password" : "Hide password");
      button.setAttribute("aria-pressed", shown ? "false" : "true");
      // Focus goes back to the field, so a keyboard user is not left on the button mid-entry.
      input.focus();
    });

    wrap.appendChild(button);
  }

  var fields = document.querySelectorAll('input[type="password"]');
  for (var i = 0; i < fields.length; i += 1) enhance(fields[i]);
})();
