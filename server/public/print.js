/*
 * The final-document downloads: print the document the server just rendered.
 *
 * Both PDF addresses serve the same document this application shows on screen, with the
 * application's chrome stripped and the print stylesheet in force, and the browser's own print
 * pipeline turns it into the file. There is no second renderer and no headless browser in the
 * deployment — the PDF is this page.
 *
 * Enhancement only. With this script blocked the reader is looking at the finished printable
 * document and reaches the same result through their browser's print command, which is why
 * nothing here reports a failure: there is nothing to recover from.
 */
(function () {
  "use strict";

  var doc = document.querySelector("[data-print-document]");
  if (doc === null) return;

  // After load rather than on DOMContentLoaded: the print dialogue captures a snapshot of the
  // page, and a dialogue opened before the stylesheet and the fonts have arrived would produce a
  // PDF of a half-styled document.
  window.addEventListener("load", function () {
    window.print();
  });
})();
