// The zipper: a handle at the edge of the lists. Pull it and the list scrolls – the further you pull, the faster; let go and it
// springs back and the list slows down. While it runs the thumbnails move (hourglass, zoom out, drum, blur – Settings → Lists and thumbnails).
// Only the rows that are on the screen are touched (a handful), with transforms only.

import { store } from "./ui.js";
import { t } from "./i18n.js";

const SPEEDS = { slow: 2500, normal: 6000, fast: 12000, turbo: 24000 }; // px per second when pulled all the way
const FX = ["hourglass", "zoom", "drum", "blur", "none"];

export function attachZipper(hang) {
  const root = document.createElement("div");
  root.className = "kb-zip";
  root.innerHTML = `<div class="kb-zip-track"></div><button type="button" class="kb-zip-knob" aria-label="${t("Pull to scroll fast")}"></button>`;
  document.body.appendChild(root);
  const knob = root.querySelector(".kb-zip-knob");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  const cfg = () => ({
    on: store.get("zipperOn", true) !== false,
    fx: reduced.matches ? "none" : FX.includes(store.get("zipperFx", "hourglass")) ? store.get("zipperFx", "hourglass") : "hourglass",
    speed: SPEEDS[store.get("zipperSpeed", "normal")] || SPEEDS.normal,
    side: store.get("zipperSide", "right") === "left" ? "left" : "right",
  });
  let c = cfg();
  const long = () => document.documentElement.scrollHeight > innerHeight * 1.6;
  const paint = () => {
    c = cfg();
    root.dataset.side = c.side;
    root.hidden = !c.on || !long();
  };
  paint();
  const onDisplay = () => paint();
  window.addEventListener("stash:display-changed", onDisplay);
  const ro = new ResizeObserver(paint);
  ro.observe(document.body);
  ro.observe(hang.el); // (the list grows while its pages load)
  window.addEventListener("resize", paint);

  // the rows (or cards) in view: found by position (the rows are in order), not by an observer – works in a hidden tab, too
  let kids = [...hang.rowsEl.children];
  const mo = new MutationObserver(() => {
    kids = [...hang.rowsEl.children];
    paint(); // (the list got longer)
  });
  mo.observe(hang.rowsEl, { childList: true });
  const inView = () => {
    const base = hang.el.getBoundingClientRect().top + scrollY;
    const lo = scrollY - 120;
    const hi = scrollY + innerHeight + 120;
    let a = 0;
    let z = kids.length;
    while (a < z) {
      const m = (a + z) >> 1;
      if (base + kids[m].offsetTop < lo - 700) a = m + 1;
      else z = m;
    }
    const out = [];
    for (let i = a; i < kids.length; i++) {
      const top = base + kids[i].offsetTop;
      if (top > hi) break;
      if (top + kids[i].offsetHeight >= lo) out.push(kids[i]);
    }
    return out;
  };

  let d = 0; // the handle, -1 … 1 (0 = rest)
  let v = 0; // scroll speed, px/s
  let e = 0; // effect strength, 0 … 1
  let drag = false;
  let raf = 0;
  let last = 0;
  const touched = new Set();

  const place = () => {
    const half = root.clientHeight / 2 - knob.offsetHeight / 2;
    knob.style.transform = `translateY(${(d * half).toFixed(1)}px)`;
  };

  function clearFx() {
    touched.forEach((u) => {
      u.style.transform = u.style.filter = u.style.opacity = u.style.willChange = "";
      u._ty = 0;
    });
    touched.clear();
    hang.rowsEl.style.pointerEvents = "";
  }

  function applyFx() {
    if (c.fx === "none" || e < 0.01) return clearFx();
    const vh = innerHeight;
    const list = inView();
    const now = new Set(list);
    // read first, write after
    const rects = list.map((u) => {
      const r = u.getBoundingClientRect();
      return { u, mid: r.top + r.height / 2 - (u._ty || 0) };
    });
    hang.rowsEl.style.pointerEvents = "none";
    for (const { u, mid } of rects) {
      const tt = Math.max(-1, Math.min(1, (mid - vh / 2) / (vh / 2))); // −1 top … 1 bottom of the screen
      const a = Math.abs(tt);
      let tf = "";
      let ty = 0;
      if (c.fx === "hourglass") {
        const s = 1 - e * 0.6 * (1 - Math.pow(a, 1.4)); // small in the middle, full size at the top and bottom
        tf = `scale(${s.toFixed(3)})`;
        u.style.opacity = (1 - e * 0.3 * (1 - a)).toFixed(2);
      } else if (c.fx === "zoom") {
        const s = 1 - e * 0.5; // the whole wall shrinks towards the middle of the screen
        ty = -(mid - vh / 2) * (1 - s);
        tf = `translateY(${ty.toFixed(1)}px) scale(${s.toFixed(3)})`;
      } else if (c.fx === "drum") {
        tf = `perspective(900px) rotateX(${(-tt * e * 55).toFixed(1)}deg) scale(${(1 - e * 0.18 * a).toFixed(3)})`;
        u.style.opacity = (1 - e * 0.35 * a).toFixed(2);
      } else if (c.fx === "blur") {
        u.style.filter = `blur(${(e * 7).toFixed(1)}px)`;
        u.style.opacity = (1 - e * 0.35).toFixed(2);
      }
      u._ty = ty;
      u.style.transform = tf;
      u.style.willChange = "transform";
      touched.add(u);
    }
    // rows that left the screen keep nothing
    touched.forEach((u) => {
      if (!now.has(u)) {
        u.style.transform = u.style.filter = u.style.opacity = u.style.willChange = "";
        u._ty = 0;
        touched.delete(u);
      }
    });
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    const target = drag ? Math.sign(d) * d * d * c.speed : 0;
    v += (target - v) * Math.min(1, dt * (drag ? 9 : 5));
    if (!drag) d += (0 - d) * Math.min(1, dt * 14);
    if (!drag && Math.abs(v) < 8) v = 0;
    if (v) window.scrollBy(0, v * dt);
    e += (Math.min(1, Math.abs(v) / (c.speed * 0.45)) - e) * Math.min(1, dt * 7);
    place();
    applyFx();
    if (drag || v || e > 0.01 || Math.abs(d) > 0.001) raf = requestAnimationFrame(frame);
    else {
      raf = 0;
      d = 0;
      place();
      clearFx();
    }
  }
  const run = () => {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };

  const setFromPointer = (ev) => {
    const r = root.getBoundingClientRect();
    const half = r.height / 2 - knob.offsetHeight / 2;
    d = Math.max(-1, Math.min(1, (ev.clientY - (r.top + r.height / 2)) / half));
  };
  knob.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    try {
      knob.setPointerCapture(ev.pointerId);
    } catch (err) { /* (no active pointer: fine) */ }
    drag = true;
    root.classList.add("is-drag");
    if (hang.stopPreview) hang.stopPreview();
    setFromPointer(ev);
    run();
  });
  knob.addEventListener("pointermove", (ev) => drag && setFromPointer(ev));
  const end = () => {
    if (!drag) return;
    drag = false;
    root.classList.remove("is-drag");
    run();
  };
  knob.addEventListener("pointerup", end);
  knob.addEventListener("pointercancel", end);
  knob.addEventListener("lostpointercapture", end);

  return {
    destroy() {
      drag = false;
      if (raf) cancelAnimationFrame(raf);
      clearFx();
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener("resize", paint);
      window.removeEventListener("stash:display-changed", onDisplay);
      root.remove();
    },
  };
}
