/**
 * The safety net both apps load first, before any of the framework's scripts
 * can have run (`/guard.js`).
 *
 * The pages are drawn on the server, so a page whose scripts never arrived —
 * a dropped connection, an extension or a proxy that blocks them, a policy
 * that refuses them — or threw while starting looks exactly like one that
 * works, and its buttons simply do nothing. This says so instead, in a note
 * at the top of the page with a Reload button. Once React has taken the page
 * over (the `Started` component in each layout), failures are the app's own
 * to report, and a note already up comes down again.
 *
 * Two ways in, because the framework's scripts are async and come first in
 * the <head>, so one can fail or throw before this file has arrived: a
 * listener for whatever happens after it, and a check a few seconds after
 * `load` (which waits for every async script) for a page that has had all its
 * scripts and still has not started. `Started` also leaves a flag behind, for
 * the other order: a page that started before this file arrived is never
 * told it failed.
 *
 * Plain old JavaScript with no dependencies, built with DOM calls and the
 * style object only: nothing here is HTML from a string, and the note reads
 * even when the stylesheet is what failed to load.
 */
const SOURCE = `/* __APP__: the safety net. See packages/core/src/guard.ts. */
(function () {
  "use strict";

  var started = !!window.__collectcollectStarted;
  var shown = null;
  // After load, how long a page may take to start before the note goes up.
  var GRACE_MS = 4000;
  var NOTE = "__APP__ didn't finish loading, so its buttons won't respond. Check your connection, then reload the page.";

  function own(url) {
    return typeof url === "string" && url.indexOf(location.origin + "/") === 0;
  }

  function place(note) {
    // At the top of the page, so it reads first even without the stylesheet.
    document.body.insertBefore(note, document.body.firstChild);
  }

  function show() {
    if (started || shown) return;
    var note = document.createElement("div");
    note.className = "boot-note";
    note.setAttribute("role", "alert");
    var s = note.style;
    s.position = "sticky";
    s.top = "0";
    s.zIndex = "50";
    s.padding = "0.75rem 1rem";
    s.borderBottom = "1px solid var(--line-strong, #888)";
    s.background = "var(--background, #fff)";
    s.color = "var(--foreground, #000)";
    s.fontSize = "0.875rem";
    note.appendChild(document.createTextNode(NOTE + " "));
    var reload = document.createElement("button");
    reload.type = "button";
    reload.className = "btn-secondary";
    reload.textContent = "Reload";
    reload.addEventListener("click", function () {
      location.reload();
    });
    note.appendChild(reload);
    shown = note;
    if (document.body) place(note);
    else document.addEventListener("DOMContentLoaded", function () { place(note); });
  }

  // Capture phase: a script or stylesheet that fails to load fires error on
  // its element, which does not bubble; one the policy refuses does too.
  window.addEventListener(
    "error",
    function (event) {
      var el = event.target;
      if (el && el !== window && el.tagName) {
        var tag = el.tagName.toLowerCase();
        if ((tag === "script" && own(el.src)) || (tag === "link" && el.rel === "stylesheet" && own(el.href))) show();
        return;
      }
      // An exception from one of this site's own scripts before the app
      // started. One from elsewhere (an extension) is not the app failing.
      if (own(event.filename)) show();
    },
    true,
  );

  window.addEventListener("load", function () {
    setTimeout(show, GRACE_MS);
  });

  window.collectcollectGuard = {
    started: function () {
      started = true;
      if (shown && shown.parentNode) shown.parentNode.removeChild(shown);
    },
  };
})();
`;

/** The script text, with the app's name in its note. */
export function guardSource(appName: string): string {
  // The name lands inside a string literal in a script: letters, digits, spaces and a middle dot only.
  if (!/^[A-Za-z0-9 ·]{1,40}$/.test(appName)) throw new Error("An app name for the safety net is letters, digits and spaces");
  return SOURCE.replaceAll("__APP__", appName);
}

/** The response a `/guard.js` route hands back: script, revalidated on every load since its name carries no version. */
export function guardResponse(appName: string): Response {
  return new Response(guardSource(appName), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
