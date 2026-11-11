// Markdown in the details and descriptions of scenes, images, galleries, groups, performers, studios and tags
// (Settings → This interface → "Markdown in descriptions", on by default). A small renderer of its own: all text is escaped first,
// only the tags below are ever produced, links must be http(s) or mailto and open in a new tab, pictures and raw HTML are never shown.
// Single line breaks stay line breaks (the details were shown like that before).

import { esc, store } from "./ui.js";

export const markdownOn = () => store.get("markdown", true) !== false;

const LI = /^(\s*)([-*+]|\d{1,9}[.)])\s+/;
const HR = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const HEAD = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*```/;
const SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function emph(s) {
  return s
    .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/__(?=\S)([^\n]*?\S)__/g, "<strong>$1</strong>")
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, "<del>$1</del>")
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?![\w])/g, "$1<em>$2</em>");
}

// One line of text → inline HTML. plain = no links (inside a card that is itself a link)
function inline(src, plain) {
  const keep = [];
  const hold = (h) => `\u0000${keep.push(h) - 1}\u0000`;
  let s = esc(src);
  s = s.replace(/`([^`\n]+)`/g, (m, c) => hold(`<code>${c}</code>`));
  s = s.replace(/!?\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (m, txt, url) => hold(plain ? emph(txt) : `<a href="${url}" target="_blank" rel="noopener noreferrer">${emph(txt)}</a>`));
  if (!plain) s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]*[^\s<.,;:!?)])/g, (m, pre, url) => pre + hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
  s = emph(s);
  for (let k = 0; k < 3; k++) s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[i]);
  return s;
}

const lines2 = (text) => text.split("\n").map((l) => inline(l.trim())).join("<br>");

function renderList(items) {
  let pos = 0;
  const level = (ind) => {
    const tag = items[pos].ord ? "ol" : "ul";
    let h = `<${tag}>`;
    while (pos < items.length && items[pos].ind >= ind) {
      if (items[pos].ind > ind) {
        h = h.replace(/<\/li>$/, "") + level(items[pos].ind) + "</li>"; // deeper than anything before: nested into the last entry
        continue;
      }
      const it = items[pos++];
      h += `<li>${lines2(it.text)}`;
      if (pos < items.length && items[pos].ind > ind) h += level(items[pos].ind);
      h += "</li>";
    }
    return h + `</${tag}>`;
  };
  return level(items[0].ind);
}

const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function mdBlocks(text) {
  const lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const blank = (l) => !l.trim();
  const starts = (l) => HEAD.test(l) || FENCE.test(l) || HR.test(l) || /^\s{0,3}>/.test(l) || LI.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (blank(l)) {
      i++;
      continue;
    }
    if (FENCE.test(l)) {
      const buf = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    let m = HEAD.exec(l);
    if (m) {
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
      i++;
      continue;
    }
    if (HR.test(l)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^\s{0,3}>/.test(l)) {
      const buf = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) buf.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      out.push(`<blockquote>${mdBlocks(buf.join("\n"))}</blockquote>`);
      continue;
    }
    if (LI.test(l)) {
      const items = [];
      while (i < lines.length) {
        const mm = LI.exec(lines[i]);
        if (mm) {
          // another kind of list at the first level (bullets, then numbers) starts a list of its own
          if (items.length && mm[1].replace(/\t/g, "    ").length <= items[0].ind && /\d/.test(mm[2]) !== items[0].ord) break;
          items.push({ ind: mm[1].replace(/\t/g, "    ").length, ord: /\d/.test(mm[2]), text: lines[i].slice(mm[0].length) });
          i++;
        } else if (items.length && lines[i].trim() && /^\s+\S/.test(lines[i])) {
          items[items.length - 1].text += "\n" + lines[i].trim();
          i++;
        } else if (blank(lines[i]) && i + 1 < lines.length && LI.test(lines[i + 1])) i++;
        else break;
      }
      out.push(renderList(items));
      continue;
    }
    if (l.includes("|") && i + 1 < lines.length && SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = cells(l);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && !blank(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] || "")}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`
      );
      continue;
    }
    const buf = [];
    while (i < lines.length && !blank(lines[i]) && (!buf.length || !starts(lines[i]))) buf.push(lines[i++]);
    out.push(`<p>${buf.map((x) => inline(x.trim())).join("<br>")}</p>`);
  }
  return out.join("");
}

// One flowing line for a card: the marks of lists, headings and quotes dropped, no links
export function mdInline(text) {
  const s = String(text == null ? "" : text)
    .replace(/```/g, "")
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, "") // the line under a table's head
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d{1,9}[.)]\s+)/gm, "")
    .replace(/\s*\n\s*/g, " ")
    .trim();
  return inline(s, true);
}

// A text block of a page: markdown when it's on, otherwise as before (plain, line breaks kept by the CSS of the class)
export function textBox(text, cls) {
  if (!text) return "";
  return markdownOn() ? `<div class="${cls} kb-md">${mdBlocks(text)}</div>` : `<p class="${cls}">${esc(text)}</p>`;
}

// The details line of a card
export const cardText = (text) => (markdownOn() ? mdInline(text) : esc(text));
