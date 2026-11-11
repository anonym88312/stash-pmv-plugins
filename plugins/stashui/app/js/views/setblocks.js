// Hand-made controls of the Settings page (the catalog in setdefs.js points at them with { k: "block", block: "<name>" }).
// A block = { html(c) → string, bind(el, c) → optional cleanup }; c = { S: the loaded configuration, titleOf(label) }.

import { iconFromFile, applyDisplay } from "../display.js";
import { tagPicker } from "./tagpicker.js";
import { esc, icon, toast, errorToast, store, confirmDialog } from "../ui.js";
import { t, locale } from "../i18n.js";
import { gql, setPluginConfig, pluginConfig } from "../api.js";
import { go } from "../main.js";
import { exportBackup, importBackup } from "../backup.js";
import { pokeJobs } from "../jobs.js";
import { themeHtml, bindTheme } from "../theme.js";
import { interactiveConfig, saveInteractiveConfig, testHandy, runBackend } from "../interactive.js";
import { hiddenItems, hiddenState, hiddenNames } from "../hidden.js";
import { saveHidden } from "../hiddensync.js";
import { typeInfo, fieldHtml, readFields } from "../forms.js";

const saved = () => toast(t("Saved"), "ok");
const row = (title, hint, control, cls = "") => `<div class="kb-set ${cls}"><div class="kb-set-label"><b>${t(title)}</b>${hint ? `<small>${t(hint)}</small>` : ""}</div>${control}</div>`;

export const BLOCKS = {
  // ---- colors, liquid glass, wallpaper
  theme: {
    html: () => themeHtml(),
    bind: (el) => bindTheme(el),
  },

  // ---- the icon of the browser tab
  favicon: {
    html: () =>
      row("Tab icon", "A small picture for the browser tab (any image – it is cut square and made small). Kept in this browser.",
        `<span class="kb-set-btns"><img class="kb-favprev" data-favprev alt="" width="28" height="28" hidden><button type="button" class="kb-btn" data-favpick>${t("Choose a picture")}</button><button type="button" class="kb-btn is-ghost" data-favreset>${t("Default icon")}</button><input type="file" accept="image/*" data-favfile hidden></span>`),
    bind(el) {
      const paint = () => {
        const f = String(store.get("favicon", "") || "");
        const im = el.querySelector("[data-favprev]");
        im.hidden = !f;
        if (f) im.src = f;
        el.querySelector("[data-favreset]").disabled = !f;
      };
      paint();
      el.querySelector("[data-favpick]").onclick = () => el.querySelector("[data-favfile]").click();
      el.querySelector("[data-favfile]").onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!file) return;
        try {
          store.set("favicon", await iconFromFile(file));
          applyDisplay();
          paint();
          saved();
        } catch (err) {
          toast(t("That isn't a picture the browser can read."), "error");
        }
      };
      el.querySelector("[data-favreset]").onclick = () => {
        store.set("favicon", "");
        applyDisplay();
        paint();
        saved();
      };
    },
  },

  // ---- other plugins in the menu
  extmenu: {
    html: () =>
      row("Other plugins in the menu", "Plugins with their own page get an entry under “Extensions” on the left. Fold the group with a click on its heading, or hide it here – all of it or single plugins.",
        `<select class="kb-field" data-extmode><option value="show">${t("Show")}</option><option value="hide">${t("Hide")}</option></select><div class="kb-extpick" data-extpick></div>`, "kb-set-ext"),
    bind(el) {
      const mode = el.querySelector("[data-extmode]");
      mode.value = store.get("extMode", "show");
      const paint = () => {
        const found = store.get("extFound", []);
        const off = new Set(store.get("extHidden", []));
        const box = el.querySelector("[data-extpick]");
        box.hidden = mode.value === "hide" || !found.length;
        box.innerHTML = found.map((f) => `<label class="kb-check"><input type="checkbox" data-extid="${esc(f.id)}"${off.has(f.id) ? "" : " checked"}>${esc(f.name)}</label>`).join("");
      };
      paint();
      const changed = () => window.dispatchEvent(new Event("stash:plugins-changed"));
      mode.onchange = () => {
        store.set("extMode", mode.value);
        paint();
        changed();
      };
      el.querySelector("[data-extpick]").addEventListener("change", (e) => {
        const c = e.target.closest("[data-extid]");
        if (!c) return;
        const off = new Set(store.get("extHidden", []));
        c.checked ? off.delete(c.dataset.extid) : off.add(c.dataset.extid);
        store.set("extHidden", [...off]);
        changed();
      });
    },
  },

  // ---- install as an app
  install: {
    html: () => row("Install as app", "", `<button type="button" class="kb-btn" data-install hidden>${icon("download")}${t("Install")}</button>`).replace("</b></div>", `</b><small data-installhint></small></div>`),
    bind(el) {
      const btn = el.querySelector("[data-install]");
      const hint = el.querySelector("[data-installhint]");
      const paint = () => {
        const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
        const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        btn.hidden = !window.kbInstall || standalone;
        hint.textContent = standalone
          ? t("You're using the app right now.")
          : window.kbInstall
            ? t("Its own window and a home screen icon, without the browser bar.")
            : ios
              ? t("In Safari: Share → Add to Home Screen.")
              : !window.isSecureContext
                ? t("Browsers only install apps from https or on the computer Stash runs on (localhost). On other devices: browser menu → Add to Home screen – that adds a shortcut.")
                : t("Use the install icon in the address bar, or the browser menu → Install app. Firefox can't install web apps.");
      };
      paint();
      window.addEventListener("kb-installable", paint);
      btn.onclick = async () => {
        const e = window.kbInstall;
        if (!e) return;
        e.prompt();
        const r = await e.userChoice;
        if (r.outcome === "accepted") {
          window.kbInstall = null;
          toast(t("Installed"), "ok");
        }
        paint();
      };
      return () => window.removeEventListener("kb-installable", paint);
    },
  },

  // ---- the menu items of classic Stash
  menuitems: {
    ITEMS: [["scenes", "Scenes"], ["images", "Images"], ["groups", "Groups"], ["markers", "Markers"], ["galleries", "Galleries"], ["performers", "Performers"], ["studios", "Studios"], ["tags", "Tags"]],
    html(c) {
      const on = new Set((c.S.typed.interface.menuItems || this.ITEMS.map((x) => x[0])).map((x) => (x === "movies" ? "groups" : x)));
      return row("Menu items", "Show or hide different types of content on the navigation bar.", `<div class="kb-chips" data-menuitems>${this.ITEMS.map(([k, l]) => `<button type="button" class="kb-chip${on.has(k) ? " is-on" : ""}" data-mi="${k}">${t(l)}</button>`).join("")}</div>`);
    },
    bind(el, c) {
      const box = el.querySelector("[data-menuitems]");
      box.onclick = async (e) => {
        const b = e.target.closest("[data-mi]");
        if (!b) return;
        b.classList.toggle("is-on");
        const items = [...box.querySelectorAll(".is-on")].map((x) => x.dataset.mi);
        try {
          await gql(`mutation($i: ConfigInterfaceInput!) { configureInterface(input: $i) { __typename } }`, { i: { menuItems: items } });
          c.S.typed.interface.menuItems = items;
          saved();
        } catch (err) {
          b.classList.toggle("is-on");
          errorToast(err, "Menu items");
        }
      };
    },
  },

  // ---- the one folder for clips and GIFs
  clipsdir: {
    html: () =>
      row("Folder for new clips and GIFs", "Every clip, GIF and edit you make is saved here, all together – not next to each original. Needs a full path (e.g. E:\\Stash\\Clips) and should lie inside a library folder, so Stash finds the files. Empty = next to each original.",
        `<span class="kb-set-btns"><input class="kb-field" type="text" data-clipsdir autocomplete="off" spellcheck="false" placeholder="${esc(t("next to each original"))}"><button type="button" class="kb-btn" data-clipsdirsave>${t("Save")}</button></span><small class="kb-set-msg" data-clipsdirmsg></small>`),
    bind(el) {
      const input = el.querySelector("[data-clipsdir]");
      const msg = el.querySelector("[data-clipsdirmsg]");
      pluginConfig("stashui").then((c) => (input.value = c.clipsDir || "")).catch(() => {});
      el.querySelector("[data-clipsdirsave]").onclick = async () => {
        const path = input.value.trim();
        try {
          const r = await runBackend({ mode: "clips_dir_check", path });
          if (!r.ok) {
            msg.textContent = r.why === "relative" ? t("That isn't a full path (like E:\\Stash\\Clips).") : t("This folder can't be used: {why}", { why: r.why });
            return;
          }
          await setPluginConfig("stashui", { clipsDir: path || undefined });
          (await import("../clipsdir.js")).forgetClipsDir();
          msg.textContent = !path ? t("Saved – clips go next to their originals again.") : r.in_library ? t("Saved.") : t("Saved – but this folder isn't inside a library folder of Stash, so Stash won't find the files until you add it under Settings → Library.");
          saved();
        } catch (e) {
          msg.textContent = e.message;
        }
      };
    },
  },

  // ---- NSFW: tags that are never blurred
  nsfwtags: {
    html: () => row("NSFW mode: never blur these tags", "Scenes, images and galleries with one of these tags stay sharp (thumbnails and, with “Everything”, the player and viewer). Applies to lists the next time they load.", `<div data-nsfwtags></div>`, "kb-set-ext"),
    bind(el) {
      tagPicker(el.querySelector("[data-nsfwtags]"), {
        include: store.get("nsfwKeepTags", []) || [],
        placeholder: t("Search tag"),
        onChange: (inc) => {
          store.set("nsfwKeepTags", inc);
          window.dispatchEvent(new Event("stash:display-changed"));
          saved();
        },
      });
    },
  },

  // ---- hidden folders
  hidden: {
    html: () => row("Hidden folders", "What lies in a hidden folder shows up on no page – only when you open the folder itself. Hide a folder on its page (Folders → open it → “Hide this folder”). Numbers such as the scene count of a performer or tag may still include it.", `<div class="kb-hidden-list" data-hiddenlist></div>`, "kb-set-col"),
    bind(el) {
      const list = el.querySelector("[data-hiddenlist]");
      const paint = () => {
        const items = hiddenItems();
        list.innerHTML = items.length
          ? items
              .map((x, i) => `<div class="kb-hrow"><span class="kb-hrow-name"><b>${esc(x.name)}</b><small>${esc(x.path)}</small></span><span class="kb-set-btns">${x.id ? `<a class="kb-btn" href="#/folder/${esc(x.id)}">${t("Open")}</a>` : `<small>${t("Not found in Stash")}</small>`}<button type="button" class="kb-btn" data-unhide="${i}">${t("Show again")}</button></span></div>`)
              .join("")
          : `<small class="kb-hint">${t("No folder is hidden.")}</small>`;
      };
      paint();
      list.onclick = async (e) => {
        const b = e.target.closest("[data-unhide]");
        if (!b) return;
        try {
          await saveHidden({ items: hiddenItems().filter((_, i) => i !== Number(b.dataset.unhide)), names: hiddenState().names });
          toast(t("Shown on all pages again."), "ok");
        } catch (err) {
          errorToast(err, "Hidden folders");
        }
        paint();
      };
    },
  },
  hidenames: {
    html: () => `<label class="kb-set kb-set-bool"><span class="kb-set-label"><b>${t("Show hidden folders on the Folders page")}</b><small>${t("Off: the hidden folders aren't listed anywhere – open one from the list above.")}</small></span><span class="kb-switch"><input type="checkbox" data-hidenames${hiddenNames() ? " checked" : ""}><i></i></span></label>`,
    bind(el) {
      el.querySelector("[data-hidenames]").onchange = async (e) => {
        try {
          await saveHidden({ items: hiddenItems(), names: e.target.checked });
          saved();
        } catch (err) {
          errorToast(err, "Hidden folders");
        }
      };
    },
  },

  // ---- external players
  extplayers: {
    html: () => row("External players", "The “External player” button in a scene's info panel hands the video to a player on this device – for formats the browser can't play. Choose the ones to offer; some need a small helper installed (see below each).", `<div class="kb-extpick" data-extpick></div>`, "kb-set-col"),
    bind(el) {
      (async () => {
        const { playersHere, saveExtPlayers, offeredPlayers } = await import("../extplayer.js");
        const box = el.querySelector("[data-extpick]");
        if (!box) return;
        const on = new Set((await offeredPlayers()).map((p) => p.id));
        box.innerHTML = playersHere()
          .map((p) => `<label class="kb-set kb-set-bool"><span class="kb-set-label"><b>${esc(p.name)}</b>${p.hint ? `<small>${esc(t(p.hint))}</small>` : ""}</span><span class="kb-switch"><input type="checkbox" data-xp="${p.id}"${on.has(p.id) ? " checked" : ""}><i></i></span></label>`)
          .join("");
        box.onchange = async (e) => {
          const c = e.target.closest("[data-xp]");
          if (!c) return;
          c.checked ? on.add(c.dataset.xp) : on.delete(c.dataset.xp);
          await saveExtPlayers({ enabled: [...on] });
          saved();
        };
      })().catch(() => {});
    },
  },

  // ---- The Handy (Stash's own interface settings – classic Stash uses the same)
  handy: {
    html: () => `<div class="kb-set-handy">
      <p class="kb-hint">${t("Scenes with a funscript play on The Handy: it follows play, pause and jumps. Saved in Stash – classic Stash uses the same settings.")}</p>
      <label class="kb-set"><span class="kb-set-label"><b>${t("Connection key")}</b><small>${t("From the Handy app or handyfeeling.com. Empty = off.")}</small></span>
        <input class="kb-field" type="text" data-hkey autocomplete="off" spellcheck="false" placeholder="${t("e.g. abc123XYZ")}"></label>
      <label class="kb-set"><span class="kb-set-label"><b>${t("Script offset")}</b><small>${t("Milliseconds – if the movement comes too early (negative) or too late (positive).")}</small></span>
        <input class="kb-field" type="number" step="10" data-hoff style="max-width:120px"></label>
      <label class="kb-set kb-set-bool"><span class="kb-set-label"><b>${t("The Handy fetches the script from Stash")}</b><small>${t("Only when Stash can be reached from the internet. Otherwise the script goes to the Handy's own server for playback.")}</small></span>
        <span class="kb-switch"><input type="checkbox" data-hhost><i></i></span></label>
      <div class="kb-set"><span class="kb-set-label"><b>${t("Test the connection")}</b><small data-hres>${t("Is the Handy online, and how far off is its clock?")}</small></span>
        <button type="button" class="kb-btn" data-htest>${t("Test")}</button></div></div>`,
    bind(el) {
      interactiveConfig(true).then((c) => {
        el.querySelector("[data-hkey]").value = c.handyKey;
        el.querySelector("[data-hoff]").value = c.funscriptOffset;
        el.querySelector("[data-hhost]").checked = c.useStashHostedFunscript;
      });
      const save = async (patch) => {
        try {
          await saveInteractiveConfig(patch);
          saved();
        } catch (err) {
          errorToast(err, "The Handy");
        }
      };
      el.querySelector("[data-hkey]").onchange = (e) => save({ handyKey: e.target.value.trim() });
      el.querySelector("[data-hoff]").onchange = (e) => save({ funscriptOffset: Math.round(Number(e.target.value) || 0) });
      el.querySelector("[data-hhost]").onchange = (e) => save({ useStashHostedFunscript: e.target.checked });
      el.querySelector("[data-htest]").onclick = async (e) => {
        const res = el.querySelector("[data-hres]");
        e.target.disabled = true;
        res.textContent = t("Testing …");
        try {
          const off = await testHandy();
          res.textContent = t("Online and ready – clock difference {n} ms", { n: off });
          res.className = "is-ok";
        } catch (err) {
          res.textContent = err.message;
          res.className = "is-err";
        }
        e.target.disabled = false;
      };
    },
  },

  // ---- FFmpeg download
  dlffmpeg: {
    html: () => row("Download FFmpeg", "Downloads FFmpeg into the configuration directory and clears the ffmpeg and ffprobe paths to resolve from the configuration directory.", `<button type="button" class="kb-btn" data-dlff>${icon("download")}${t("Download FFmpeg")}</button>`),
    bind(el) {
      el.querySelector("[data-dlff]").onclick = async () => {
        const r = await confirmDialog({ title: t("Download FFmpeg?"), text: t("This downloads FFmpeg and clears the ffmpeg and ffprobe paths. It runs as a background task."), ok: t("Download") });
        if (!r.ok) return;
        try {
          await gql(`mutation { downloadFFMpeg }`);
          pokeJobs();
          toast(t("Downloading – see Tasks"), "ok");
        } catch (e) {
          errorToast(e, "Download FFmpeg");
        }
      };
    },
  },

  // ---- API key
  apikey: {
    html(c) {
      const key = c.S.typed.general.apiKey;
      return row("API key", "For external programs. Generating a new one invalidates the old one.",
        `<div class="kb-apikey"><code data-key>${key ? esc(key) : t("no key")}</code><button type="button" class="kb-btn" data-genkey>${t("Generate new")}</button>${key ? `<button type="button" class="kb-btn is-ghost" data-clearkey>${t("Remove")}</button>` : ""}</div>`);
    },
    bind(el) {
      el.addEventListener("click", async (e) => {
        const gen = e.target.closest("[data-genkey]");
        const clr = e.target.closest("[data-clearkey]");
        if (!gen && !clr) return;
        const r = await confirmDialog({ title: gen ? t("Generate a new API key?") : t("Remove the API key?"), text: t("Programs using the old key lose access."), ok: gen ? t("Generate") : t("Remove"), danger: !!clr });
        if (!r.ok) return;
        try {
          const d = await gql(`mutation($c: Boolean) { generateAPIKey(input: { clear: $c }) }`, { c: !!clr });
          el.querySelector("[data-key]").textContent = d.generateAPIKey || t("no key");
          toast(t("API key changed"), "ok");
        } catch (err) {
          errorToast(err, "API key");
        }
      });
    },
  },

  // ---- where the config file is (read-only)
  configfile: {
    html: (c) => (c.S.typed.general.configFilePath ? row("Configuration file", "The file Stash keeps its settings in. Edit it only while Stash is stopped.", `<code class="kb-set-code">${esc(c.S.typed.general.configFilePath)}</code>`) : ""),
  },

  // ---- DLNA: is it running?
  dlnastatus: {
    html: () => row("DLNA status", "", `<span class="kb-set-btns"><span data-dlnastate class="kb-set-state">${t("Loading …")}</span><button type="button" class="kb-btn" data-dlnaon hidden>${t("Start DLNA")}</button><button type="button" class="kb-btn" data-dlnaoff hidden>${t("Stop DLNA")}</button></span><small class="kb-set-msg" data-dlnaips></small>`),
    bind(el) {
      const paint = async () => {
        try {
          const d = (await gql(`query { dlnaStatus { running until recentIPAddresses } }`)).dlnaStatus;
          el.querySelector("[data-dlnastate]").textContent = d.running ? t("Running") : t("Stopped");
          el.querySelector("[data-dlnaon]").hidden = d.running;
          el.querySelector("[data-dlnaoff]").hidden = !d.running;
          el.querySelector("[data-dlnaips]").textContent = d.recentIPAddresses && d.recentIPAddresses.length ? t("Recent IP addresses") + ": " + d.recentIPAddresses.join(", ") : "";
        } catch (e) {
          el.querySelector("[data-dlnastate]").textContent = e.message;
        }
      };
      paint();
      const toggle = (on) => async () => {
        try {
          await gql(`mutation { ${on ? "enableDLNA" : "disableDLNA"}(input: {}) }`);
          toast(on ? t("DLNA started") : t("DLNA stopped"), "ok");
        } catch (e) {
          errorToast(e, "DLNA");
        }
        paint();
      };
      el.querySelector("[data-dlnaon]").onclick = toggle(true);
      el.querySelector("[data-dlnaoff]").onclick = toggle(false);
    },
  },

  // ---- the latest log entries
  logs: {
    html: () => `<section class="kb-logs" data-logs></section>`,
    bind(el) {
      const box = el.querySelector("[data-logs]");
      const level = store.get("logLevel", "Info");
      box.innerHTML = `<h2 class="kb-h2">${t("Latest entries")}
        <select class="kb-field" data-lvl>${["Debug", "Info", "Warning", "Error"].map((l) => `<option value="${l}"${l === level ? " selected" : ""}>${t(l)}</option>`).join("")}</select>
        <button type="button" class="kb-btn is-ghost" data-refresh>${t("Refresh")}</button></h2><div class="kb-loglist" data-list>${t("Loading …")}</div>`;
      const order = { Trace: 0, Debug: 1, Info: 2, Progress: 2, Warning: 3, Error: 4 };
      const load = async () => {
        try {
          const d = await gql(`query { logs { time level message } }`);
          const min = order[box.querySelector("[data-lvl]").value];
          const rows = d.logs.filter((l) => (order[l.level] ?? 2) >= min).slice(-400).reverse();
          box.querySelector("[data-list]").innerHTML = rows.length
            ? rows.map((l) => `<div class="kb-log is-${l.level.toLowerCase()}"><time>${esc(new Date(l.time).toLocaleTimeString(locale()))}</time><b>${esc(l.level)}</b><span>${esc(l.message)}</span></div>`).join("")
            : `<p class="kb-hint">${t("No entries at this level.")}</p>`;
        } catch (e) {
          box.querySelector("[data-list]").textContent = t("Couldn't load the log:") + " " + e.message;
        }
      };
      box.querySelector("[data-lvl]").onchange = (e) => {
        store.set("logLevel", e.target.value);
        load();
      };
      box.querySelector("[data-refresh]").onclick = load;
      load();
    },
  },

  // ---- database: back up, optimize, clean up
  system: {
    async html() {
      const cg = await typeInfo("CleanGeneratedInput");
      return `<div class="kb-cards">
        <section class="kb-card"><h2>${t("Back up database")}</h2><p>${t("Stores a copy of the database in the backup folder.")}</p>
          <label class="kb-check"><input type="checkbox" data-blobs>${t("Include image data")}</label>
          <button type="button" class="kb-btn is-primary" data-backup>${t("Back up now")}</button></section>
        <section class="kb-card"><h2>${t("Optimize database")}</h2><p>${t("Tidies up the database internally and makes it smaller. Runs as a background task.")}</p>
          <button type="button" class="kb-btn" data-optimise>${t("Optimize")}</button></section>
        <section class="kb-card"><h2>${t("Clean up generated files")}</h2><p>${t("Removes previews, sprites and other generated files that no longer belong to a scene or image.")}</p>
          <form data-cleangen>${(await Promise.all(cg.inputFields.map((f) => fieldHtml(f.name, f.type, f.name === "dryRun")))).join("")}
          <button class="kb-btn" type="submit">${t("Start clean-up")}</button></form></section></div>`;
    },
    bind(el) {
      el.querySelector("[data-backup]").onclick = async () => {
        try {
          const d = await gql(`mutation($b: Boolean) { backupDatabase(input: { download: false, includeBlobs: $b }) }`, { b: el.querySelector("[data-blobs]").checked });
          toast(t("Backed up") + (d.backupDatabase ? ": " + d.backupDatabase : ""), "ok");
        } catch (e) {
          errorToast(e, "Backup failed");
        }
      };
      el.querySelector("[data-optimise]").onclick = async () => {
        try {
          await gql(`mutation { optimiseDatabase }`);
          pokeJobs();
          toast(t("Optimizing – see Tasks"), "ok");
        } catch (e) {
          errorToast(e, "Optimize");
        }
      };
      el.querySelector("[data-cleangen]").onsubmit = async (e) => {
        e.preventDefault();
        try {
          await gql(`mutation($i: CleanGeneratedInput!) { metadataCleanGenerated(input: $i) }`, { i: readFields(e.target) });
          pokeJobs();
          toast(t("Cleaning up – see Tasks"), "ok");
        } catch (err) {
          errorToast(err, "Clean-up");
        }
      };
    },
  },

  // ---- troubleshooting mode of classic Stash
  trouble: {
    html: (c) => {
      const on = !!c.S.typed.interface.disableCustomizations;
      return row("Troubleshooting mode", "Switches off all plugins, custom CSS, JavaScript and localisation of classic Stash for a while, to find out what causes a problem.",
        on ? `<span class="kb-set-btns"><span class="kb-set-state is-warn">${t("Troubleshooting mode is active - all customizations are disabled")}</span><button type="button" class="kb-btn" data-troubleoff>${t("Exit")}</button></span>` : `<button type="button" class="kb-btn" data-troubleon>${t("Troubleshooting mode")}</button>`);
    },
    bind(el, c) {
      const set = async (on) => {
        try {
          await gql(`mutation($i: ConfigInterfaceInput!) { configureInterface(input: $i) { __typename } }`, { i: { disableCustomizations: on } });
          if (on) await gql(`mutation($i: ConfigGeneralInput!) { configureGeneral(input: $i) { __typename } }`, { i: { logLevel: "Debug" } });
          c.S.typed.interface.disableCustomizations = on;
          saved();
          c.rerender();
        } catch (e) {
          errorToast(e, "Troubleshooting mode");
        }
      };
      const on = el.querySelector("[data-troubleon]");
      if (on)
        on.onclick = async () => {
          const r = await confirmDialog({ title: t("Enable troubleshooting mode"), text: t("This will temporarily disable all customizations to help diagnose issues:") + " " + [t("All plugins"), t("Custom CSS"), t("Custom JavaScript"), t("Custom locales")].join(", ") + ". " + t("Log level will be set to Debug for detailed diagnostics."), ok: t("Enable") });
          if (r.ok) set(true);
        };
      const off = el.querySelector("[data-troubleoff]");
      if (off) off.onclick = () => set(false);
    },
  },

  // ---- backup and restore of this interface
  backup: {
    html: () => row("Backup and restore", "Saves everything this interface remembers – settings of this browser, home page and menu, ratings, playlists, Versus, funscript variants – in one file, and puts it back (also in another browser). It may contain your Handy connection key, so keep the file private.",
      `<span class="kb-set-btns"><button type="button" class="kb-btn" data-bkexport>${t("Save backup")}</button><button type="button" class="kb-btn" data-bkimport>${t("Restore backup")}</button><input type="file" accept=".json,application/json" data-bkfile hidden></span>`),
    bind(el) {
      el.querySelector("[data-bkexport]").onclick = () => exportBackup().catch((e) => errorToast(e, "Backup"));
      el.querySelector("[data-bkimport]").onclick = () => el.querySelector("[data-bkfile]").click();
      el.querySelector("[data-bkfile]").onchange = (e) => {
        const f = e.target.files[0];
        e.target.value = "";
        if (f) importBackup(f);
      };
    },
  },
  reset: {
    html: () => row("Reset interface settings", "Everything this interface remembers in this browser – player and viewer settings, thumbnail size, expanded folders, the home page and more. Not the queue, the colors or the glass look.", `<button type="button" class="kb-btn" data-resetlocal>${t("Reset")}</button>`),
    bind(el) {
      el.querySelector("[data-resetlocal]").onclick = async () => {
        const r = await confirmDialog({ title: t("Reset interface settings?"), text: t("Everything this interface remembers in this browser goes back to the defaults. Your library stays as it is."), ok: t("Reset"), danger: true });
        if (!r.ok) return;
        Object.keys(localStorage).filter((k) => k.startsWith("stashui.") && k !== "stashui.queue" && k !== "stashui.theme" && k !== "stashui.glass").forEach((k) => localStorage.removeItem(k));
        toast(t("Reset"), "ok");
        go("settings/backup-ui", true);
      };
    },
  },

  // ---- versions
  about: {
    html: () => `<div class="kb-set kb-set-col"><div class="kb-about" data-about>${t("Loading …")}</div></div>`,
    bind(el) {
      const box = el.querySelector("[data-about]");
      const dl = (rows) => `<dl class="kb-about-list">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
      (async () => {
        const [v, sys, ui] = await Promise.all([
          gql(`query { version { version hash build_time } }`).then((d) => d.version).catch(() => null),
          gql(`query { systemStatus { os workingDir homeDir configPath databasePath ffmpegPath ffprobePath appSchema databaseSchema } }`).then((d) => d.systemStatus).catch(() => null),
          import("../changelog.js").then((m) => ({ version: m.LATEST })).catch(() => null),
        ]);
        box.innerHTML =
          dl([
            [t("Version"), v ? esc(`${v.version || "?"} (${v.hash})`) : "?"],
            v && [t("Build time:"), esc(v.build_time)],
            ui && ui.version ? ["Stash UI", esc(ui.version)] : null,
            sys && [t("Operating system"), esc(sys.os)],
            sys && sys.workingDir && [t("Working directory"), `<code>${esc(sys.workingDir)}</code>`],
            sys && sys.ffmpegPath && ["FFmpeg", `<code>${esc(sys.ffmpegPath)}</code>`],
            sys && sys.databaseSchema != null && [t("Database schema"), esc(sys.databaseSchema + " / " + sys.appSchema)],
          ]) +
          `<p class="kb-set-btns"><button type="button" class="kb-btn" data-checkver>${t("Check for new version")}</button><span data-newver class="kb-set-msg"></span></p>
           <p class="kb-hint">${t("Stash is made by its community:")} <a href="https://github.com/stashapp/stash" target="_blank" rel="noopener">github.com/stashapp/stash</a> · <a href="https://docs.stashapp.cc" target="_blank" rel="noopener">docs.stashapp.cc</a> · <a href="https://discourse.stashapp.cc" target="_blank" rel="noopener">discourse.stashapp.cc</a></p>`;
        box.querySelector("[data-checkver]").onclick = async (e) => {
          const out = box.querySelector("[data-newver]");
          e.target.disabled = true;
          out.textContent = t("Loading …");
          try {
            const d = (await gql(`query { latestversion { version shorthash release_date url } }`)).latestversion;
            out.innerHTML = `${t("Latest Version")}: <a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.version)}</a> (${esc(d.release_date)})`;
          } catch (err) {
            out.textContent = err.message;
          }
          e.target.disabled = false;
        };
      })();
    },
  },
};
