// Under a performer's header: "Statistics" (what the library holds of them – scenes per year, watch time, rating,
// tags, co-performers, studios, resolutions, most watched …) and "Missing scenes" (the Discover tab of stashDiscover,
// vendor/stashdiscover, mounted by ssdpage.js). Also the helpers Discover shares: stash-box ids / performers of the library,
// the window for a scene the library lacks, lazy cover pictures.

import { esc, icon, fmtNum, fmtBytes, fmtDuration, fmtDate, ratingText, mountOverlay } from "../ui.js";
import { t } from "../i18n.js";
import { gql } from "../api.js";
import { runBackend } from "../interactive.js";

const SCENES = `query PerfStats($s: SceneFilterType) {
  findScenes(filter: { per_page: -1 }, scene_filter: $s) {
    scenes {
      id title date rating100 play_count o_counter play_duration interactive
      files { basename duration size height }
      tags { id name }
      performers { id name }
      studio { id name }
    }
  }
}`;

const cache = new Map(); // performer id → scenes (a click on the other button needn't ask again)
async function loadScenes(id) {
  if (cache.has(id)) return cache.get(id);
  const d = await gql(SCENES, { s: { performers: { value: [id], modifier: "INCLUDES" } } }, { heavy: true });
  const list = d.findScenes.scenes || [];
  cache.set(id, list);
  return list;
}

function fmtDur(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return t("{n} s", { n: sec });
  const m = Math.round(sec / 60);
  if (m < 60) return t("{n} min", { n: m });
  const h = Math.floor(m / 60);
  return m % 60 && h < 10 ? t("{h} h {m} min", { h, m: m % 60 }) : t("{n} h", { n: fmtNum(Math.round(sec / 3600)) });
}
const resOf = (h) => (!h ? "" : h >= 2160 ? "4K" : h >= 1440 ? "1440p" : h >= 1080 ? "1080p" : h >= 720 ? "720p" : h >= 480 ? "480p" : "SD");
const RES_ORDER = ["4K", "1440p", "1080p", "720p", "480p", "SD"];

// name → {name, n} counted over a list of [id, name]
function tally(pairs) {
  const m = new Map();
  for (const [id, name] of pairs) {
    const e = m.get(id) || { id, name, n: 0 };
    e.n++;
    m.set(id, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

function listBlock(title, rows, href, max = 10) {
  if (!rows.length) return "";
  const top = rows[0].n;
  return `<section class="kb-pst-box"><h4>${esc(title)}</h4><ul class="kb-pst-list">${rows
    .slice(0, max)
    .map((r) => `<li><a href="${href(r)}" title="${esc(r.name)}"><span>${esc(r.name)}</span><i style="--w:${Math.max(4, (r.n / top) * 100)}%"></i><b>${r.n}</b></a></li>`)
    .join("")}</ul></section>`;
}

async function showStats(host, p) {
  host.innerHTML = `<p class="kb-pst-wait">${t("Counting …")}</p>`;
  const list = await loadScenes(p.id);
  if (!list.length) {
    host.innerHTML = `<p class="kb-pst-wait">${t("No scenes with this performer in the library yet.")}</p>`;
    return;
  }
  const n = list.length;
  const watched = list.filter((s) => s.play_count > 0).length;
  const plays = list.reduce((a, s) => a + (s.play_count || 0), 0);
  const o = list.reduce((a, s) => a + (s.o_counter || 0), 0);
  const watchSec = list.reduce((a, s) => a + (s.play_duration || 0), 0);
  const lenSec = list.reduce((a, s) => a + ((s.files[0] && s.files[0].duration) || 0), 0);
  const size = list.reduce((a, s) => a + s.files.reduce((b, f) => b + (f.size || 0), 0), 0);
  const rated = list.filter((s) => s.rating100 > 0);
  const avg = rated.length ? rated.reduce((a, s) => a + s.rating100, 0) / rated.length : 0;
  const funs = list.filter((s) => s.interactive).length;
  const dates = list.map((s) => s.date).filter(Boolean).sort();
  const years = new Map();
  for (const d of dates) years.set(d.slice(0, 4), (years.get(d.slice(0, 4)) || 0) + 1);
  const yearRows = [...years.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const yTop = Math.max(1, ...yearRows.map(([, c]) => c));
  const resCount = new Map();
  for (const s of list) {
    const r = resOf(s.files[0] && s.files[0].height);
    if (r) resCount.set(r, (resCount.get(r) || 0) + 1);
  }
  const tagRows = tally(list.flatMap((s) => s.tags.map((g) => [g.id, g.name])));
  const coRows = tally(list.flatMap((s) => s.performers.filter((q) => q.id !== p.id).map((q) => [q.id, q.name])));
  const stuRows = tally(list.filter((s) => s.studio).map((s) => [s.studio.id, s.studio.name]));
  const titleOf = (s) => s.title || (s.files[0] && s.files[0].basename) || "#" + s.id;
  const most = list.filter((s) => s.play_count > 0).sort((a, b) => b.play_count - a.play_count).slice(0, 5);
  const best = rated.slice().sort((a, b) => b.rating100 - a.rating100).slice(0, 5);
  const tile = (v, label, sub) => `<div class="kb-pst-tile"><b>${v}</b><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
  const sceneRows = (rows, val) => `<ul class="kb-pst-scenes">${rows.map((s) => `<li><a href="#/scene/${s.id}"><span>${esc(titleOf(s))}</span><b>${val(s)}</b></a></li>`).join("")}</ul>`;
  host.innerHTML = `
    <div class="kb-pst-tiles">
      ${tile(fmtNum(n), t("Scenes"), dates.length ? `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}` : "")}
      ${tile(fmtNum(watched), t("Scenes watched"), `${Math.round((watched / n) * 100)} % · ${t("{n} not yet", { n: n - watched })}`)}
      ${tile(fmtNum(plays), t("Plays"), o ? t("{n} × O", { n: fmtNum(o) }) : "")}
      ${tile(fmtDur(watchSec), t("Watch time"), "")}
      ${tile(fmtDur(lenSec), t("Total length"), fmtBytes(size))}
      ${tile(avg ? esc(ratingText(Math.round(avg))) : "–", t("Average rating"), rated.length ? t("{n} rated", { n: rated.length }) : "")}
      ${funs ? tile(fmtNum(funs), t("With funscript"), `${Math.round((funs / n) * 100)} %`) : ""}
    </div>
    <div class="kb-pst-cols">
      ${yearRows.length ? `<section class="kb-pst-box"><h4>${t("Scenes per year")}</h4><ul class="kb-pst-years">${yearRows.map(([y, c]) => `<li><span>${esc(y)}</span><i style="--w:${Math.max(3, (c / yTop) * 100)}%"></i><b>${c}</b></li>`).join("")}</ul>${dates.length < n ? `<p class="kb-pst-note">${t("{n} scenes have no date.", { n: n - dates.length })}</p>` : ""}</section>` : ""}
      ${listBlock(t("Top tags"), tagRows, (r) => `#/tag/${r.id}`)}
      ${listBlock(t("Often together with"), coRows, (r) => `#/performer/${r.id}`)}
      ${listBlock(t("Studios"), stuRows, (r) => `#/studio/${r.id}`, 8)}
      ${resCount.size ? `<section class="kb-pst-box"><h4>${t("Resolutions")}</h4><ul class="kb-pst-list">${RES_ORDER.filter((r) => resCount.has(r)).map((r) => `<li><span class="kb-pst-plain"><span>${r}</span><i style="--w:${Math.max(4, (resCount.get(r) / n) * 100)}%"></i><b>${resCount.get(r)}</b></span></li>`).join("")}</ul></section>` : ""}
      ${most.length ? `<section class="kb-pst-box"><h4>${t("Most watched")}</h4>${sceneRows(most, (s) => `${s.play_count} ×`)}</section>` : ""}
      ${best.length ? `<section class="kb-pst-box"><h4>${t("Best rated")}</h4>${sceneRows(best, (s) => esc(ratingText(s.rating100)))}</section>` : ""}
    </div>`;
}

// ---------- Missing scenes ----------

export const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch (e) {
    return u;
  }
};
export const boxBase = (endpoint) => String(endpoint).replace(/\/graphql\/?$/i, "");
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

// the ids of this stash-box's scenes that the library has
export async function localBoxIds(endpoint) {
  const q = (filtered) => `query LocalBoxIds${filtered ? "($s: SceneFilterType)" : ""} { findScenes(filter: { per_page: -1 }${filtered ? ", scene_filter: $s" : ""}) { scenes { id stash_ids { endpoint stash_id } } } }`;
  let d;
  try {
    d = await gql(q(true), { s: { stash_id_endpoint: { endpoint, modifier: "NOT_NULL" } } }, { heavy: true });
  } catch (e) {
    d = await gql(q(false), undefined, { heavy: true }); // a Stash without that filter: read every scene's ids
  }
  const map = new Map();
  for (const s of d.findScenes.scenes) for (const x of s.stash_ids || []) if (x.endpoint === endpoint) map.set(x.stash_id, s.id);
  return map;
}

// the library's performers as the stash-box sees them: by the box's performer id (stash_ids) and, for the unlinked ones, by name / alias
const perfCache = new Map();
export async function localPerformers(endpoint, fresh) {
  if (!fresh && perfCache.has(endpoint)) return perfCache.get(endpoint);
  const ask = (alias) => gql(`query LocalBoxPerformers { findPerformers(filter: { per_page: -1 }) { performers { id name gender ${alias ? "alias_list " : ""}stash_ids { endpoint stash_id } } } }`, undefined, { heavy: true });
  let d;
  try {
    d = await ask(true);
  } catch (e) {
    d = await ask(false); // a Stash without alias_list
  }
  const ids = new Map();
  const women = new Map(); // the linked ones that are female (or trans women)
  const names = new Map();
  for (const p of d.findPerformers.performers) {
    for (const x of p.stash_ids || []) if (x.endpoint === endpoint) (ids.set(x.stash_id, p.id), /^(FEMALE|TRANSGENDER_FEMALE)$/.test(p.gender || "") && women.set(x.stash_id, p.id));
    for (const n of [p.name, ...(p.alias_list || [])]) {
      const k = norm(n);
      if (k.length >= 5 && !names.has(k)) names.set(k, p.id);
    }
  }
  const idx = { ids, women, names };
  perfCache.set(endpoint, idx);
  return idx;
}
// the local performer id of one performer of a stash-box scene ("" = not in the library)
export const matchPerf = (idx, boxId, name) => (idx && ((boxId && idx.ids.get(boxId)) || idx.names.get(norm(name)))) || "";
// only the linked ones count here (a name alone is too weak to say "this is my performer")
export const sceneHasMine = (idx, x, women) => !!idx && (x.performer_ids || []).some((id) => id && (women ? idx.women : idx.ids).has(id));

// the day n days ago as YYYY-MM-DD (the window "only the last n days")
export const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - Math.max(0, Number(n) || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// A stash-box scene in a window: bigger cover, details, the performers (with the ones the library has linked), tags and the way on
export function openBoxScene(x, { endpoint, name }) {
  const base = boxBase(endpoint);
  const title = x.title || x.id;
  const wrap = document.createElement("div");
  const meta = [x.date ? fmtDate(x.date) : "", x.studio, x.duration ? fmtDuration(x.duration) : ""].filter(Boolean).join(" · ");
  wrap.innerHTML = `
    <div class="kb-scrim kb-dialog-scrim"></div>
    <div class="kb-dialog kb-bsm" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <button type="button" class="kb-btn is-icon is-ghost kb-bsm-x" data-close aria-label="${t("Close")}">${icon("close")}</button>
      <span class="kb-bsm-cover">${x.image ? `<img alt="" data-cover="${esc(x.image)}">` : ""}</span>
      <h2>${esc(title)}</h2>
      ${meta ? `<p class="kb-bsm-meta">${esc(meta)}</p>` : ""}
      <div class="kb-chips kb-bsm-perfs" data-perfs></div>
      ${(x.tags || []).length ? `<div class="kb-chips kb-bsm-tags">${x.tags.map((g) => `<span class="kb-chip">${esc(g)}</span>`).join("")}</div>` : ""}
      ${x.details ? `<p class="kb-bsm-details">${esc(x.details)}</p>` : ""}
      <div class="kb-actions">
        <a class="kb-btn" href="#/scenes?q=${encodeURIComponent(title)}" data-lib>${t("Search your library for this title")}</a>
        <a class="kb-btn is-primary" href="${esc(base + "/scenes/" + encodeURIComponent(x.id))}" target="_blank" rel="noopener noreferrer">${t("Open on {name}", { name: name || hostOf(base) })}</a>
      </div>
    </div>`;
  mountOverlay(wrap);
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  const close = () => {
    wrap.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  document.addEventListener("keydown", onKey, true);
  wrap.querySelector(".kb-scrim").onclick = close;
  wrap.querySelector("[data-close]").onclick = close;
  wrap.querySelector("[data-lib]").addEventListener("click", close);
  const perfs = wrap.querySelector("[data-perfs]");
  const paint = (idx) => {
    perfs.innerHTML = (x.performers || [])
      .map((n, i) => {
        if (!n) return "";
        const bid = (x.performer_ids || [])[i];
        const local = matchPerf(idx, bid, n);
        return local
          ? `<a class="kb-chip is-have" href="#/performer/${esc(local)}" title="${esc(t("In your library"))}">${esc(n)}</a>`
          : bid
            ? `<a class="kb-chip" href="${esc(base + "/performers/" + encodeURIComponent(bid))}" target="_blank" rel="noopener noreferrer">${esc(n)}</a>`
            : `<span class="kb-chip">${esc(n)}</span>`;
      })
      .join("");
  };
  paint(null);
  perfs.addEventListener("click", (e) => e.target.closest('a[href^="#/"]') && close());
  localPerformers(endpoint).then(paint, () => {});
  lazyCovers(wrap, endpoint, null);
  wrap.querySelector("[data-lib]").focus();
}

// the cover pictures come through the backend (Stash's page policy blocks pictures from other sites), only when they scroll into view
const coverCache = new Map();
let coverBusy = 0;
const coverQueue = [];
// kept between visits (Cache API): a picture seen once comes back at once
const coverStore = () => (window.caches ? caches.open("stashui-covers").catch(() => null) : Promise.resolve(null));
async function storedCover(url) {
  try {
    const c = await coverStore();
    const r = c && (await c.match(url));
    return r ? await r.text() : "";
  } catch (e) {
    return "";
  }
}
async function storeCovers(map) {
  try {
    const c = await coverStore();
    if (c) for (const [u, d] of Object.entries(map)) d && (await c.put(u, new Response(d)));
  } catch (e) {
    /* no cache: they come again next time */
  }
}
const showCover = (job) => {
  const d = coverCache.get(job.url);
  if (job.img.isConnected && d) {
    job.img.src = d;
    job.img.parentElement && job.img.parentElement.classList.add("is-on");
  }
};
function pumpCovers() {
  // up to 12 pictures of one stash-box per backend call, three calls side by side (one call per picture was slow: every call starts the backend)
  while (coverBusy < 3 && coverQueue.length) {
    const first = coverQueue[0];
    const batch = [];
    for (let i = 0; i < coverQueue.length && batch.length < 12; i++) if (coverQueue[i].endpoint === first.endpoint) batch.push(coverQueue[i]);
    batch.forEach((j) => coverQueue.splice(coverQueue.indexOf(j), 1));
    coverBusy++;
    (async () => {
      try {
        const need = [];
        for (const j of batch) {
          if (!coverCache.has(j.url)) {
            const kept = await storedCover(j.url);
            if (kept) coverCache.set(j.url, kept);
            else if (!need.includes(j.url)) need.push(j.url);
          }
        }
        if (need.length) {
          const got = ((await runBackend({ mode: "box_images", endpoint: first.endpoint, urls: need })).data) || {};
          need.forEach((u) => coverCache.set(u, got[u] || ""));
          storeCovers(got);
        }
      } catch (e) {
        batch.forEach((j) => coverCache.has(j.url) || coverCache.set(j.url, ""));
      }
      batch.forEach(showCover);
      coverBusy--;
      pumpCovers();
    })();
  }
}
export function lazyCovers(root, endpoint, scroller = root.querySelector(".kb-pm-list")) {
  const imgs = [...root.querySelectorAll("img[data-cover]")];
  if (!imgs.length) return;
  const go = (img) => {
    const url = img.dataset.cover;
    img.removeAttribute("data-cover");
    if (coverCache.get(url)) {
      img.src = coverCache.get(url);
      img.parentElement.classList.add("is-on");
    } else coverQueue.push({ img, url, endpoint });
    pumpCovers();
  };
  if (!window.IntersectionObserver) return imgs.slice(0, 30).forEach(go);
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (io.unobserve(e.target), go(e.target))), { root: scroller, rootMargin: "300px" });
  imgs.forEach((i) => io.observe(i));
}

// Buttons [data-pstats] / [data-pmiss] of the performer page open the panel `host`; the active one closes it again
export function mountPerfPanel(main, p) {
  const host = main.querySelector("[data-perfpanel]");
  const bStats = main.querySelector("[data-pstats]");
  const bMiss = main.querySelector("[data-pmiss]");
  if (!host) return () => {};
  let active = "";
  const state = {};
  let gen = 0;
  const open = async (which) => {
    const run = ++gen;
    if (active === which) {
      active = "";
      state.off && state.off();
      state.off = null;
      host.hidden = true;
      bStats.classList.remove("is-on");
      bMiss.classList.remove("is-on");
      return;
    }
    active = which;
    host.hidden = false;
    bStats.classList.toggle("is-on", which === "stats");
    bMiss.classList.toggle("is-on", which === "miss");
    state.off && state.off();
    state.off = null;
    try {
      if (which === "stats") await showStats(host, p);
      else {
        // the Discover tab of the plugin stashDiscover (by ufousox007, vendor/stashdiscover) – scenes the stash-boxes have and the library doesn't
        host.innerHTML = `<p class="kb-pst-wait">${t("Loading …")}</p>`;
        const off = await (await import("./ssdpage.js")).mountEntityTab(host, "performer", p.id);
        host.querySelector(".kb-pst-wait") && host.querySelector(".kb-pst-wait").remove();
        if (run !== gen || active !== which) off();
        else state.off = off;
      }
    } catch (err) {
      if (run === gen) host.innerHTML = `<p class="kb-pst-wait is-err">${esc(String(err.message || err))}</p>`;
    }
  };
  if (bStats) bStats.onclick = () => open("stats");
  if (bMiss) bMiss.onclick = () => open("miss");
  // "Discover tab" of the Discover overview (stashDiscover) leaves a note: open the missing scenes of this performer right away
  try {
    if (bMiss && sessionStorage.getItem("SSD:dp:openTab") === String(p.id)) {
      sessionStorage.removeItem("SSD:dp:openTab");
      open("miss");
    }
  } catch (e) {
    /* no session storage */
  }
  return () => {
    gen++;
    state.off && state.off();
  };
}
