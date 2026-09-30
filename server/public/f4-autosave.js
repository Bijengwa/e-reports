/*
 * Background draft saving for the F004.
 *
 * An assessor leaves this page all the time — to read the IMDRF handbook, to check another
 * report — and a half-written assessment must still be there when they come back. So the form
 * saves itself as a draft: shortly after typing stops, and again the moment the page is hidden or
 * left, with a keepalive request that outlives the page.
 *
 * Enhancement only. Save draft still works exactly as before with this blocked. What is posted is
 * what Save draft posts, minus the signing password (never sent in the background) and always
 * with intent=save; the server also refuses to treat an `X-F4-Autosave` request as a submission,
 * whatever its body says.
 *
 * Changes are detected by comparing the serialised form with the last copy saved, not by trusting
 * input events alone: the IMDRF picker fills its hidden fields from script, which fires none.
 */
(function () {
  "use strict";

  var DEBOUNCE_MS = 1500;
  var POLL_MS = 15000;

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var form = document.querySelector("form[data-f4-autosave]");
    if (!form || !window.fetch || !window.URLSearchParams) return;

    var statuses = form.querySelectorAll("[data-f4-autosave-status]");
    var saved = serialise();
    var inFlight = false;
    var pending = false;
    var submitting = false;
    var timer = null;

    function serialise() {
      var params = new URLSearchParams();
      new FormData(form).forEach(function (value, name) {
        if (typeof value !== "string") return;
        if (name === "signing_password" || name === "intent") return;
        params.append(name, value);
      });
      params.append("intent", "save");
      return params.toString();
    }

    function say(text, isError) {
      for (var i = 0; i < statuses.length; i++) {
        statuses[i].textContent = text;
        statuses[i].classList.toggle("is-error", !!isError);
      }
    }

    function clock() {
      var now = new Date();
      return (
        String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0")
      );
    }

    function save(leaving) {
      if (submitting) return;
      var body = serialise();
      if (body === saved) return;

      // One request at a time, so an older draft can never land after a newer one. A page that
      // is being left does not wait: its keepalive request is the last thing it will ever send.
      if (inFlight && !leaving) {
        pending = true;
        return;
      }

      inFlight = true;
      say("Saving draft…");

      fetch(form.action, {
        method: "POST",
        body: body,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-F4-Autosave": "1",
        },
        credentials: "same-origin",
        redirect: "manual",
        // A keepalive body is capped at 64 KiB; past that the browser refuses it outright, so
        // only a page that is actually being left asks for it.
        keepalive: !!leaving && body.length < 60000,
      })
        .then(function (response) {
          if (response.status === 204) {
            saved = body;
            say("Draft saved " + clock());
          } else {
            say("Not saved automatically — press Save draft.", true);
          }
        })
        .catch(function () {
          say("Offline — changes not saved yet.", true);
        })
        .then(function () {
          inFlight = false;
          if (pending) {
            pending = false;
            save(false);
          }
        });
    }

    function schedule() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        save(false);
      }, DEBOUNCE_MS);
    }

    form.addEventListener("input", schedule);
    form.addEventListener("change", schedule);
    // The picker's result list is clicked, not typed into.
    form.addEventListener("click", schedule);

    // Save draft and Sign are real submissions of the whole form; nothing in the background
    // should race them, or run again as the page unloads behind them.
    form.addEventListener("submit", function () {
      submitting = true;
      if (timer !== null) clearTimeout(timer);
    });

    // Hidden covers a new tab opened for the IMDRF handbook; pagehide covers leaving outright.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") save(true);
    });
    window.addEventListener("pagehide", function () {
      save(true);
    });
    // Coming back through the back/forward cache: the page is live again, so is the form.
    window.addEventListener("pageshow", function (event) {
      if (event.persisted) submitting = false;
    });

    setInterval(function () {
      save(false);
    }, POLL_MS);
  });
})();
