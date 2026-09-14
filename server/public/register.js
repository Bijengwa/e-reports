/*
 * The Register page's two progressive enhancements: the download button's loading state, and the
 * dialog that shows the whole of a cell whose value is clipped to a preview.
 *
 * The download half:
 *
 * The button is a real `<a href="/register/download/xlsx">` first — with this blocked or failing
 * to load, it still downloads the file exactly as it always did. What this adds is a loading
 * state while the request is in flight, a guard against a second click starting a second
 * download, and a visible error if the request itself fails, none of which a plain navigation can
 * show on its own.
 */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  /*
   * A previewed cell, opened.
   *
   * The value is not held in an attribute and not fetched: the cell already contains it in full —
   * the clipping is CSS — so the dialog is filled from the cell's own text. One dialog for the
   * page and one listener on the table, whatever the row count.
   *
   * showModal() is what gives the backdrop, the focus trap and Escape-to-close, and returning
   * focus to the cell on close is the browser's own behaviour for a dialog opened this way. With
   * this script blocked the cell is still a preview of a value the page holds in full, and the
   * reader still has the Excel export — nothing is unreachable.
   */
  function cellDialog() {
    var dialog = document.querySelector("[data-rg-dialog]");
    var table = document.querySelector(".register-table");
    if (!dialog || !table || typeof dialog.showModal !== "function") return;

    var labelBox = dialog.querySelector("[data-rg-dialog-label]");
    var rowBox = dialog.querySelector("[data-rg-dialog-row]");
    var valueBox = dialog.querySelector("[data-rg-dialog-value]");

    table.addEventListener("click", function (event) {
      var target = event.target;
      var button = target && target.closest ? target.closest("[data-rg-open]") : null;
      if (!button) return;

      var text = button.querySelector(".rg-text");
      var row = button.closest("tr");

      if (labelBox) labelBox.textContent = button.getAttribute("data-rg-label") || "Register value";
      if (rowBox) rowBox.textContent = (row && row.getAttribute("data-rg-row")) || "";
      // textContent both ways: a register value is data, never markup.
      if (valueBox) valueBox.textContent = text ? text.textContent : "";

      dialog.showModal();
    });

    /* A click on the backdrop closes, which is the same test the sign-out dialog uses: the padding
       lives on .modal-body, so a click whose target is the dialog itself can only be the
       backdrop. */
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });
  }

  ready(function () {
    cellDialog();

    var link = document.querySelector("[data-download]");
    if (!link) return;

    var label = link.querySelector(".register-download-label");
    var url = link.getAttribute("href");
    var defaultLabel = link.getAttribute("data-default-label") || (label ? label.textContent : "");
    var loadingLabel = link.getAttribute("data-loading-label") || "Downloading…";
    var errorLabel = link.getAttribute("data-error-label") || "Download failed — try again";
    var busy = false;

    function setLabel(text) {
      if (label) label.textContent = text;
    }

    link.addEventListener("click", function (event) {
      if (busy) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      busy = true;
      link.classList.add("is-downloading");
      link.setAttribute("aria-busy", "true");
      setLabel(loadingLabel);

      fetch(url, { credentials: "same-origin" })
        .then(function (res) {
          if (!res.ok) throw new Error("register download failed with " + res.status);

          var disposition = res.headers.get("content-disposition") || "";
          var match = disposition.match(/filename="([^"]+)"/);
          var filename = match ? match[1] : "register.xlsx";

          return res.blob().then(function (blob) {
            return { blob: blob, filename: filename };
          });
        })
        .then(function (result) {
          var objectUrl = URL.createObjectURL(result.blob);
          var temp = document.createElement("a");
          temp.href = objectUrl;
          temp.download = result.filename;
          document.body.appendChild(temp);
          temp.click();
          document.body.removeChild(temp);
          setTimeout(function () {
            URL.revokeObjectURL(objectUrl);
          }, 1000);

          setLabel(defaultLabel);
        })
        .catch(function () {
          link.classList.add("is-error");
          setLabel(errorLabel);
          setTimeout(function () {
            link.classList.remove("is-error");
            setLabel(defaultLabel);
          }, 3000);
        })
        .finally(function () {
          busy = false;
          link.classList.remove("is-downloading");
          link.removeAttribute("aria-busy");
        });
    });
  });
})();
