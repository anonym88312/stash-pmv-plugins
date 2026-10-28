// An "X" in every search field once something is typed: one tap clears the text (the browser's own one only exists in some
// browsers, and not in all of them). Fields are found by themselves – `.kb-search > input` – also on pages drawn later.

import { icon } from "./ui.js";
import { t } from "./i18n.js";

const SEL = ".kb-search > input.kb-field:not([data-sx])";

function wire(inp) {
  inp.setAttribute("data-sx", "");
  const b = document.createElement("button");
  b.type = "button";
  b.className = "kb-search-x";
  b.tabIndex = -1;
  b.title = t("Clear");
  b.setAttribute("aria-label", t("Clear"));
  b.innerHTML = icon("close");
  inp.after(b);
  const sync = () => b.classList.toggle("is-on", !!inp.value);
  inp.addEventListener("input", sync);
  inp.addEventListener("focus", sync); // (the value may have been set by the page)
  b.addEventListener("mousedown", (e) => e.preventDefault()); // the cursor stays in the field
  b.addEventListener("click", () => {
    inp.value = "";
    inp.dispatchEvent(new Event("input", { bubbles: true })); // the page searches again
    inp.focus();
  });
  sync();
}

export function initSearchClear() {
  let timer = 0;
  const scan = () => {
    timer = 0;
    document.querySelectorAll(SEL).forEach(wire);
  };
  scan();
  new MutationObserver(() => {
    if (!timer) timer = setTimeout(scan, 150);
  }).observe(document.body, { childList: true, subtree: true });
}
