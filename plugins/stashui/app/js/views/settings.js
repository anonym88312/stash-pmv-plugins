// Settings: every option of Stash plus those of this interface, sorted by topic (the catalog is in setdefs.js).
// Settings Stash stores itself are read live from its schema (so new options after an update show up under "Other Stash options");
// the rest is saved when it is changed. Titles and hints are English texts, translated when shown.

import { applyDisplay } from "../display.js";
import { cardInfo } from "../pieces.js";
import { perfInfo } from "../display.js";
import { forgetLarge } from "../scale.js";
import { esc, icon, toast, errorToast, store, folderMode, ratingSystem, setRatingSystem } from "../ui.js";
import { t, LANGS, chosen, choose } from "../i18n.js";
import { oPrefs, setOPrefs } from "../oclip.js";
import { gql, setPluginConfig, pluginConfig } from "../api.js";
import { typeInfo, selection, fieldHtml, readFields, unwrap, labelOf, helpOf, LABELS } from "../forms.js";
import { mountSlots, slotList, extensionsReady } from "../ext.js";
import { GROUPS, SECTIONS, OTHER, ALIASES, ELSEWHERE } from "./setdefs.js";
import { BLOCKS } from "./setblocks.js";

const AREAS = {
  general: { result: "ConfigGeneralResult", input: "ConfigGeneralInput", mutation: "configureGeneral" },
  interface: { result: "ConfigInterfaceResult", input: "ConfigInterfaceInput", mutation: "configureInterface" },
  dlna: { result: "ConfigDLNAResult", input: "ConfigDLNAInput", mutation: "configureDLNA" },
  scraping: { result: "ConfigScrapingResult", input: "ConfigScrapingInput", mutation: "configureScraping" },
};
// Fields of Stash that never get a row of their own
const SKIP = new Set(["apiKey", "configFilePath", "handyKey", "funscriptOffset", "useStashHostedFunscript", "menuItems", "disableCustomizations"]);
const isTyped = (it) => typeof it === "string" || (it && it.k === undefined && it.f);
const typedPath = (it) => (typeof it === "string" ? it : it.f);

// ---------- what is loaded for the page ----------
const S = { typed: {}, ui: {}, defaults: {}, plugin: {} };
async function loadConfig() {
  const areas = await Promise.all(
    Object.entries(AREAS).map(async ([a, d]) => {
      try {
        return [a, await selection(d.result)];
      } catch (e) {
        return [a, ""];
      }
    })
  );
  const sel = areas.filter(([, s]) => s).map(([a, s]) => `${a} { ${s} }`).join(" ");
  const [cfg, plugin] = await Promise.all([
    gql(`query { configuration { ${sel} ui defaults { deleteFile deleteGenerated } } }`),
    pluginConfig("stashui").catch(() => ({})),
  ]);
  S.typed = {};
  for (const a of Object.keys(AREAS)) S.typed[a] = cfg.configuration[a] || {};
  S.ui = cfg.configuration.ui || {};
  S.defaults = cfg.configuration.defaults || {};
  S.plugin = plugin || {};
}

// "interface.imageLightbox.slideshowDelay" → its input type, current value, parent path
const inputCache = new Map();
async function inputOf(area) {
  if (!inputCache.has(area)) inputCache.set(area, typeInfo(AREAS[area].input).catch(() => null));
  return inputCache.get(area);
}
async function resolveTyped(path) {
  const [area, ...rest] = path.split(".");
  if (!AREAS[area]) return null;
  let ti = await inputOf(area);
  if (!ti) return null;
  let cur = S.typed[area];
  let field = null;
  for (let i = 0; i < rest.length; i++) {
    field = (ti.inputFields || []).find((f) => f.name === rest[i]);
    if (!field) return null;
    cur = cur ? cur[rest[i]] : undefined;
    if (i < rest.length - 1) {
      const u = unwrap(field.type);
      if (u.kind !== "INPUT_OBJECT") return null;
      ti = await typeInfo(u.named);
    }
  }
  return { area, name: rest[rest.length - 1], parent: rest.slice(0, -1).join("."), type: field.type, value: cur };
}

// fields that Stash stores but the catalog does not list → section "Other Stash options"
let otherNames = null;
async function computeOther() {
  const placed = new Set();
  for (const s of SECTIONS) for (const it of [...s.items, ...(s.classic || [])]) if (isTyped(it)) placed.add(typedPath(it));
  for (const s of SECTIONS) for (const it of [...s.items, ...(s.classic || [])]) if (it.k === "tgroup") it.f.forEach(([p]) => placed.add(p));
  const out = [];
  for (const area of Object.keys(AREAS)) {
    const ti = await inputOf(area);
    for (const f of (ti && ti.inputFields) || []) {
      if (SKIP.has(f.name)) continue;
      if ([...placed].some((p) => p === `${area}.${f.name}` || p.startsWith(`${area}.${f.name}.`))) continue;
      out.push(`${area}.${f.name}`);
    }
  }
  return (otherNames = out);
}

// ---------- sections of extension plugins (slot settings.section) ----------
const extSections = () => slotList("settings.section").map((s) => ({ id: "x:" + s.plugin + ":" + s.id, group: "plugins", title: s.title || s.plugin, intro: "", ext: true, slot: s, items: [] }));
const allSections = () => {
  const list = SECTIONS.slice();
  if (otherNames && otherNames.length) list.push(Object.assign({}, OTHER, { items: otherNames }));
  const x = extSections();
  if (!x.length) return list;
  const i = list.findIndex((s) => s.group === "more");
  return list.slice(0, i < 0 ? list.length : i).concat(x, i < 0 ? [] : list.slice(i));
};
const groupsOf = (list) => {
  const g = GROUPS.slice();
  if (list.some((s) => s.ext)) g.splice(g.findIndex((x) => x.id === "more"), 0, { id: "plugins", title: "Plugins", intro: "" });
  return g;
};

// ---------- values of the instant settings ----------
const BASES = { cardInfo, perfInfo, player: () => store.get("player", {}) };
const baseOf = (key) => (BASES[key] || (() => store.get(key, {})))();
const dig = (o, path) => path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
const RATE_NOW = () => {
  const r = ratingSystem();
  return r.type === "decimal" ? "decimal:" : "stars:" + ({ 0.5: "half", 0.25: "quarter", 0.1: "tenth" }[r.step] || "full");
};
const FN = {
  lang: { get: () => chosen(), set: (v) => (choose(v), location.reload()) },
  ratesys: {
    get: RATE_NOW,
    async set(v) {
      const [type, starPrecision] = v.split(":");
      const opts = type === "decimal" ? { type: "decimal", starPrecision: "full" } : { type: "stars", starPrecision };
      await gql(`mutation($p: Map) { configureUI(partial: $p) }`, { p: { ratingSystemOptions: opts } });
      setRatingSystem(opts);
      S.ui.ratingSystemOptions = opts;
    },
  },
  foldermode: {
    get: () => folderMode(),
    set(v) {
      store.set("folderMode", v);
      sessionStorage.removeItem("stashui.foldersOnce");
      location.reload(); // the navigation is built once – rebuild it with or without folders
    },
  },
  pmode: {
    get() {
      const p = store.get("player", {});
      return p.mode || (p.loop ? "one" : p.random ? "shuffle" : p.auto === false ? "stop" : "order");
    },
    set: (v) => store.set("player", Object.assign(store.get("player", {}), { mode: v })),
  },
  omark: { get: () => oPrefs().mark !== false, set: (v) => setOPrefs({ mark: v }) },
  oshow: { get: () => oPrefs().show !== false, set: (v) => setOPrefs({ show: v }) },
  vanim: { get: () => store.get("viewer", {}).anim || "fade", set: (v) => store.set("viewer", Object.assign(store.get("viewer", { panel: false, interval: 5 }), { anim: v })) },
};

function getValue(it) {
  const s = it.src;
  switch (s.t) {
    case "local": return store.get(s.key, s.def);
    case "obj": { const v = baseOf(s.key)[s.path]; return v === undefined ? s.def : v; }
    case "flags": return baseOf(s.key);
    case "ui": { const v = dig(S.ui, s.key); return v === undefined || v === null ? s.def : v; }
    case "plugin": { const v = S.plugin[s.key]; const x = v === undefined ? s.def : v; return s.inv ? !x : x; }
    case "defaults": { const v = S.defaults[s.key]; return v === undefined || v === null ? s.def : v; }
    case "fn": return FN[s.id].get();
  }
}
async function setValue(it, v) {
  const s = it.src;
  switch (s.t) {
    case "local":
      store.set(s.key, v);
      if (s.key === "largeMode") forgetLarge();
      applyDisplay();
      window.dispatchEvent(new Event("stash:display-changed"));
      break;
    case "obj": store.set(s.key, Object.assign(baseOf(s.key), { [s.path]: v })); break;
    case "flags": store.set(s.key, Object.assign(baseOf(s.key), v)); break;
    case "ui": {
      const parts = s.key.split(".");
      const partial = {};
      if (parts.length === 1) partial[parts[0]] = v;
      else partial[parts[0]] = Object.assign({}, S.ui[parts[0]] || {}, { [parts[1]]: v });
      await gql(`mutation($p: Map) { configureUI(partial: $p) }`, { p: partial });
      S.ui = Object.assign({}, S.ui, partial);
      break;
    }
    case "plugin": {
      const stored = s.inv ? !v : v;
      await setPluginConfig("stashui", { [s.key]: stored });
      S.plugin[s.key] = stored;
      if (it.mirror) localStorage.setItem("stashui." + it.mirror, String(stored));
      break;
    }
    case "defaults":
      await gql(`mutation($i: ConfigDefaultSettingsInput!) { configureDefaults(input: $i) { __typename } }`, { i: { [s.key]: v } });
      S.defaults[s.key] = v;
      break;
    case "fn": await FN[s.id].set(v); break;
  }
}

// ---------- rows ----------
const sid = (sec, it) => `${sec.id}.${it.id || typedPath(it)}`;
const labelHtml = (title, hint) => `<span class="kb-set-label"><b>${esc(t(title))}</b>${hint ? `<small>${esc(t(hint))}</small>` : ""}</span>`;
const later = (it) => (it.later ? ` ${t("Takes effect when a list is loaded again.")}` : "");
const hintOf = (it) => (it.hint ? t(it.hint) + later(it) : "");
const labelFull = (it) => `<span class="kb-set-label"><b>${esc(t(it.title))}</b>${it.hint ? `<small>${esc(hintOf(it))}</small>` : ""}</span>`;

function optionsOf(it) {
  const list = it.options === "langs" ? [["auto", "Automatic"], ...LANGS.map(([c, n]) => [c, n])] : it.options;
  return list.map(([v, l]) => [v, it.options === "langs" && v !== "auto" ? l : t(l)]);
}

async function rowHtml(sec, it, idx, ctx) {
  const id = `data-sid="${esc(sid(sec, it))}"`;
  if (isTyped(it)) return typedRow(sec, it, id, ctx);
  switch (it.k) {
    case "heading": return `<h3 class="kb-set-heading">${esc(t(it.title))}</h3>${it.hint ? `<p class="kb-hint kb-set-headhint">${esc(t(it.hint))}</p>` : ""}`;
    case "info": return `<div class="kb-set kb-set-info" ${id}>${labelFull(it)}</div>`;
    case "link": return `<div class="kb-set" ${id}>${labelFull(it)}<a class="kb-btn" href="${esc(it.href)}">${t(it.btn || "Open")}</a></div>`;
    case "block": {
      const b = BLOCKS[it.block];
      const html = await b.html(ctx);
      return `<div class="kb-block" ${id} data-block="${it.block}">${html}</div>`;
    }
    case "switch": return `<label class="kb-set kb-set-bool" ${id}>${labelFull(it)}<span class="kb-switch"><input type="checkbox" data-i="${idx}"${getValue(it) ? " checked" : ""}><i></i></span></label>`;
    case "select": {
      const cur = String(getValue(it));
      const opts = optionsOf(it);
      return `<label class="kb-set" ${id}>${labelFull(it)}<select class="kb-field" data-i="${idx}">${opts.some(([v]) => String(v) === cur) ? "" : `<option value="${esc(cur)}">${esc(cur)}</option>`}${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === cur ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
    }
    case "range": return `<label class="kb-set" ${id}>${labelFull(it)}<input type="range" min="${it.min}" max="${it.max}" step="${it.step || 1}" data-i="${idx}" value="${esc(getValue(it))}"></label>`;
    case "number": return `<label class="kb-set" ${id}>${labelFull(it)}<span class="kb-set-unit"><input class="kb-field kb-num" type="number" min="${it.min ?? ""}" max="${it.max ?? ""}" data-i="${idx}" value="${esc(getValue(it))}">${it.unit ? `<i>${esc(it.unit)}</i>` : ""}</span></label>`;
    case "text": return `<label class="kb-set" ${id}>${labelFull(it)}<input class="kb-field" type="text" data-i="${idx}" value="${esc(getValue(it) || "")}" placeholder="${esc(it.placeholder || "")}"${it.max ? ` maxlength="${it.max}"` : ""} spellcheck="false" autocomplete="off"></label>`;
    case "chips": {
      const on = getValue(it);
      return `<div class="kb-set" ${id}>${labelFull(it)}<div class="kb-chips" data-chips="${idx}">${it.options.map(([k, l]) => `<button type="button" class="kb-chip${on[k] ? " is-on" : ""}" data-ck="${k}">${esc(t(l))}</button>`).join("")}</div></div>`;
    }
    case "uigroup":
      return `<div class="kb-set kb-set-ext" ${id}>${labelFull(it)}<div class="kb-checks">${it.items.map(([k, l]) => `<label class="kb-check"><input type="checkbox" data-ug="${k}"${S.ui[k] ? " checked" : ""}>${esc(t(l))}</label>`).join("")}</div></div>`;
    case "tgroup": {
      const rows = await Promise.all(it.f.map(async ([p, l]) => ({ r: await resolveTyped(p), l })));
      if (!rows.some((x) => x.r)) return "";
      return `<div class="kb-set kb-set-ext" data-typed data-area="${esc(rows.find((x) => x.r).r.area)}" ${id}>${labelFull(it)}<div class="kb-checks">${rows
        .filter((x) => x.r)
        .map(({ r, l }) => `<label class="kb-check"><input type="checkbox" data-field="${esc(r.parent ? r.parent + "." + r.name : r.name)}" data-t="bool"${r.value ? " checked" : ""}>${esc(t(l))}</label>`)
        .join("")}</div></div>`;
    }
  }
  return "";
}

// ---- typed rows (a field of Stash's own configuration)
async function typedRow(sec, it, id, ctx) {
  const path = typedPath(it);
  const r = await resolveTyped(path);
  if (!r) return "";
  const meta = typeof it === "string" ? null : { label: it.title, help: it.hint };
  let inner;
  if (path === "general.stashes") inner = stashesHtml(r.value || []);
  else if (LIST_EDITORS[r.name]) inner = listEditorHtml(r.name, r.value || []);
  else inner = await fieldHtml(r.name, r.type, r.value, r.parent, meta);
  return `<div data-typed data-area="${r.area}" data-lf="${esc(r.name)}" ${id}>${inner}</div>`;
}

// ---- library folders and the other lists of objects
function stashRow(s) {
  return `<div class="kb-stash-row" data-stash>
    <input class="kb-field" data-spath value="${esc(s.path || "")}" placeholder="${t("Folder path")}" spellcheck="false">
    <label class="kb-check"><input type="checkbox" data-snovid${s.excludeVideo ? " checked" : ""}>${t("no videos")}</label>
    <label class="kb-check"><input type="checkbox" data-snoimg${s.excludeImage ? " checked" : ""}>${t("no images")}</label>
    <button type="button" class="kb-btn is-icon is-ghost" data-srm aria-label="${t("Remove folder")}">${icon("close")}</button>
  </div>`;
}
const stashesHtml = (list) => `<div class="kb-set kb-set-col"><div class="kb-set-label"><b>${t("Library folders")}</b><small>${t("Folders Stash scans. “no videos/images” ignores that kind of media in the folder.")}</small></div>
    <div class="kb-stashes" data-stashes>${list.map(stashRow).join("")}</div>
    <button type="button" class="kb-btn" data-sadd>${icon("plus")}${t("Add folder")}</button></div>`;
const readStashes = (root) =>
  [...root.querySelectorAll("[data-stash]")]
    .map((r) => ({ path: r.querySelector("[data-spath]").value.trim(), excludeVideo: r.querySelector("[data-snovid]").checked, excludeImage: r.querySelector("[data-snoimg]").checked }))
    .filter((s) => s.path);

// generic editor for lists of objects: columns [key, label, kind, placeholder]
const LIST_EDITORS = {
  stashBoxes: { add: "Add stash-box instance", cols: [["name", "Name", "text", "StashDB"], ["endpoint", "GraphQL endpoint", "text", "https://stashdb.org/graphql"], ["api_key", "API key", "password", ""], ["max_requests_per_minute", "Max requests per minute", "number", "240"]], req: ["endpoint"] },
  scraperPackageSources: { add: "Add source", cols: [["name", "Name", "text", ""], ["url", "URL", "text", "https://…/index.yml"], ["local_path", "Local path", "text", ""]], req: ["url"] },
  pluginPackageSources: { add: "Add source", cols: [["name", "Name", "text", ""], ["url", "URL", "text", "https://…/index.yml"], ["local_path", "Local path", "text", ""]], req: ["url"] },
};
function listRow(ed, o) {
  return `<div class="kb-lrow" data-lrow>${ed.cols
    .map(([k, label, kind, ph]) => `<label class="kb-lcell"><span>${esc(t(label))}</span><input class="kb-field" data-lk="${k}" type="${kind}" value="${esc(o[k] == null ? "" : o[k])}" placeholder="${esc(ph)}" spellcheck="false" autocomplete="off"></label>`)
    .join("")}<button type="button" class="kb-btn is-icon is-ghost" data-lrm aria-label="${t("Remove")}">${icon("close")}</button></div>`;
}
const listEditorHtml = (name, list) => `<div class="kb-set kb-set-col"><div class="kb-llist" data-llist="${name}">${list.map((o) => listRow(LIST_EDITORS[name], o)).join("") || ""}</div>
  <button type="button" class="kb-btn" data-ladd="${name}">${icon("plus")}${t(LIST_EDITORS[name].add)}</button></div>`;
function readList(root, name) {
  const ed = LIST_EDITORS[name];
  return [...root.querySelectorAll("[data-lrow]")]
    .map((r) => {
      const o = {};
      for (const [k, , kind] of ed.cols) {
        const v = r.querySelector(`[data-lk="${k}"]`).value.trim();
        o[k] = kind === "number" ? (v === "" ? 0 : parseInt(v, 10) || 0) : v;
      }
      if (name !== "stashBoxes") for (const k of ["name", "local_path"]) if (!o[k]) o[k] = null;
      return o;
    })
    .filter((o) => ed.req.every((k) => o[k]));
}

// ---------- the page ----------
export async function render(main, params, query = {}) {
  if (String(params.section || "").startsWith("x:")) await Promise.race([extensionsReady(), new Promise((r) => setTimeout(r, 1500))]);
  await computeOther().catch(() => (otherNames = []));
  let ALL = allSections();
  let secId = ALIASES[params.section] || params.section || "overview";
  // old links with ?find= land in the section that has the setting now
  if (query.find) {
    const hits = (await getIndex()).filter((e) => e.sid === query.find || e.label === query.find);
    if (hits.length && !hits.some((h) => h.sec.id === secId)) secId = hits[0].sec.id;
  }
  const sec = secId === "overview" ? null : ALL.find((s) => s.id === secId) || null;
  const groups = groupsOf(ALL);
  const group = sec ? groups.find((g) => g.id === sec.group) : null;
  const pick = `<select class="kb-field kb-set-pick" data-secpick aria-label="${t("Sections")}"><option value="">${t("Overview")}</option>${groups
    .map((g) => `<optgroup label="${esc(t(g.title))}">${ALL.filter((s) => s.group === g.id).map((s) => `<option value="${s.id}"${sec && s.id === sec.id ? " selected" : ""}>${esc(t(s.title))}</option>`).join("")}</optgroup>`)
    .join("")}</select>`;
  main.innerHTML = `
    <header class="kb-head"><div class="kb-head-title">
      <nav class="kb-crumbs"><span><a href="#/settings">${t("Settings")}</a></span>${group ? `<span>${esc(t(group.title))}</span>` : ""}</nav>
      <h1 class="kb-h1">${esc(sec ? t(sec.title) : t("Settings"))}</h1>
      <p class="kb-sub">${esc(sec ? t(sec.intro) : t("Everything in one place – pick a topic or search."))}</p>
    </div></header>
    <div class="kb-settings">
      <nav class="kb-set-nav" aria-label="${t("Sections")}">
        <label class="kb-search kb-set-search">${icon("search")}<input class="kb-field" type="search" data-setq placeholder="${t("Search settings")}" autocomplete="off"></label>
        <div class="kb-set-results" data-setres hidden></div>
        ${pick}
        <a href="#/settings" class="kb-set-ov${sec ? "" : " is-active"}">${t("Overview")}</a>
        ${groups.map((g) => `<div class="kb-set-navgroup">${esc(t(g.title))}</div>${ALL.filter((s) => s.group === g.id).map((s) => `<a href="#/settings/${s.id}" class="${sec && s.id === sec.id ? "is-active" : ""}">${esc(t(s.title))}</a>`).join("")}`).join("")}
        <a href="#/extern/classic-settings">${t("Open in classic Stash")}</a></nav>
      <div class="kb-set-body" data-body><div class="kb-loading">${t("Loading …")}</div></div>
    </div>`;
  const body = main.querySelector("[data-body]");
  bindNav(main, groups);
  let cleanups = [];
  let extHandle = null;
  try {
    if (!sec) await renderOverview(body, groups, ALL);
    else if (sec.ext) {
      body.innerHTML = "";
      extHandle = mountSlots("settings.section", body, { page: "settings" }, { only: (s) => s === sec.slot });
    } else cleanups = await renderSection(body, sec, () => render(main, params, query));
    if (query.find) showFound(body, query.find);
  } catch (e) {
    body.innerHTML = `<div class="kb-empty"><b>${t("Couldn't load settings")}</b><p>${esc(e.message)}</p></div>`;
  }
  return () => {
    extHandle && extHandle.destroy();
    cleanups.forEach((c) => typeof c === "function" && c());
  };
}

// ---------- overview ----------
async function renderOverview(body, groups, ALL) {
  body.innerHTML = `<div class="kb-set-ovgrid">${groups
    .map(
      (g) => `<section class="kb-card kb-set-ovcard"><h2>${esc(t(g.title))}</h2>${g.intro ? `<p>${esc(t(g.intro))}</p>` : ""}
      <ul>${ALL.filter((s) => s.group === g.id).map((s) => `<li><a href="#/settings/${s.id}"><b>${esc(t(s.title))}</b>${s.intro ? `<small>${esc(t(s.intro))}</small>` : ""}</a></li>`).join("")}</ul></section>`
    )
    .join("")}
    <section class="kb-card kb-set-ovcard"><h2>${t("Somewhere else")}</h2><p>${t("Not in Settings, but you may be looking for them:")}</p>
      <ul>${ELSEWHERE.map((e) => `<li><a href="${e.href}"><b>${esc(t(e.title))}</b><small>${esc(t(e.hint))}</small></a></li>`).join("")}</ul></section></div>`;
}

// ---------- one section ----------
async function renderSection(body, sec, rerender) {
  await loadConfig();
  const items = sec.items;
  const classic = sec.classic || [];
  const all = [...items, ...classic];
  const ctx = { S, rerender };
  const parts = [];
  for (let i = 0; i < items.length; i++) parts.push(await rowHtml(sec, items[i], i, ctx));
  const cparts = [];
  for (let i = 0; i < classic.length; i++) cparts.push(await rowHtml(sec, classic[i], items.length + i, ctx));
  const cshown = cparts.filter(Boolean).length;
  body.innerHTML = `<div class="kb-set-form" data-form>${parts.join("")}
    ${cshown ? `<details class="kb-set-classic" data-classic><summary><span>${t("Only for classic Stash")}</span><em>${cshown}</em></summary><p class="kb-hint">${t("These options change classic Stash (the original interface), not this one. They are here so that nothing of Stash's settings is missing.")}</p>${cparts.join("")}</details>` : ""}
    <div class="kb-set-save" data-save hidden><span>${t("Unsaved changes")}</span><button type="button" class="kb-btn" data-reset>${t("Discard")}</button><button type="button" class="kb-btn is-primary" data-dosave>${t("Save")}</button></div></div>`;
  if (!parts.join("").trim() && !cshown) body.insertAdjacentHTML("afterbegin", `<p class="kb-hint">${t("Nothing else to set here.")}</p>`);
  const form = body.querySelector("[data-form]");
  const saveBar = body.querySelector("[data-save]");
  const dirty = () => (saveBar.hidden = false);

  // instant settings
  const itemOf = (el) => all[Number(el.dataset.i)];
  const done = (it, r) => Promise.resolve(r).then(() => toast(t("Saved"), "ok"), (err) => errorToast(err, it.title));
  form.addEventListener("change", (e) => {
    const el = e.target.closest("[data-i]");
    if (el) {
      const it = itemOf(el);
      let v = el.type === "checkbox" ? el.checked : el.type === "range" || el.type === "number" ? Number(el.value) : el.value;
      if (el.type === "number" && el.value === "") v = it.src.def;
      if (it.k === "select" && typeof it.src.def === "boolean") v = v === "true";
      return void done(it, setValue(it, v));
    }
    const ug = e.target.closest("[data-ug]");
    if (ug) return void done({ title: "Enable background image" }, setValue({ src: { t: "ui", key: ug.dataset.ug } }, ug.checked));
    if (e.target.closest("[data-typed]")) dirty();
  });
  form.addEventListener("input", (e) => {
    const el = e.target.closest("[data-i]");
    if (el && el.type === "range") {
      const it = itemOf(el);
      if (it.src.t === "local") setValue(it, Number(el.value));
    } else if (e.target.closest("[data-typed]")) dirty();
  });
  form.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-ck]");
    if (chip) {
      const it = all[Number(chip.closest("[data-chips]").dataset.chips)];
      chip.classList.toggle("is-on");
      return void done(it, setValue(it, { [chip.dataset.ck]: chip.classList.contains("is-on") }));
    }
    if (e.target.closest("[data-sadd]")) {
      form.querySelector("[data-stashes]").insertAdjacentHTML("beforeend", stashRow({}));
      return dirty();
    }
    const rm = e.target.closest("[data-srm]");
    if (rm) {
      rm.closest("[data-stash]").remove();
      return dirty();
    }
    const la = e.target.closest("[data-ladd]");
    if (la) {
      form.querySelector(`[data-llist="${la.dataset.ladd}"]`).insertAdjacentHTML("beforeend", listRow(LIST_EDITORS[la.dataset.ladd], {}));
      return dirty();
    }
    const lr = e.target.closest("[data-lrm]");
    if (lr) {
      lr.closest("[data-lrow]").remove();
      return dirty();
    }
  });

  // typed settings: one mutation per area
  body.querySelector("[data-reset]").onclick = () => rerender();
  body.querySelector("[data-dosave]").onclick = async () => {
    const inputs = {};
    for (const rowEl of form.querySelectorAll("[data-typed]")) {
      const area = rowEl.dataset.area;
      const o = (inputs[area] = inputs[area] || {});
      const name = rowEl.dataset.lf;
      if (rowEl.querySelector("[data-stashes]")) o.stashes = readStashes(rowEl);
      else if (LIST_EDITORS[name] && rowEl.querySelector("[data-llist]")) o[name] = readList(rowEl, name);
      else {
        const v = readFields(rowEl);
        for (const [k, val] of Object.entries(v)) o[k] = val && typeof val === "object" && !Array.isArray(val) ? Object.assign(o[k] || {}, val) : val;
      }
    }
    // nested objects go whole: what the page did not touch keeps its value
    for (const [area, o] of Object.entries(inputs))
      for (const [k, val] of Object.entries(o)) if (val && typeof val === "object" && !Array.isArray(val) && S.typed[area]) o[k] = Object.assign({}, S.typed[area][k] || {}, val);
    try {
      for (const [area, o] of Object.entries(inputs)) {
        if (!Object.keys(o).length) continue;
        await gql(`mutation($i: ${AREAS[area].input}!) { ${AREAS[area].mutation}(input: $i) { __typename } }`, { i: o });
      }
      toast(sec.id === "paths" ? t("Saved – takes effect after restarting Stash") : t("Saved"), "ok");
      saveBar.hidden = true;
      await loadConfig();
    } catch (err) {
      errorToast(err, "Saving failed");
    }
  };

  // hand-made blocks
  const cleanups = [];
  const bctx = Object.assign({ rerender }, ctx);
  body.querySelectorAll("[data-block]").forEach((el) => {
    const b = BLOCKS[el.dataset.block];
    if (b.bind) cleanups.push(b.bind(el, bctx));
  });
  return cleanups;
}

// ---------- navigation, search ----------
function bindNav(main, groups) {
  main.querySelector("[data-secpick]").onchange = (e) => (location.hash = "#/settings" + (e.target.value ? "/" + e.target.value : ""));
  const q = main.querySelector("[data-setq]");
  const box = main.querySelector("[data-setres]");
  let seq = 0;
  q.addEventListener("input", async () => {
    const my = ++seq;
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return (box.hidden = true);
    const idx = await getIndex();
    if (my !== seq) return;
    const hits = idx.filter((e) => words.every((w) => e.hay.includes(w))).slice(0, 14);
    box.hidden = false;
    box.innerHTML = hits.length
      ? hits.map((h) => `<a href="#/settings/${h.sec.id}?find=${encodeURIComponent(h.sid)}"><b>${esc(h.label)}</b><small>${esc(h.isSec ? t((groups.find((g) => g.id === h.sec.group) || {}).title || "") : t(h.sec.title))}${h.classic ? " · " + esc(t("Only for classic Stash")) : ""}</small></a>`).join("")
      : `<p class="kb-hint">${t("Nothing found")}</p>`;
  });
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const a = box.querySelector("a");
      if (a) location.hash = a.getAttribute("href");
    } else if (e.key === "Escape") {
      q.value = "";
      box.hidden = true;
    }
  });
}

let indexP = null;
function getIndex() {
  return (indexP = indexP || buildIndex());
}
window.addEventListener("stash:plugins-changed", () => (indexP = null));
async function buildIndex() {
  const out = [];
  const add = (sec, sidv, label, hint, classic) => out.push({ sec, sid: sidv, label, classic, isSec: sidv === sec.id, hay: (label + " " + (hint || "") + " " + t(sec.title)).toLowerCase() });
  if (!otherNames) await computeOther().catch(() => (otherNames = []));
  for (const sec of allSections()) {
    add(sec, sec.id, t(sec.title), t(sec.intro) + " " + (sec.alias || ""));
    const each = (list, classic) =>
      list.forEach((it) => {
        if (isTyped(it)) {
          const p = typedPath(it);
          const name = p.split(".").pop();
          add(sec, `${sec.id}.${p}`, it.title ? t(it.title) : p === "general.stashes" ? t("Library folders") : labelOf(name), it.hint ? t(it.hint) : helpOf(name), classic);
        } else if (it.k === "heading") return;
        else {
          add(sec, `${sec.id}.${it.id}`, t(it.title), [it.hint && t(it.hint), ...(it.terms || []).map(t)].filter(Boolean).join(" "), classic);
          (it.terms || []).forEach((x) => add(sec, `${sec.id}.${it.id}`, t(x), "", classic));
          (it.items || []).forEach(([, l]) => add(sec, `${sec.id}.${it.id}`, t(l), t(it.title), classic));
          (it.f || []).forEach(([, l]) => add(sec, `${sec.id}.${it.id}`, t(l), t(it.title), classic));
          (it.options && Array.isArray(it.options) ? it.options : []).forEach(([, l]) => add(sec, `${sec.id}.${it.id}`, t(l), t(it.title), classic));
        }
      });
    each(sec.items.filter((x) => x), false);
    each(sec.classic || [], true);
  }
  return out;
}

// Scroll to the setting that was picked in the search and let it light up
function showFound(body, find) {
  let el = body.querySelector(`[data-sid="${CSS.escape(find)}"]`);
  if (!el) {
    // a title (older links): the row whose heading says so
    const b = [...body.querySelectorAll("b, h2, h3")].find((x) => x.textContent.trim() === find);
    el = b && (b.closest("[data-sid]") || b.closest(".kb-set, .kb-card") || b);
  }
  if (!el) return;
  const det = el.closest("details");
  if (det) det.open = true;
  el.scrollIntoView({ block: "center" });
  el.classList.add("is-found");
  setTimeout(() => el.classList.remove("is-found"), 2400);
}
