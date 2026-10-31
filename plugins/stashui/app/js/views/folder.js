// Folders as rooms: overview of the top folders and single rooms with subfolders and items.

import { esc, icon, plural, errorToast, folderMode, confirmDialog, toast } from "../ui.js";
import { t } from "../i18n.js";
import { loadFolders, findItems, folderLevelCounts } from "../api.js";
import { mediaBrowser } from "./media.js";
import { openFolder, roomHidden, hiddenEntryOf, hiddenItems, hiddenState, hiddenNames, normPath, shownKids } from "../hidden.js";
import { saveHidden } from "../hiddensync.js";

// Up to three cover images for a room (images first, otherwise scene screenshots)
const coverCache = new Map();
window.addEventListener("stash:library-changed", () => coverCache.clear());
window.addEventListener("stash:hidden-opened", () => coverCache.clear()); // (what was asked while a folder was open mustn't show up later)
window.addEventListener("stash:hidden-changed", () => coverCache.clear());
export function roomCovers(id) {
  if (coverCache.has(id)) return coverCache.get(id);
  const ff = { files_filter: { parent_folder: { value: [id], modifier: "INCLUDES", depth: -1 } } };
  const p = (async () => {
    const imgs = await findItems("image", { per_page: 3, sort: "random_" + id }, ff).catch(() => ({ items: [] }));
    let urls = imgs.items.map((x) => x.paths.thumbnail).filter(Boolean);
    if (urls.length < 3) {
      const sc = await findItems("scene", { per_page: 3 - urls.length, sort: "random_" + id }, ff).catch(() => ({ items: [] }));
      urls = urls.concat(sc.items.map((x) => x.paths.screenshot).filter(Boolean));
    }
    return urls;
  })();
  coverCache.set(id, p);
  return p;
}

export function roomsHtml(nodes) {
  return `<div class="kb-rooms">${nodes
    .map(
      (n) => `<a class="kb-room${roomHidden(n) ? " is-hidden" : ""}" href="#/folder/${n.id}" data-room="${n.id}">
        <div class="kb-room-art"></div>
        <b>${esc(n.name)}</b>
        <small data-rc>${roomHidden(n) ? t("Hidden") : [n.tvid ? plural(n.tvid, "video", "videos") : "", n.timg ? plural(n.timg, "image", "images") : "", shownKids(n).length ? plural(shownKids(n).length, "subfolder", "subfolders") : ""].filter(Boolean).join(t(", "))}</small>
      </a>`
    )
    .join("")}</div>`;
}

// Big library: the folders weren't counted up front – count the ones on screen now (per level, two cheap queries each),
// and write the numbers in. Returns a cancel function.
export function fillRoomCounts(root, tree, signal) {
  if (!tree.unc) return () => {};
  const rooms = [...root.querySelectorAll("[data-room]")];
  const done = (id, c) => {
    const n = tree.nodes.get(id);
    if (!n) return;
    n.tvid = c[0];
    n.timg = c[1];
    const el = root.querySelector(`[data-room="${id}"] [data-rc]`);
    if (el && !roomHidden(n)) el.textContent = [c[0] ? plural(c[0], "video", "videos") : "", c[1] ? plural(c[1], "image", "images") : "", shownKids(n).length ? plural(shownKids(n).length, "subfolder", "subfolders") : ""].filter(Boolean).join(t(", "));
  };
  const ids = rooms.map((r) => r.dataset.room);
  const ctl = new AbortController();
  if (signal) signal.addEventListener("abort", () => ctl.abort());
  // a few at a time, top to bottom, so the first numbers show up quickly
  (async () => {
    for (let i = 0; i < ids.length && !ctl.signal.aborted; i += 6) {
      const part = ids.slice(i, i + 6);
      try {
        const m = await folderLevelCounts(part, { signal: ctl.signal });
        part.forEach((id) => m.has(id) && done(id, m.get(id)));
      } catch (e) {
        return;
      }
    }
  })();
  return () => ctl.abort();
}

export function fillRoomCovers(root) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(async (e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const art = e.target.querySelector(".kb-room-art");
      const urls = await roomCovers(e.target.dataset.room);
      art.innerHTML = urls.map((u) => `<img alt="" loading="lazy" src="${esc(u)}">`).join("");
      if (urls.length === 1) art.style.gridTemplateColumns = "1fr";
    });
  }, { rootMargin: "300px" });
  root.querySelectorAll("[data-room]:not(.is-hidden)").forEach((r) => io.observe(r)); // (a hidden folder shows no pictures)
  return () => io.disconnect();
}

export async function render(main, params, query) {
  // Folder loading switched off: nothing is loaded unless asked for (in this tab)
  if (folderMode() === "off" && !sessionStorage.getItem("stashui.foldersOnce")) {
    main.innerHTML = `<div class="kb-empty"><b>${t("Folder loading is switched off")}</b>
      <p>${t("Counting folders reads the whole library, which can take very long on big libraries. Switch it back on under Settings → General.")}</p>
      <p><button class="kb-btn is-primary" data-loadonce>${t("Load anyway")}</button> <a class="kb-btn" href="#/settings/this-ui?find=${encodeURIComponent(t("Folder loading"))}">${t("Settings")}</a></p></div>`;
    main.querySelector("[data-loadonce]").onclick = () => {
      sessionStorage.setItem("stashui.foldersOnce", "1");
      render(main, params, query);
    };
    return;
  }
  let tree;
  // Counting the folders reads the whole library once – on a big library that takes minutes: it says so and can be cancelled
  const ctl = new AbortController();
  const slow = setTimeout(() => {
    main.innerHTML = `<div class="kb-empty"><b>${t("Counting your folders …")}</b><p>${t("This reads the whole library once and can take several minutes on a big library. The result is kept, so it only takes this long the first time (and after a scan).")}</p><button class="kb-btn" data-cancelload>${t("Cancel")}</button></div>`;
    main.querySelector("[data-cancelload]").onclick = () => ctl.abort();
  }, 2500);
  try {
    tree = await loadFolders(false, { user: true, signal: ctl.signal });
  } catch (e) {
    clearTimeout(slow);
    if (e && e.name === "AbortError") {
      main.innerHTML = `<div class="kb-empty"><b>${t("Cancelled")}</b><p>${t("The folders weren't loaded.")}</p><button class="kb-btn is-primary" data-again>${t("Try again")}</button></div>`;
      main.querySelector("[data-again]").onclick = () => render(main, params, query);
      return;
    }
    errorToast(e, "Folders");
    throw e;
  }
  clearTimeout(slow);

  if (!params.id) {
    main.innerHTML = `
      <header class="kb-head"><div class="kb-head-title">
        <h1 class="kb-h1">${t("Folders")}</h1>
        <p class="kb-sub">${t("Your library by folder. Empty folders are hidden.")}</p>
      </div></header>
      ${roomsHtml((tree.roots.length === 1 && tree.roots[0].kids.length ? tree.roots[0].kids : tree.roots).filter((n) => hiddenNames() || !roomHidden(n)))}`;
    const stopCounts = fillRoomCounts(main, tree);
    const stopCov = fillRoomCovers(main);
    return () => {
      stopCounts();
      stopCov();
    };
  }

  const node = tree.nodes.get(params.id);
  if (!node) {
    main.innerHTML = `<div class="kb-empty"><b>${t("This folder no longer exists")}</b><p>${t("It may have been moved or is empty.")}</p><a class="kb-btn" href="#/folders">${t("All folders")}</a></div>`;
    return;
  }
  openFolder(node.path); // a hidden folder shows what's in it while its page is open
  // Breadcrumbs
  const chain = [];
  for (let n = node; n; n = n.parent && tree.nodes.get(n.parent)) chain.unshift(n);
  const deep = query.deep === "1";
  const kinds = [];
  if (node.tvid || tree.unc) kinds.push("scene"); // (a big library isn't counted: both kinds are offered)
  if (node.timg || tree.unc) kinds.push("image");
  kinds.push("gallery");
  const initial = (deep ? node.tvid >= node.timg : node.vid >= node.img) && node.tvid ? "scene" : node.timg ? "image" : "scene";

  main.innerHTML = `
    <header class="kb-head">
      <div class="kb-head-title">
        <nav class="kb-crumbs" aria-label="${t("Path")}"><span><a href="#/folders">${t("Folders")}</a></span>${chain
          .slice(0, -1)
          .map((n) => `<span><a href="#/folder/${n.id}">${esc(n.name)}</a></span>`)
          .join("")}</nav>
        <h1 class="kb-h1">${esc(node.name)}</h1>
        <p class="kb-sub">${[node.tvid ? plural(node.tvid, "video", "videos") : "", node.timg ? plural(node.timg, "image", "images") : ""].filter(Boolean).join(t(" and "))}${shownKids(node).length ? t(", plus {what}", { what: plural(shownKids(node).length, "subfolder", "subfolders") }) : ""}</p>
      </div>
      <div class="kb-head-tools">
        <span data-hidebox></span>
        ${node.kids.length ? `<label class="kb-switch" title="${t("Also show content from subfolders")}"><input type="checkbox" data-deep${deep ? " checked" : ""}><i></i><span class="kb-lab-t">${t("Include subfolders")}</span></label>` : ""}
      </div>
    </header>
    ${shownKids(node).length ? `<h2 class="kb-h2">${t("Subfolders")}</h2>${roomsHtml(shownKids(node))}<h2 class="kb-h2">${t("In this folder")}</h2>` : ""}
    <section data-browser></section>`;

  // Hide this folder / show it again
  const hideBox = main.querySelector("[data-hidebox]");
  const paintHide = () => {
    const own = hiddenItems().find((x) => normPath(x.path) === normPath(node.path));
    const up = !own && hiddenEntryOf(node.path);
    hideBox.innerHTML = own
      ? `<button class="kb-btn is-ghost" data-hide="off" title="${esc(t("Its content shows up on the other pages again"))}">${icon("eyeoff")}<span>${t("Hidden – show it again")}</span></button>`
      : up
      ? `<span class="kb-hint" title="${esc(up.path)}">${icon("eyeoff")} ${t("Hidden with {name}", { name: up.name })}</span>`
      : `<button class="kb-btn" data-hide="on" title="${esc(t("Its content won't show up on any other page"))}">${icon("eyeoff")}<span>${t("Hide this folder")}</span></button>`;
  };
  paintHide();
  hideBox.onclick = async (e) => {
    const b = e.target.closest("[data-hide]");
    if (!b) return;
    try {
      if (b.dataset.hide === "on") {
        const r = await confirmDialog({ title: t("Hide this folder?"), text: t("Everything in it and in its subfolders stops showing up on every page – scenes, images, galleries, markers, search, the home page. It only shows here, when you open the folder. You can show it again here or in Settings."), ok: t("Hide it") });
        if (!r.ok) return;
        await saveHidden({ items: [...hiddenItems(), { id: node.id, path: node.path, name: node.name }], names: hiddenState().names });
        openFolder(node.path); // (this page keeps showing it)
        toast(t("Hidden. It only shows when you open this folder."));
      } else {
        await saveHidden({ items: hiddenItems().filter((x) => normPath(x.path) !== normPath(node.path)), names: hiddenState().names });
        toast(t("Shown on all pages again."));
      }
    } catch (err) {
      errorToast(err, "Hidden folders");
    }
    paintHide();
  };

  const stopCovers = fillRoomCovers(main);
  const stopCounts = fillRoomCounts(main, tree);
  if (tree.unc) {
    // the folder's own numbers (not counted up front on a big library)
    folderLevelCounts([node.id]).then((m) => {
      const c = m.get(node.id);
      const sub = main.querySelector(".kb-sub");
      if (!c || !sub) return;
      sub.textContent = [c[0] ? plural(c[0], "video", "videos") : "", c[1] ? plural(c[1], "image", "images") : ""].filter(Boolean).join(t(" and ")) + (shownKids(node).length ? t(", plus {what}", { what: plural(shownKids(node).length, "subfolder", "subfolders") }) : "");
    }).catch(() => {});
  }
  const depth = deep ? -1 : 0;
  const b = mediaBrowser(main.querySelector("[data-browser]"), {
    kinds,
    initialKind: initial,
    query,
    page: "folder",
    params: { id: node.id },
    defaults: { scene: { sort: "path", dir: "ASC" }, image: { sort: "path", dir: "ASC" }, gallery: { sort: "path", dir: "ASC" } },
    base: (k) => ({
      filter:
        k === "gallery"
          ? { parent_folder: { value: [node.id], modifier: "INCLUDES", depth } }
          : { files_filter: { parent_folder: { value: [node.id], modifier: "INCLUDES", depth } } },
    }),
  });
  const deepBox = main.querySelector("[data-deep]");
  if (deepBox)
    deepBox.onchange = () => {
      const q = new URLSearchParams(location.hash.split("?")[1] || "");
      if (deepBox.checked) q.set("deep", "1");
      else q.delete("deep");
      location.hash = `#/folder/${node.id}${q.toString() ? "?" + q : ""}`;
    };
  return () => {
    stopCovers();
    stopCounts();
    b.destroy();
  };
}
