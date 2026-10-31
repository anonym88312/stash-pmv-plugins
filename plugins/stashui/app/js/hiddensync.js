// Hidden folders – kept in Stash (the stashui plugin's settings, key hiddenFolders) so every device hides the same ones,
// and in the browser (hidden.js) so the very first request already knows. The folder ids are looked up again by path
// at the start (they change when a folder is taken out of the library and put back).

import { gql, pluginConfig, setPluginConfig } from "./api.js";
import { hiddenState, setHiddenState, normPath } from "./hidden.js";

const CFG = "hiddenFolders";

const clean = (s) => ({ items: s.items.map((x) => ({ id: x.id || "", path: x.path, name: x.name })), names: s.names });
const same = (a, b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));

// the hidden folders written to Stash (the settings there are replaced as a whole – api.js merges)
export async function saveHidden(next) {
  setHiddenState(next);
  await setPluginConfig("stashui", { [CFG]: JSON.stringify({ items: hiddenState().items.map((x) => ({ path: x.path, name: x.name })), names: hiddenState().names }) });
}

async function resolveIds() {
  const items = hiddenState().items;
  if (!items.length) return false;
  const d = await gql(`query { findFolders(filter: { per_page: -1 }) { folders { id path } } }`, undefined, { raw: true });
  const byPath = new Map(d.findFolders.folders.map((f) => [normPath(f.path), String(f.id)]));
  const next = { items: items.map((x) => Object.assign({}, x, { id: byPath.get(normPath(x.path)) || "" })), names: hiddenState().names };
  if (same(next, hiddenState())) return false;
  setHiddenState(next, true);
  return true;
}

// Called before the first page is drawn. Gives up after a few seconds (the page then starts with what the browser knows).
export async function syncHidden() {
  const work = (async () => {
    const c = await pluginConfig("stashui");
    let remote = null;
    try {
      remote = c[CFG] ? JSON.parse(c[CFG]) : null;
    } catch (e) { /* broken value – the browser's copy stays */ }
    const mine = hiddenState();
    if (remote && Array.isArray(remote.items)) {
      // (the ids of this Stash are only known here – keep the ones the browser already has for the same path)
      const ids = new Map(mine.items.map((x) => [normPath(x.path), x.id]));
      const next = { items: remote.items.map((x) => ({ id: ids.get(normPath(x.path)) || "", path: x.path, name: x.name })), names: remote.names !== false };
      if (!same(next, mine)) setHiddenState(next, true);
    } else if (mine.items.length) {
      setPluginConfig("stashui", { [CFG]: JSON.stringify({ items: mine.items.map((x) => ({ path: x.path, name: x.name })), names: mine.names }) }).catch(() => {});
    }
    await resolveIds();
  })();
  await Promise.race([work.catch(() => {}), new Promise((r) => setTimeout(r, 3500))]);
}
