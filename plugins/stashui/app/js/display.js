// How things look and behave on this browser (Settings → This interface): the width of the menu on the left,
// the studio logo on thumbnails (size, corner), the NSFW blur, the shape of the thumbnails (as the picture is,
// posters or scenes) and whether hover previews play. All kept in this browser; applyDisplay() puts them on the page.

import { store } from "./ui.js";

const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || a));
export const STUDIO_SIZES = { s: 18, m: 26, l: 38, xl: 52 }; // logo height in px
export const STUDIO_POS = ["bl", "br", "tl", "tr"]; // bottom left (as before), bottom right, top left, top right
export const CARD_FORMATS = ["auto", "poster", "scene"]; // as the picture is · 2:3 portrait · 16:9 landscape
export const RAIL_MODES = ["full", "mini", "hidden"]; // the menu on the left: as always · icons only · away until the menu button is pressed
export const PREVIEW_MODES = ["on", "off", "poster"]; // always · never · not while posters are shown

// Put the settings on the page: CSS variables and classes on <html>
export function applyDisplay() {
  const r = document.documentElement;
  import("./fx.js").then((m) => m.applyFx());
  const rail = RAIL_MODES.includes(store.get("railMode", "full")) ? store.get("railMode", "full") : "full";
  r.dataset.rail = rail;
  r.style.setProperty("--rail", (rail === "mini" ? 64 : rail === "hidden" ? 0 : clamp(store.get("railWidth", 236), 180, 360)) + "px");
  r.style.setProperty("--studio-h", (STUDIO_SIZES[store.get("studioSize", "m")] || 26) + "px");
  const pos = store.get("studioPos", "bl");
  r.dataset.studioPos = STUDIO_POS.includes(pos) ? pos : "bl";
  r.classList.toggle("kb-nsfw", !!store.get("nsfw", false));
  r.classList.toggle("kb-nsfw-all", store.get("nsfwScope", "cards") === "all"); // also the player and the viewer
  r.classList.toggle("kb-nsfw-hover", !!store.get("nsfwHover", false)); // a thumbnail shows clear while the mouse is on it
  r.style.setProperty("--nsfw-blur", clamp(store.get("nsfwBlur", 18), 6, 40) + "px");
  document.querySelectorAll("[data-nsfwbtn]").forEach((b) => {
    b.classList.toggle("is-on", !!store.get("nsfw", false));
    b.setAttribute("aria-pressed", !!store.get("nsfw", false));
  });
  applyTabLook();
}

// The name and the icon in the browser tab (Settings → This interface). Another page that sets its own title meanwhile is left alone.
let titleSet = "";
let iconSet = "";
let iconDefault = null;
function applyTabLook() {
  const ttl = String(store.get("pageTitle", "") || "").trim().slice(0, 60);
  if (ttl !== titleSet) {
    if (document.title === (titleSet || "Stash UI")) document.title = ttl || "Stash UI";
    titleSet = ttl;
  }
  const fav = String(store.get("favicon", "") || "");
  if (fav !== iconSet) {
    const link = document.querySelector('link[rel="icon"]');
    if (link) {
      if (iconDefault == null) iconDefault = link.getAttribute("href");
      link.setAttribute("href", /^data:image\//.test(fav) ? fav : iconDefault);
    }
    iconSet = fav;
  }
}
// A picture → a small square PNG (data address) for the tab icon
export function iconFromFile(file, size = 64) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const s = Math.min(im.naturalWidth, im.naturalHeight);
      c.getContext("2d").drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/png"));
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("not a picture"));
    };
    im.src = url;
  });
}
// full → icons only → hidden → full (the button at the top of the menu)
export function cycleRail() {
  const cur = store.get("railMode", "full");
  store.set("railMode", RAIL_MODES[(RAIL_MODES.indexOf(cur) + 1) % RAIL_MODES.length] || "mini");
  applyDisplay();
}
// What a performer card says under the name (Settings → This interface → Info on performer cards); the first three are what it always said
const PERF_INFO = { scenes: true, age: true, rating: true, images: false, country: false, ethnicity: false, hair: false, eye: false, height: false, tags: false };
export const perfInfo = () => Object.assign({}, PERF_INFO, store.get("perfInfo", {}));
export const nsfwOn = () => !!store.get("nsfw", false);
// NSFW mode: things with one of these tags (Settings → This interface) are never blurred. Ids kept in "nsfwKeepTags".
let keepIds = null;
export function nsfwKeeps(tags) {
  if (!keepIds) keepIds = new Set((store.get("nsfwKeepTags", []) || []).map(String));
  return keepIds.size > 0 && (tags || []).some((x) => keepIds.has(String(x.id)));
}
window.addEventListener("stash:display-changed", () => (keepIds = null));
export function toggleNsfw(force) {
  store.set("nsfw", force == null ? !nsfwOn() : !!force);
  applyDisplay();
  window.dispatchEvent(new Event("stash:display-changed"));
  return nsfwOn();
}

// Thumbnails: null = each as its picture is; else the width / height every thumbnail gets
export const cardFormat = () => (CARD_FORMATS.includes(store.get("cardFormat", "auto")) ? store.get("cardFormat", "auto") : "auto");
export const cardAspect = () => ({ poster: 2 / 3, scene: 16 / 9 }[cardFormat()] || null);
// Do hover previews play?
export function previewsOn() {
  const m = store.get("previewMode", "on");
  return m === "off" ? false : m === "poster" ? cardFormat() !== "poster" : true;
}
