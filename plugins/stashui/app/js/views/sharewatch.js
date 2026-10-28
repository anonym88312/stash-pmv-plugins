// Sharing → Watch links: the public links to single videos (made in the player: info bar → “Watch link”). Switch them off, make
// them last longer, rename or delete them. The links themselves are kept by the receiver on this PC (sharing.py, file watch.json).

import { esc, icon, toast, errorToast, fmtBytes, confirmDialog, promptDialog, menu } from "../ui.js";
import { t } from "../i18n.js";
import * as C from "../shareconn.js";
import { startCard } from "./sharing.js";
import { DURATIONS, LIMITS, watchBase, watchUrl, watchDirect, copyText } from "./watchlink.js";

const STATE = () => ({ ok: t("on"), paused: t("switched off"), expired: t("expired"), missing: t("video not found"), full: t("limit reached"), preparing: t("being prepared"), failed: t("couldn't be prepared") });
const when = (sec) => (sec ? new Date(sec * 1000).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const left = (w) => {
  if (!w.expires) return t("until you switch it off");
  const h = Math.max(0, (w.expires - Date.now() / 1000) / 3600);
  return h >= 48 ? t("{n} days left", { n: Math.round(h / 24) }) : h >= 1 ? t("{n} h left", { n: Math.round(h) }) : t("less than an hour left");
};

export function mountWatch(host, ctx) {
  let built = false;
  const base = () => watchBase(ctx.st, ctx.s.config);

  function row(w) {
    const url = watchUrl(base(), w);
    const dead = w.state !== "ok";
    return `<div class="kb-share-link is-${w.state === "ok" ? "ok" : w.enabled ? "expired" : "paused"}" data-w="${esc(w.id)}">
      <div class="kb-share-linkhead"><b>${esc(w.title || t("Video"))}</b><span class="kb-share-state">${esc(STATE()[w.state] || w.state)}${w.state === "preparing" ? " " + ((w.prep && w.prep.pct) || 0) + " %" : ""}${dead ? "" : " · " + esc(left(w))}</span></div>
      <div class="kb-hint">${w.size ? esc(fmtBytes(w.size)) + " · " : ""}${w.quality ? w.quality + "p · " : ""}${t("Viewers: {n}", { n: w.maxViews ? w.views + " / " + w.maxViews : w.views })}${w.last ? " · " + t("Last viewed: {time}", { time: when(w.last) }) : ""}</div>
      <div class="kb-phone-url"><code>${esc(url)}</code><button type="button" class="kb-btn is-ghost" data-copy title="${esc(t("Copy the link"))}">${icon("copies")}</button></div>
      <div class="kb-share-row">
        <a class="kb-btn is-ghost" href="${esc(url)}" target="_blank" rel="noopener">${t("Open it")}</a>
        <button type="button" class="kb-btn" data-toggle>${w.enabled ? t("Switch off") : t("Switch on")}</button>
        <button type="button" class="kb-btn is-ghost" data-extend>${t("Change how long / how many")}</button>
        <button type="button" class="kb-btn is-ghost" data-copyd title="${esc(t("The video file itself, e.g. to paste into another player"))}">${t("Copy the video address")}</button>
        <button type="button" class="kb-btn is-ghost" data-rename>${t("Rename")}</button>
        <button type="button" class="kb-btn is-ghost kb-pdanger" data-del>${t("Delete")}</button>
      </div>
    </div>`;
  }

  function paint() {
    const list = ctx.s.watches || [];
    host.innerHTML = `
      <section class="kb-share-card">
        <h2>${t("Watch links")}</h2>
        <p class="kb-hint">${t("A link to one video that anybody can open in a normal web browser. Make one in the player: info bar → “Watch link”. Your PC has to stay on while someone watches.")}</p>
        ${ctx.s.config.baseUrl ? "" : `<p class="kb-hint kb-share-warn">${t("These links only work inside your own network until you make the receiver reachable from the internet (Sharing → My link).")}</p>`}
        <div class="kb-share-links">${list.length ? list.slice().reverse().map(row).join("") : `<p class="kb-hint">${t("No watch links yet.")}</p>`}</div>
      </section>`;
    wire(list);
  }

  async function act(body) {
    try {
      await C.adm("/admin/watch", body);
      await ctx.refresh();
    } catch (e) {
      errorToast(e, t("Watch links"));
    }
  }

  function wire(list) {
    host.querySelectorAll("[data-w]").forEach((el) => {
      const w = list.find((x) => x.id === el.dataset.w);
      if (!w) return;
      el.querySelector("[data-copy]").onclick = () => copyText(watchUrl(base(), w), el.querySelector("code"));
      el.querySelector("[data-copyd]").onclick = () => copyText(watchDirect(base(), w));
      el.querySelector("[data-toggle]").onclick = () => act({ action: "set", id: w.id, enabled: !w.enabled });
      el.querySelector("[data-rename]").onclick = async () => {
        const v = await promptDialog({ title: t("Rename"), label: t("Title they see"), value: w.title || "", ok: t("Save") });
        if (v != null) act({ action: "rename", id: w.id, title: v });
      };
      el.querySelector("[data-extend]").onclick = (e) =>
        menu(e.currentTarget, [
          ...DURATIONS.map(([h, l]) => ({ label: t("From now on: {what}", { what: t(l) }), run: () => act({ action: "extend", id: w.id, hours: h || null }) })),
          ...LIMITS.map(([n, l]) => ({ label: t("Limit: {what}", { what: t(l) }), run: () => act({ action: "extend", id: w.id, hours: w.expires ? Math.max(0.01, (w.expires - Date.now() / 1000) / 3600) : null, maxViews: n }) })),
        ]);
      el.querySelector("[data-del]").onclick = async () => {
        if (await confirmDialog({ title: t("Delete link"), text: t("Nobody can watch the video with this link any more. The video itself stays where it is."), ok: t("Delete"), danger: true })) act({ action: "del", id: w.id });
      };
    });
  }

  return {
    update() {
      if (!ctx.running) {
        host.innerHTML = startCard(ctx, t("Start it to make links that anybody can open to watch a video."));
        const b = host.querySelector("[data-start]");
        if (b) b.onclick = async () => ((b.disabled = true), await ctx.start(), (b.disabled = false));
        built = false;
        return;
      }
      if (built && host.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      built = true;
      paint();
    },
    destroy() {},
  };
}
