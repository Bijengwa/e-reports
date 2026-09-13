/*
 * Keeps every `[data-countdown]` element ticking after the page has loaded.
 *
 * Presentation only. The server has already rendered the true state as of the response — see
 * `Countdown` in views/countdown.tsx and `countdownLabel`/`deadlineStateOf` in
 * domain/assignment.ts, which this file's arithmetic deliberately mirrors — and this script only
 * ever recomputes the same thing from the same `data-due-at` on a timer. Nothing here decides
 * whether an assignment is overdue; it just repaints what the server already knows every second.
 * A browser that blocks this leaves a correct, merely static, countdown behind.
 */
(function () {
  "use strict";

  // Mirrors domain/assignment.ts's NEAR_DEADLINE_MS. Kept as one named constant here too, rather
  // than a bare number in the tick function below.
  var NEAR_DEADLINE_MS = 24 * 60 * 60 * 1000;

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  function formatDuration(ms) {
    var totalSeconds = Math.max(0, Math.round(ms / 1000));
    var weeks = Math.floor(totalSeconds / 604800);
    var days = Math.floor((totalSeconds % 604800) / 86400);
    var hours = Math.floor((totalSeconds % 86400) / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;

    var units = [
      [weeks, "w"],
      [days, "d"],
      [hours, "h"],
      [minutes, "m"],
      [seconds, "s"],
    ];

    var start = -1;
    for (var i = 0; i < units.length; i += 1) {
      if (units[i][0] > 0) {
        start = i;
        break;
      }
    }
    if (start === -1) start = units.length - 1;

    var parts = [];
    for (var j = start; j < units.length; j += 1) {
      var value = units[j][0];
      var label = units[j][1];
      parts.push((j === start ? String(value) : String(value).padStart(2, "0")) + label);
    }
    return parts.join(" ");
  }

  function stateOf(remainingMs) {
    if (remainingMs < 0) return "overdue";
    if (remainingMs <= NEAR_DEADLINE_MS) return "near";
    return "on-track";
  }

  function tick(el) {
    if (el.getAttribute("data-completed") === "true") return;

    var dueAtRaw = el.getAttribute("data-due-at");
    if (!dueAtRaw) return;

    var dueAt = new Date(dueAtRaw).getTime();
    if (Number.isNaN(dueAt)) return;

    var remainingMs = dueAt - Date.now();
    var state = stateOf(remainingMs);
    var label =
      state === "overdue"
        ? "OVERDUE · " + formatDuration(-remainingMs)
        : formatDuration(remainingMs);

    el.textContent = label;
    el.className = "countdown countdown-" + state;
  }

  function tickAll() {
    var elements = document.querySelectorAll("[data-countdown]");
    for (var i = 0; i < elements.length; i += 1) tick(elements[i]);
  }

  ready(function () {
    if (document.querySelector("[data-countdown]") === null) return;
    tickAll();
    setInterval(tickAll, 1000);
  });
})();
