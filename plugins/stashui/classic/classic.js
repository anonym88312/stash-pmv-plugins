// Stash UI inside classic Stash:
// 1. Embedded in Stash UI → hide the own navigation (CSS class kb-embed).
// 2. Home page "/" → redirect to Stash UI (can be turned off; "/?classic=1" stays classic for this tab).
// 3. "Stash UI" button in the navigation (back to Stash UI).
(function () {
  "use strict";
  var APP = "/plugin/stashui/assets/index.html";
  var html = document.documentElement;
  var embedded = false;
  try {
    embedded = window.self !== window.top;
  } catch (e) {
    embedded = true;
  }
  html.classList.add("kb-classic");
  if (embedded) html.classList.add("kb-embed");

  // Settings → "Style classic Stash like Stash UI" off: classic Stash keeps its own look (only the button back to
  // Stash UI stays). The look is one block of rules, between two marker rules in classic.css – deleted here, whether
  // Stash serves the file alone or together with other plugins' CSS. (Not inside Stash UI itself: pages of classic
  // Stash shown there keep the look.)
  function plain() {
    try {
      return localStorage.getItem("stashui.plainClassic") === "true";
    } catch (e) {
      return false;
    }
  }
  function stripLook() {
    var done = false;
    for (var i = 0; i < document.styleSheets.length; i++) {
      var sh = document.styleSheets[i];
      var rules;
      try {
        rules = sh.cssRules;
      } catch (e) {
        continue; // (a sheet of another site)
      }
      var a = -1;
      var b = -1;
      for (var j = 0; j < rules.length; j++) {
        var sel = rules[j].selectorText;
        if (sel === ".kb-classic-start") a = j;
        else if (sel === ".kb-classic-end") {
          b = j;
          break;
        }
      }
      if (a >= 0 && b > a) {
        for (var k = b; k >= a; k--) sh.deleteRule(k);
        done = true;
      }
    }
    return done;
  }
  if (!embedded && plain()) {
    html.classList.add("kb-plain");
    var tries2 = 0;
    var strip = function () {
      if (stripLook() || ++tries2 > 40) return;
      setTimeout(strip, 150);
    };
    strip();
    var st = document.createElement("style");
    st.textContent = ".kb-back-dot { display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; background: #ff3e8a; }";
    document.head.appendChild(st);
  }

  // The colors chosen in Stash UI (Settings → Appearance, saved in this browser as "stashui.theme") color classic Stash too:
  // the look below is made of the --st-* variables, so they are set from the chosen colors. Nothing chosen = the Plum default in the CSS.
  function rgbOf(color) {
    var el = document.createElement("span");
    el.style.color = color;
    document.body.appendChild(el);
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(el).color);
    el.remove();
    return m ? m[1] + ", " + m[2] + ", " + m[3] : "";
  }
  function applyColors() {
    var th;
    try {
      th = JSON.parse(localStorage.getItem("stashui.theme") || "null");
    } catch (e) {
      th = null;
    }
    var c = th && th.colors;
    if (!c || typeof c !== "object") return;
    var s = html.style;
    var set = function (name, v) {
      if (typeof v === "string" && v && window.CSS && CSS.supports("color", v)) s.setProperty(name, v);
    };
    var pink = c["--pink"];
    set("--st-ink", c["--bg"]);
    set("--st-ink-2", c["--bg-2"]);
    set("--st-ink-3", c["--bg-3"]);
    set("--st-paper", c["--text"]);
    set("--st-smudge", c["--text-2"]);
    set("--st-faint", c["--faint"]);
    set("--st-flush", pink);
    set("--primary", pink);
    set("--secondary", c["--bg-2"]);
    set("--dark", c["--bg"]);
    set("--danger", c["--danger"]);
    set("--success", c["--ok"]);
    if (typeof pink === "string" && pink) {
      s.setProperty("--st-flush-deep", "color-mix(in srgb, " + pink + ", #000 55%)");
      if (pink.toLowerCase() !== "#ff3e8a") s.setProperty("--st-violet", "color-mix(in srgb, " + pink + " 70%, #fff)");
    }
    var rgb = function (name, v) {
      var r = typeof v === "string" && v ? rgbOf(v) : "";
      if (r) s.setProperty(name, r);
    };
    var go = function () {
      rgb("--st-ink-rgb", c["--bg"]);
      rgb("--st-ink-2-rgb", c["--bg-2"]);
      rgb("--st-flush-rgb", pink);
    };
    if (document.body) go();
    else document.addEventListener("DOMContentLoaded", go);
  }
  if (!(!embedded && plain())) applyColors();

  var params = new URLSearchParams(location.search);
  try {
    if (params.get("classic") === "1") sessionStorage.setItem("stashui.classic", "1");
  } catch (e) { /* ignore */ }

  function keepClassic() {
    try {
      return localStorage.getItem("stashui.keepClassicHome") === "true" || sessionStorage.getItem("stashui.classic") === "1";
    } catch (e) {
      return false;
    }
  }

  // Jump marker: after loading, switch internally to a plugin page (e.g. /plugin/example)
  var jump = params.get("kbroute");
  if (jump && /^\/[^/]/.test(jump)) {
    var tries = 0;
    var go = function () {
      if (document.querySelector(".main") || ++tries > 60) {
        history.replaceState(null, "", jump);
        window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
      } else setTimeout(go, 100);
    };
    setTimeout(go, 150);
  } else if (!embedded && location.pathname === "/" && !keepClassic()) {
    location.replace(APP);
    return;
  }

  // Refresh the setting in the background (for the next visit)
  fetch("/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: 'query { configuration { plugins(include: ["stashui"]) } }' }),
  })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var c = (j.data && j.data.configuration.plugins && j.data.configuration.plugins.stashui) || {};
      localStorage.setItem("stashui.keepClassicHome", String(!!c.keepClassicHome));
      localStorage.setItem("stashui.plainClassic", String(!!c.plainClassic));
    })
    .catch(function () {});

  if (embedded) return;

  // Button back to Stash UI
  function inject() {
    if (document.querySelector(".kb-back-btn")) return;
    var bar = document.querySelector(".navbar-buttons");
    if (!bar) return;
    var a = document.createElement("a");
    a.className = "btn nav-link kb-back-btn";
    a.href = APP;
    a.title = "Back to Stash UI";
    a.innerHTML = '<span class="kb-back-dot"></span><span>Stash UI</span>';
    bar.insertBefore(a, bar.firstChild);
  }
  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    setTimeout(function () {
      queued = false;
      inject();
    }, 80);
  }).observe(document.body, { childList: true, subtree: true });
  inject();
})();
