// "Watch link" in a scene's info panel: a public link to this one video. Whoever has it can watch it in a normal browser – no Stash UI
// needed. The receiver on this PC (sharing.py, the same one Sharing uses) serves a plain player page and the file; the link can
// expire, be limited to a number of viewers, be switched off or deleted (Sharing → Watch links). Only this file is reachable.

import { esc, icon, toast, errorToast, openDrawer } from "../ui.js";
import { t } from "../i18n.js";
import { runBackend } from "../interactive.js";
import * as C from "../shareconn.js";

export const DURATIONS = [[1, "1 hour"], [24, "1 day"], [168, "7 days"], [720, "30 days"], [0, "Until I switch it off"]];
export const QUALITIES = [[720, "720p – smaller (recommended)"], [480, "480p – much smaller"], [360, "360p – smallest"], [0, "Original quality"]];
export const LIMITS = [[0, "Any number of people"], [1, "1 person"], [3, "3 people"], [10, "10 people"], [25, "25 people"]];
const PLAYABLE = new Set([".mp4", ".m4v", ".webm"]);

// The address of a watch link: <public address>/w/<token>; "direct" = the video file itself (e.g. to paste into another player)
export function watchBase(st, cfg) {
  return String((cfg && cfg.baseUrl) || (st && st.lan && st.lan[0]) || `http://127.0.0.1:${st && st.publicPort}`).replace(/\/$/, "");
}
export const watchUrl = (base, w) => `${base}/w/${w.token}`;
export const watchDirect = (base, w) => `${base}/w/${w.token}/video${w.ext || ".mp4"}`;

export async function copyText(text, from) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t("Link copied"), "ok");
  } catch (e) {
    if (from) {
      const r = document.createRange();
      r.selectNodeContents(from);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    }
  }
}

export function openWatchLink(x) {
  const file = ((x.files || [])[0] || {});
  const ext = (String(file.path || file.basename || "").match(/\.[A-Za-z0-9]+$/) || [""])[0].toLowerCase();
  const title0 = x.title || file.basename || "";
  const d = openDrawer({
    title: t("Public watch link"),
    body: `
      <p class="kb-hint">${t("Makes a link to this one video. Anybody who has it can watch it in a normal web browser – no Stash needed. Your PC has to stay on while they watch.")}</p>
      ${ext && !PLAYABLE.has(ext) ? `<p class="kb-hint kb-share-warn">${t("Browsers usually can't play “{ext}” files – the others would only get a download link. MP4 and WebM work best.", { ext })}</p>` : ""}
      <label class="kb-form-row"><span>${t("Title they see")}</span><input class="kb-field" data-title type="text" value="${esc(title0)}" maxlength="80"></label>
      <span class="kb-lab-t">${t("The link works for")}</span>
      <div class="kb-chips" data-dur>${DURATIONS.map(([h, l], i) => `<button type="button" class="kb-chip${i === 1 ? " is-on" : ""}" data-h="${h}">${t(l)}</button>`).join("")}</div>
      <span class="kb-lab-t">${t("How many people")}</span>
      <div class="kb-chips" data-lim>${LIMITS.map(([n, l], i) => `<button type="button" class="kb-chip${i === 0 ? " is-on" : ""}" data-n="${n}">${t(l)}</button>`).join("")}</div>
      <p class="kb-hint">${t("The same person watching again within half an hour counts once.")}</p>
      <span class="kb-lab-t">${t("Quality of the video they get")}</span>
      <div class="kb-chips" data-qual>${QUALITIES.map(([q, l], i) => `<button type="button" class="kb-chip${i === 0 ? " is-on" : ""}" data-qv="${q}">${t(l)}</button>`).join("")}</div>
      <p class="kb-hint">${t("A smaller copy is made once (it takes a few minutes and keeps your PC busy) and is deleted with the link. A viewer needs about 2.5 Mbit/s of your upload at 720p, 1.2 at 480p and 0.7 at 360p. “Original quality” sends the file as it is – with a slow upload that stutters.")}</p>
      <div class="kb-phone-acts"><button type="button" class="kb-btn is-primary" data-make>${icon("share")}${t("Create the link")}</button></div>
      <div data-result></div>
      <p class="kb-hint">${t("It starts the sharing receiver on this PC if it isn't running. All your links are listed under Sharing → Watch links, where you can switch them off or delete them at any time.")}</p>`,
  });
  const q = (s) => d.el.querySelector(s);
  let hours = 24;
  let limit = 0;
  let quality = 720;
  const pick = (box, attr, set) =>
    q(box).addEventListener("click", (e) => {
      const b = e.target.closest("[" + attr + "]");
      if (!b) return;
      q(box).querySelectorAll(".kb-chip").forEach((c) => c.classList.toggle("is-on", c === b));
      set(Number(b.getAttribute(attr)));
    });
  pick("[data-dur]", "data-h", (v) => (hours = v));
  pick("[data-lim]", "data-n", (v) => (limit = v));
  pick("[data-qual]", "data-qv", (v) => (quality = v));

  q("[data-make]").onclick = async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    const out = q("[data-result]");
    out.innerHTML = `<p class="kb-hint">${t("Working …")}</p>`;
    try {
      const st = await C.status(true); // starts the receiver when needed (and gives this page its admin address)
      const r = await runBackend({ mode: "watch_new", scene: String(x.id), hours: hours || null, maxViews: limit, quality, title: q("[data-title]").value.trim() });
      const s = await C.adm("/admin/state");
      const base = watchBase(st, s.config);
      const url = watchUrl(base, r.link);
      const direct = watchDirect(base, r.link);
      const inside = !s.config.baseUrl;
      out.innerHTML = `
        <div class="kb-share-link is-ok">
          <div class="kb-share-linkhead"><b>${t("Your link")}</b><span class="kb-share-state">${esc(t(DURATIONS.find(([h]) => h === (hours || 0))[1]))}</span></div>
          <div class="kb-phone-url"><code data-url>${esc(url)}</code><button type="button" class="kb-btn is-ghost" data-copy title="${esc(t("Copy the link"))}">${icon("copies")}</button></div>
          <div class="kb-share-row"><a class="kb-btn" href="${esc(url)}" target="_blank" rel="noopener">${t("Open it")}</a><button type="button" class="kb-btn is-ghost" data-copyd>${t("Copy the video address only")}</button></div>
          <div data-prep></div>
        </div>
        ${inside ? `<p class="kb-hint kb-share-warn">${t("This link only works inside your own network so far. To send it to anyone, make the receiver reachable from the internet first.")}</p><div class="kb-phone-acts"><button type="button" class="kb-btn" data-tosharing>${t("Open Sharing → My link")}</button></div>` : ""}`;
      q("[data-copy]").onclick = () => copyText(url, q("[data-url]"));
      q("[data-copyd]").onclick = () => copyText(direct);
      if (r.link.prep && r.link.prep.state) watchPrep(q("[data-prep]"), d, r.link.id);
      const ts = q("[data-tosharing]");
      if (ts) ts.onclick = () => ((location.hash = "#/sharing/link"), d.close());
    } catch (e) {
      out.innerHTML = "";
      errorToast(e, t("Watch link"));
    }
    btn.disabled = false;
  };
}

// While the smaller copy is made: a bar with the progress (the receiver tells it in its state); the link works when it says ready
async function watchPrep(box, drawer, id) {
  const draw = (pct, text) => (box.innerHTML = `<div class="kb-job-bar"><i style="width:${pct}%"></i></div><p class="kb-hint">${esc(text)}</p>`);
  draw(0, t("Making the smaller version … {n} %", { n: 0 }));
  for (let i = 0; i < 4000 && drawer.el.isConnected; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    let w;
    try {
      w = ((await C.adm("/admin/state")).watches || []).find((x) => x.id === id);
    } catch (e) {
      return;
    }
    if (!w || !drawer.el.isConnected) return;
    if (w.state === "failed") return void (box.innerHTML = `<p class="kb-hint kb-share-warn">${esc(t("Couldn't make the smaller version: {why}", { why: (w.prep && w.prep.why) || "" }))}</p>`);
    if (w.state !== "preparing") return draw(100, t("The smaller version is ready – the link works now."));
    draw((w.prep && w.prep.pct) || 0, t("Making the smaller version … {n} %", { n: (w.prep && w.prep.pct) || 0 }));
  }
}
