// Frame-exact positions in a video. A <video> has no frame numbers, so they are worked out from the frame rate:
// frame n is on screen from n / fps to (n + 1) / fps. Used by the player (frame by frame) and the marker editor.

// The frame rate Stash found in the file (30 when it didn't)
export function fpsOf(scene) {
  const r = scene && scene.files && scene.files[0] && scene.files[0].frame_rate;
  return r > 1 && r < 1000 ? r : 30;
}

// Times are kept to the millisecond (see secOf), so a time just below a frame's start still counts as that frame
export const frameAt = (sec, fps) => Math.floor((Math.max(0, sec) + 0.0006) * fps);
export const secOf = (n, fps) => Math.round((Math.max(0, n) / fps) * 1000) / 1000;
// The start of the frame that is on screen at this time
export const snap = (sec, fps) => secOf(frameAt(sec, fps), fps);

// Shows frame n: seeks to its middle, because a seek to the exact start can land on the frame before
export function showFrame(video, n, fps) {
  const dur = video.duration;
  const last = Number.isFinite(dur) && dur > 0 ? Math.max(0, Math.ceil(dur * fps - 1e-3) - 1) : Infinity;
  const frame = Math.min(Math.max(0, n), last);
  video.currentTime = (frame + 0.5) / fps;
  return frame;
}

// One frame (or several) back or forward from where the video is; stops playback
export function stepFrame(video, fps, by) {
  video.pause();
  return showFrame(video, frameAt(video.currentTime, fps) + by, fps);
}

// 1:23.456 / 1:02:03.456 – every millisecond, unlike the player's whole seconds
export function fmtExact(sec) {
  sec = Math.max(0, sec || 0);
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  const f = String(ms % 1000).padStart(3, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}.${f}` : `${m}:${s}.${f}`;
}

// Keyframes of an MP4 / MOV file in seconds (rising), read from its index (the moov box) with a few range requests;
// null for other containers, fragmented MP4s or when the file can't be read. A jump to a keyframe shows at once; a jump
// between two makes the browser decode everything from the one before – with 4K and keyframes seconds apart that takes
// up to a second, which is why players like KMP jump to keyframes.
export async function keyframesOf(url) {
  try {
    const get = async (from, len) => {
      const r = await fetch(url, { headers: { Range: `bytes=${from}-${from + len - 1}` }, credentials: "same-origin" });
      if (r.status !== 206) return null; // no ranges: the whole file would come
      return new DataView(await r.arrayBuffer());
    };
    // Top-level boxes (ftyp, mdat, moov …): moov is at the start or after the media data
    let at = 0;
    let d = null;
    for (let i = 0; i < 16 && !d; i++) {
      const h = await get(at, 16);
      if (!h || h.byteLength < 8) return null;
      const type = boxType(h, 4);
      if (i === 0 && type !== "ftyp") return null;
      let size = h.getUint32(0);
      if (size === 1 && h.byteLength >= 16) size = Number(h.getBigUint64(8));
      if (type === "moov") {
        if (size > 64 << 20) return null;
        d = await get(at, size);
      } else if (size < 8) return null;
      at += size;
    }
    if (!d) return null;
    const moov = { start: d.getUint32(0) === 1 ? 16 : 8, end: d.byteLength };
    const mvhd = child(d, moov, "mvhd");
    const movieScale = mvhd && d.getUint32(mvhd.start + (d.getUint8(mvhd.start) === 1 ? 20 : 12));
    for (const trak of boxes(d, moov.start, moov.end)) {
      if (trak.type !== "trak") continue;
      const hdlr = path(d, trak, "mdia", "hdlr");
      if (!hdlr || boxType(d, hdlr.start + 8) !== "vide") continue;
      const mdhd = path(d, trak, "mdia", "mdhd");
      const stbl = path(d, trak, "mdia", "minf", "stbl");
      const stss = stbl && child(d, stbl, "stss");
      const stts = stbl && child(d, stbl, "stts");
      if (!mdhd || !stss || !stts) return null; // no sync table: every frame is a keyframe (or a fragmented file)
      const scale = d.getUint32(mdhd.start + (d.getUint8(mdhd.start) === 1 ? 20 : 12));
      // Edit list: empty edits delay the start, the first real one says where in the track the movie begins
      let shift = 0;
      let mediaStart = 0;
      const elst = path(d, trak, "edts", "elst");
      if (elst) {
        const v1 = d.getUint8(elst.start) === 1;
        const n = d.getUint32(elst.start + 4);
        for (let i = 0, o = elst.start + 8; i < n; i++, o += v1 ? 20 : 12) {
          const len = v1 ? Number(d.getBigUint64(o)) : d.getUint32(o);
          const mt = v1 ? Number(d.getBigInt64(o + 8)) : d.getInt32(o + 4);
          if (mt !== -1) {
            mediaStart = mt;
            break;
          }
          if (movieScale) shift += len / movieScale;
        }
      }
      // Decode time and composition offset of sample n (1-based, asked in rising order) from the run tables
      const runs = (b, add) => {
        const count = b ? d.getUint32(b.start + 4) : 0;
        let run = 0;
        let first = 1;
        let sum = 0;
        return (n) => {
          while (run < count) {
            const o = b.start + 8 + 8 * run;
            const cnt = d.getUint32(o);
            const val = d.getInt32(o + 4);
            if (n < first + cnt) return add ? sum + (n - first) * val : val;
            first += cnt;
            sum += cnt * val;
            run++;
          }
          return null;
        };
      };
      const dtsOf = runs(stts, true);
      const ctts = child(d, stbl, "ctts");
      const offOf = ctts ? runs(ctts, false) : () => 0;
      const keys = [];
      for (let i = 0, n = d.getUint32(stss.start + 4); i < n; i++) {
        const sample = d.getUint32(stss.start + 8 + 4 * i);
        const dts = dtsOf(sample);
        if (dts == null) break;
        keys.push(Math.round(((dts + (offOf(sample) || 0) - mediaStart) / scale + shift) * 1000) / 1000);
      }
      return keys.length > 1 ? keys.sort((a, b) => a - b) : null;
    }
    return null;
  } catch {
    return null;
  }
}

const boxType = (d, o) => String.fromCharCode(d.getUint8(o), d.getUint8(o + 1), d.getUint8(o + 2), d.getUint8(o + 3));
function* boxes(d, from, to) {
  for (let o = from; o + 8 <= to; ) {
    let size = d.getUint32(o);
    let head = 8;
    if (size === 1) (size = Number(d.getBigUint64(o + 8))), (head = 16);
    else if (size === 0) size = to - o;
    if (size < head) return;
    yield { type: boxType(d, o + 4), start: o + head, end: Math.min(o + size, to) };
    o += size;
  }
}
function child(d, box, type) {
  for (const b of boxes(d, box.start, box.end)) if (b.type === type) return b;
  return null;
}
const path = (d, box, ...types) => types.reduce((b, type) => b && child(d, b, type), box);
