// Hidden folders: what lies in them shows up on no page – only on the page of the folder itself.
//
// Stash has no such thing, so every request for scenes, images, galleries and markers gets the hidden folders left out
// (api.js gql() asks hideQuery()). A folder is "opened" while its page (or something below it) is on screen: then it isn't
// left out. No imports here, so Media Storm and the PMV Generator can use the same file.

const KEY = "stashui.hiddenFolders";
let state = read();
let opened = new Set(); // paths (normalised) of the hidden folders that are open right now

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && Array.isArray(v.items)) return { items: v.items.filter((x) => x && x.path), names: v.names !== false };
  } catch (e) { /* blocked or broken – nothing hidden */ }
  return { items: [], names: true };
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) state = read(); // changed in another tab
  });
}

export const refresh = () => (state = read()); // (for other plugins' pages: Stash UI may have changed it in this very tab)
export const hiddenState = () => state;
export const hiddenItems = () => state.items;
export const hiddenNames = () => state.names; // show the hidden folders on the Folders page?

// `next` = { items: [{ id, path, name }], names }
export function setHiddenState(next, quiet) {
  state = { items: (next.items || []).filter((x) => x && x.path), names: next.names !== false };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) { /* blocked – kept for this page only */ }
  if (!quiet && typeof window !== "undefined") window.dispatchEvent(new Event("stash:hidden-changed"));
}

export const normPath = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const inside = (path, base) => path === base || path.startsWith(base + "/");

// the hidden folder that holds this path (or is it); null if none
export function hiddenEntryOf(path) {
  const p = normPath(path);
  const all = state.items.filter((x) => inside(p, normPath(x.path)));
  return all.sort((a, b) => normPath(a.path).length - normPath(b.path).length)[0] || null; // (the outermost)
}
export const isHiddenPath = (path) => !!hiddenEntryOf(path);
export const entryOpen = (e) => opened.has(normPath(e.path));

// A folder that's hidden (or lies in one) and isn't open right now – it must not be listed in menus, on the home page …
export function roomHidden(node) {
  const p = normPath(node.path);
  return state.items.some((x) => inside(p, normPath(x.path)) && !opened.has(normPath(x.path)));
}

// exactly this folder is hidden (not just something inside one) – its numbers don't count for the folders above it
export const isHiddenRoot = (node) => state.items.some((x) => normPath(x.path) === normPath(node.path));
// the subfolders to list: the hidden ones only when they're listed on the Folders page or their folder is open
export const shownKids = (node) => node.kids.filter((k) => state.names || !roomHidden(k));

// The page of this folder is open: the hidden folders that hold it show their content now (only while this page is up)
export function openFolder(path) {
  const p = normPath(path);
  opened = new Set(state.items.filter((x) => inside(p, normPath(x.path))).map((x) => normPath(x.path)));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("stash:hidden-opened"));
}
export function lockAll() {
  if (!opened.size) return;
  opened = new Set();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("stash:hidden-opened"));
}

// ids of the folders left out right now
export const activeIds = () => state.items.filter((x) => x.id && !opened.has(normPath(x.path))).map((x) => String(x.id));

// ---------- Leaving them out of a request ----------

const crit = (ids) => ({ value: ids, modifier: "EXCLUDES", depth: -1 });
// Scenes and images: through their files; galleries: the folder they are
function wrap(kind, obj, ids) {
  const own = kind === "gallery" ? { parent_folder: crit(ids) } : { files_filter: { parent_folder: crit(ids) } };
  return obj && Object.keys(obj).length ? Object.assign(own, { AND: obj }) : own;
}
const lit = (kind, ids) => {
  const c = `{ value: [${ids.map((i) => JSON.stringify(String(i))).join(", ")}], modifier: EXCLUDES, depth: -1 }`;
  return kind === "gallery" ? `parent_folder: ${c}` : `files_filter: { parent_folder: ${c} }`;
};

const FILTER_TYPES = { SceneFilterType: "scene", ImageFilterType: "image", GalleryFilterType: "gallery", SceneMarkerFilterType: "marker" };
const ROOTS = { findScenes: ["scene_filter", "scene"], findImages: ["image_filter", "image"], findGalleries: ["gallery_filter", "gallery"] };

// index of the bracket that closes the one at i (quoted strings skipped); -1 if there is none
function closing(s, i, open, close) {
  let d = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      for (i++; i < s.length && s[i] !== '"'; i++) if (s[i] === "\\") i++;
      continue;
    }
    if (c === open) d++;
    else if (c === close && --d === 0) return i;
  }
  return -1;
}

// Filters written into the query text itself (not passed as variables)
function literals(q, ids) {
  const re = /\b(findScenes|findImages|findGalleries)\s*\(/g;
  let out = "";
  let pos = 0;
  let m;
  while ((m = re.exec(q))) {
    const open = m.index + m[0].length - 1;
    const end = closing(q, open, "(", ")");
    if (end < 0) break;
    const [arg, kind] = ROOTS[m[1]];
    const args = q.slice(open + 1, end);
    const am = new RegExp("\\b" + arg + "\\s*:\\s*").exec(args);
    let next;
    if (!am) next = (args.trim() ? args + ", " : "") + `${arg}: { ${lit(kind, ids)} }`;
    else {
      const at = am.index + am[0].length;
      if (args[at] === "$") continue; // a variable – patched by its type
      if (args[at] !== "{") continue;
      const close = closing(args, at, "{", "}");
      if (close < 0) continue;
      next = args.slice(0, at) + `{ ${lit(kind, ids)}, AND: ${args.slice(at, close + 1)} }` + args.slice(close + 1);
    }
    out += q.slice(pos, open + 1) + next;
    pos = end;
    re.lastIndex = end;
  }
  return out + q.slice(pos);
}

// { query, variables } the way Stash should get them: without what's in the hidden folders
export function hideQuery(query, variables) {
  const ids = activeIds();
  if (!ids.length || !/\bfind(Scenes|Images|Galleries|SceneMarkers)\b/.test(query)) return { query, variables };
  let vars = variables;
  const re = /\$(\w+)\s*:\s*(SceneFilterType|ImageFilterType|GalleryFilterType|SceneMarkerFilterType)\b/g;
  let m;
  while ((m = re.exec(query))) {
    const kind = FILTER_TYPES[m[2]];
    vars = Object.assign({}, vars);
    const cur = vars[m[1]];
    vars[m[1]] = kind === "marker" ? Object.assign({}, cur, { scene_filter: wrap("scene", cur && cur.scene_filter, ids) }) : wrap(kind, cur, ids);
  }
  return { query: literals(query, ids), variables: vars };
}
