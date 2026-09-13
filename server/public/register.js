/*
 * The Register download button's progressive enhancement.
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

  ready(function () {
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
