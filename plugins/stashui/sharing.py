"""Stash UI – "Sharing": people you gave a link to can send you photos, videos and messages.

Started by backend.py (mode share_status / share_stop). Two small web servers run in this one process:

* the PUBLIC port (the one you make reachable, e.g. with a Tailscale Funnel) answers only the paths that belong to a
  sharing link – /s/<token> (a simple page), /api/hello, /api/send and /api/msg. Every request needs a valid, switched-on,
  not expired link token. Nothing else of your PC or your Stash is reachable through it.
* the same public port also serves WATCH links: /w/<token> (a plain page with a video player – works in any browser, no Stash UI
  needed) and /w/<token>/video.<ext> (the one video file that link was made for, with range requests). A watch link can
  expire, be limited to a number of viewers, be switched off or deleted. Only that one file is reachable through it.
* the ADMIN port is for your own Stash UI (every request needs the random admin token that was made at start).
  Put only the public port on the internet, never the admin port.

What arrives is NEVER put into your library by itself: files go to an inbox folder next to this plugin's data and wait there
until you accept (they are then moved into a library folder) or reject (deleted) them. Only photo and video file types
are taken, tag rules (liked / not wanted) are checked when a file arrives, senders can be blocked, and size and number
limits apply. Settings, links, the inbox list and messages are kept in files in the data folder.

    python sharing.py <public port> <admin port> <admin token> <data folder>
"""

import collections
import hmac
import http.server
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse

VERSION = 3
PUBLIC_PORT = int(sys.argv[1])
ADMIN_PORT = int(sys.argv[2])
ADMIN_TOKEN = sys.argv[3]
DATA = sys.argv[4]
INBOX = os.path.join(DATA, "inbox")
WATCHDIR = os.path.join(DATA, "watch")  # the smaller copies made for watch links

IMG = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".avif", ".bmp"}
VID = {".mp4", ".m4v", ".mov", ".3gp", ".webm", ".mkv", ".avi", ".mpg", ".mpeg", ".wmv", ".flv", ".ts"}
MIME = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
    ".heic": "image/heic", ".heif": "image/heif", ".avif": "image/avif", ".bmp": "image/bmp",
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".3gp": "video/3gpp", ".webm": "video/webm",
    ".mkv": "video/x-matroska", ".avi": "video/x-msvideo", ".mpg": "video/mpeg", ".mpeg": "video/mpeg",
    ".wmv": "video/x-ms-wmv", ".flv": "video/x-flv", ".ts": "video/mp2t",
}
RESERVED = {"con", "prn", "aux", "nul"} | {f"com{i}" for i in range(1, 10)} | {f"lpt{i}" for i in range(1, 10)}
MB = 1024 * 1024

DEFAULTS = {
    "name": "", "avatar": "", "about": "",
    "likes": [], "dislikes": [], "requireLiked": True,
    "receiving": True, "chat": True,
    "maxFileMB": 2048, "maxInboxGB": 10, "perSenderPerDay": 100,
    "baseUrl": "",
    "links": [], "blocked": [],
}

lock = threading.RLock()
busy = {"n": 0}
hits = collections.defaultdict(collections.deque)


# ---------- files ----------

def path_of(name):
    return os.path.join(DATA, name)


def read_json(name, default):
    try:
        with open(path_of(name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(name, obj):
    tmp = path_of(name) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, path_of(name))


def load_config():
    c = read_json("config.json", {})
    out = {k: (list(v) if isinstance(v, list) else v) for k, v in DEFAULTS.items()}
    if isinstance(c, dict):
        for k in DEFAULTS:
            if k in c and type(c[k]) is type(DEFAULTS[k]):
                out[k] = c[k]
    return out


cfg = load_config()
inbox = [x for x in read_json("inbox.json", []) if isinstance(x, dict) and os.path.exists(os.path.join(INBOX, str(x.get("file", ""))))]
messages = read_json("messages.json", [])
watches = [w for w in read_json("watch.json", []) if isinstance(w, dict) and w.get("token") and (w.get("path") or w.get("src"))]
for _w in watches:  # a smaller copy that was being made when the receiver stopped isn't finished: the link says so
    if (_w.get("prep") or {}).get("state") in ("queued", "running"):
        _w["prep"] = {"state": "failed", "pct": 0, "q": _w["prep"].get("q", 0), "why": "interrupted"}
jobs = {}  # watch id → the running ffmpeg
prep_lock = threading.Semaphore(1)  # one smaller copy at a time
viewers = {}  # (watch id, ip) → when it last asked: the same viewer counts once per half hour
streams = {"n": 0}  # videos being sent right now
MAX_STREAMS = 6
sentlog = collections.deque()  # (time, who) of every accepted file – for the daily limit per sender


def save_cfg():
    write_json("config.json", cfg)


def save_inbox():
    write_json("inbox.json", inbox)


def save_messages():
    write_json("messages.json", messages[-1000:])


def save_watches():
    write_json("watch.json", watches)


# ---------- cleaning ----------

def txt(s, n):
    return re.sub(r"[\x00-\x1f\x7f]", " ", str(s if s is not None else "")).strip()[:n]


def tag_key(s):
    return re.sub(r"\s+", " ", txt(s, 60)).lower()


def tag_list(v, limit=40):
    out, seen = [], set()
    for x in v if isinstance(v, list) else []:
        t = re.sub(r"\s+", " ", txt(x, 60))
        k = t.lower()
        if t and k not in seen:
            seen.add(k)
            out.append(t)
        if len(out) >= limit:
            break
    return out


def clean_avatar(a):
    a = str(a or "")
    return a if re.fullmatch(r"data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+", a) and len(a) < 70000 else ""


def clean_url(u):
    u = str(u or "").strip().rstrip("/")
    return u[:200] if re.fullmatch(r"https?://[^\s/?#]+(/[^\s?#]*)?", u) else ""


def clean_reply(u):
    u = str(u or "").strip()
    return u[:300] if re.fullmatch(r"https?://[^\s/?#]+(/[^\s?#]*)?/s/[A-Za-z0-9_-]{8,64}", u) else ""


def clean_name(raw):
    name = os.path.basename(urllib.parse.unquote(raw or "").replace("\\", "/"))
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    stem, ext = os.path.splitext(name)
    if stem.lower() in RESERVED:
        stem = "_" + stem
    return (stem[:120] or "file") + ext.lower()


def clean_dir(raw):
    d = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", txt(raw, 40)).strip(" .")
    return d if d and d.lower() not in RESERVED else "Unknown"


def unique_path(folder, name):
    stem, ext = os.path.splitext(name)
    p = os.path.join(folder, name)
    n = 2
    while os.path.exists(p):
        p = os.path.join(folder, f"{stem} ({n}){ext}")
        n += 1
    return p


# ---------- watch links ----------

def find_watch(token):
    token = str(token or "")
    for w in watches:
        if hmac.compare_digest(str(w["token"]).encode(), token.encode()):
            return w
    return None


def watch_state(w):
    if not w.get("enabled", True):
        return "paused"
    if w.get("expires") and w["expires"] < time.time():
        return "expired"
    ps = (w.get("prep") or {}).get("state")
    if ps in ("queued", "running"):
        return "preparing"
    if ps == "failed":
        return "failed"
    if not w.get("path") or not os.path.isfile(w["path"]):
        return "missing"
    return "ok"


# Quality of a smaller copy: height, video kbit/s (the most the viewer needs from your upload, plus 96 kbit/s sound)
QUALITY = {720: 2500, 480: 1200, 360: 700}


def encode_watch(w, ffmpeg, duration):
    """Make the smaller copy of a watch link's video (own thread, one at a time, low priority); the link starts to work when done."""
    pr = w["prep"]
    q = pr["q"]
    out = os.path.join(WATCHDIR, w["id"] + ".mp4")
    part = os.path.join(WATCHDIR, w["id"] + ".part.mp4")
    tail = []
    try:
        with prep_lock:
            if w not in watches:
                return
            pr["state"] = "running"
            os.makedirs(WATCHDIR, exist_ok=True)
            kb = QUALITY[q]
            cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-progress", "pipe:1", "-nostats", "-i", w["src"], "-map", "0:v:0", "-map", "0:a:0?",
                   "-vf", f"scale=-2:'min({q},ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", f"{kb}k", "-bufsize", f"{kb * 2}k",
                   "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", "-f", "mp4", part]
            flags = (0x08000000 | 0x00004000) if os.name == "nt" else 0  # no window, below normal priority
            proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", creationflags=flags)
            jobs[w["id"]] = proc
            for line in proc.stdout:
                line = line.strip()
                if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
                    try:
                        us = int(line.split("=", 1)[1])
                    except ValueError:
                        continue
                    if duration > 0:
                        pr["pct"] = max(0, min(99, int(us / 1e6 / duration * 100)))
                elif "=" not in line and line:
                    tail.append(line)
                    del tail[:-6]
            rc = proc.wait()
        jobs.pop(w["id"], None)
        if w not in watches:  # deleted meanwhile
            raise OSError("deleted")
        if rc != 0 or not os.path.isfile(part) or os.path.getsize(part) < 1024:
            raise RuntimeError(" ".join(tail)[-200:] or "ffmpeg stopped")
        os.replace(part, out)
        src_ext = os.path.splitext(w["src"])[1].lower()
        final, ext = out, ".mp4"
        if src_ext in (".mp4", ".m4v", ".webm") and os.path.getsize(out) >= os.path.getsize(w["src"]):
            os.remove(out)  # the video is small already: the copy would be bigger – the original goes out as it is
            final, ext = w["src"], src_ext
        with lock:
            w["path"] = final
            w["ext"] = ext
            w["size"] = os.path.getsize(final)
            pr["state"] = "done"
            pr["pct"] = 100
            save_watches()
    except Exception as e:  # noqa: BLE001
        jobs.pop(w["id"], None)
        for f in (part, out):  # (only the copies made here – never the original video, nor a copy that is already in use)
            if f == out and w.get("path") == out:
                continue
            try:
                os.remove(f)
            except OSError:
                pass
        with lock:
            if w in watches:
                pr["state"] = "failed"
                pr["why"] = txt(e, 200)
                save_watches()


def pub_watch(w):
    st = watch_state(w)
    if st == "ok" and w.get("maxViews") and w.get("views", 0) >= w["maxViews"]:
        st = "full"
    return {"id": w["id"], "token": w["token"], "title": w.get("title", ""), "ext": w.get("ext", ""), "size": w.get("size", 0), "scene": w.get("scene", ""),
            "created": w.get("created"), "expires": w.get("expires"), "enabled": w.get("enabled", True), "maxViews": w.get("maxViews", 0),
            "views": w.get("views", 0), "last": w.get("last"), "state": st, "quality": (w.get("prep") or {}).get("q", 0),
            "prep": {"state": (w.get("prep") or {}).get("state", ""), "pct": (w.get("prep") or {}).get("pct", 0), "why": (w.get("prep") or {}).get("why", "")}}


def viewer_ok(w, ip):
    """Does this viewer get in? The first request of a viewer in half an hour counts as one view; a limit stops new viewers only."""
    now = time.time()
    with lock:
        key = (w["id"], ip)
        seen = viewers.get(key)
        if seen and now - seen < 1800:
            viewers[key] = now
            return True
        if w.get("maxViews") and w.get("views", 0) >= w["maxViews"]:
            return False
        w["views"] = w.get("views", 0) + 1
        w["last"] = now
        viewers[key] = now
        save_watches()
        return True


def html_escape(x):
    return str(x).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


WATCH_NOTE = {
    "paused": "This link is switched off.", "expired": "This link has expired.", "missing": "This video isn't available any more.",
    "full": "This link has reached its number of viewers.", "preparing": "This video is being prepared – please try again in a few minutes.", "failed": "This video couldn't be prepared.", "invalid": "This link isn't valid.", "busy": "Too many people are watching right now – try again in a minute.",
}


def note_page(kind):
    return ("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><meta name=robots content=noindex>"
            "<title>Video</title><body style='margin:0;background:#0b0710;color:#e9e1ec;font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center;padding:20px'>"
            "<p>" + html_escape(WATCH_NOTE.get(kind, WATCH_NOTE["invalid"])) + "</p>")


WATCH_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>__TITLE__</title>
<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{background:radial-gradient(1200px 700px at 20% -10%,#3a1236 0%,#150a18 55%,#0b0710 100%) fixed;color:#f1e8f3;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column;align-items:center;padding:20px 14px 28px}
main{width:100%;max-width:1100px}
h1{font-size:18px;font-weight:650;margin:2px 4px 12px;overflow-wrap:anywhere}
.box{background:#000;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px -20px rgba(0,0,0,.8),0 0 0 1px rgba(255,255,255,.08)}
video{display:block;width:100%;max-height:82vh;background:#000}
.miss{display:none;padding:22px;text-align:center;color:#d8cadb}
.miss a{color:#ff7ab3}
p.f{margin:12px 4px 0;color:#9d8fa3;font-size:13px}
</style></head><body><main>
<h1>__TITLE__</h1>
<div class="box"><video id="v" controls playsinline preload="metadata"></video>
<div class="miss" id="m">Your browser can't play this video file. <a id="d" href="#" download>Download it</a> and open it with a video player.</div></div>
<p class="f">__NOTE__</p></main>
<script>
(function(){var p=location.pathname;while(p.length>1&&p.charAt(p.length-1)==="/")p=p.slice(0,-1);var base=p+"/video__EXT__",v=document.getElementById("v");
v.src=base;v.addEventListener("error",function(){document.getElementById("d").href=base;document.getElementById("m").style.display="block";v.style.display="none"});})();
</script></body></html>"""


def stream_file(h, path, mime, cors=True):
    """Send a file (or a part of it: Range) – the same for the admin and the watch links."""
    size = os.path.getsize(path)
    start, end, status = 0, size - 1, 200
    m = re.fullmatch(r"bytes=(\d*)-(\d*)", h.headers.get("Range", "") or "")
    if m and (m.group(1) or m.group(2)):
        if m.group(1):
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
        else:
            start = max(0, size - int(m.group(2)))
        end = min(end, size - 1)
        if start > end:
            h.send_response(416)
            h.send_header("Content-Range", f"bytes */{size}")
            h.send_header("Content-Length", "0")
            h.end_headers()
            return
        status = 206
    h.send_response(status)
    h.send_header("Content-Type", mime)
    h.send_header("Content-Length", str(end - start + 1))
    h.send_header("Accept-Ranges", "bytes")
    if status == 206:
        h.send_header("Content-Range", f"bytes {start}-{end}/{size}")
    h.send_header("X-Content-Type-Options", "nosniff")
    h.send_header("X-Robots-Tag", "noindex, nofollow")
    h.send_header("Cache-Control", "private, no-store")
    h.send_header("Content-Disposition", "inline")
    if cors:
        h.send_header("Access-Control-Allow-Origin", "*")
        h.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
    h.end_headers()
    if h.command == "HEAD":
        return
    try:
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1 << 20, left))
                if not chunk:
                    break
                h.wfile.write(chunk)
                left -= len(chunk)
    except (OSError, ConnectionError):
        h.close_connection = True


# ---------- rules ----------

def link_state(link):
    if not link.get("enabled", True):
        return "paused"
    if link.get("expires") and link["expires"] < time.time():
        return "expired"
    return "ok"


def find_link(token):
    token = str(token or "")
    for link in cfg["links"]:
        if hmac.compare_digest(str(link["token"]).encode(), token.encode()):
            return link
    return None


def is_blocked(sid, ip):
    for b in cfg["blocked"]:
        if (sid and b.get("sid") == sid) or (ip and b.get("ip") == ip):
            return True
    return False


def tag_reason(tags):
    have = {tag_key(t) for t in tags}
    bad = [t for t in cfg["dislikes"] if tag_key(t) in have]
    if bad:
        return "tag not wanted: " + ", ".join(bad[:3])
    if cfg["requireLiked"] and cfg["likes"] and not (have & {tag_key(t) for t in cfg["likes"]}):
        return "no tag the receiver likes"
    return ""


def over(key, n, per):
    now = time.time()
    d = hits[key]
    while d and d[0] < now - per:
        d.popleft()
    return len(d) >= n


def hit(key):
    hits[key].append(time.time())


def inbox_bytes():
    return sum(int(x.get("size", 0)) for x in inbox)


def client_ip(h):
    for k in ("Cf-Connecting-Ip", "X-Forwarded-For", "X-Real-Ip"):
        v = h.headers.get(k)
        if v:
            return txt(v.split(",")[0], 64)
    return h.client_address[0]


def block_ip(ip):
    return None if not ip or ip.startswith("127.") or ip == "::1" else ip


def public_profile(link):
    return {
        "ok": True, "v": VERSION, "name": cfg["name"] or "Someone", "avatar": cfg["avatar"], "about": cfg["about"],
        "likes": cfg["likes"], "dislikes": cfg["dislikes"], "requireLiked": cfg["requireLiked"],
        "maxFileMB": cfg["maxFileMB"], "chat": cfg["chat"], "expires": link.get("expires"),
    }


# ---------- the simple page behind a link ----------

PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Send files</title>
<style>
:root{color-scheme:dark light;--bg:#14101a;--card:#1f1927;--text:#f4eef8;--dim:#a99db6;--pink:#ff4d9d;--ok:#3ecf8e;--err:#ff6b6b}
@media (prefers-color-scheme:light){:root{--bg:#faf6fc;--card:#fff;--text:#231a2b;--dim:#6f6379}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:18px 16px 28px;max-width:640px;margin:auto}
h1{font-size:22px;margin:4px 0 2px}p{margin:6px 0;color:var(--dim)}
.who{display:flex;gap:14px;align-items:center;margin:8px 0 14px}.who img,.who i{width:64px;height:64px;border-radius:50%;object-fit:cover;background:var(--card);flex:none}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0}.chips b{font-weight:600;font-size:13px;padding:3px 9px;border-radius:99px;background:var(--card)}.chips.like b{color:var(--ok)}.chips.no b{color:var(--err)}
label.f{display:block;margin:12px 0 4px;color:var(--dim);font-size:14px}input[type=text]{width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--dim);background:var(--card);color:var(--text);font-size:16px}
.pick{display:flex;align-items:center;justify-content:center;margin:16px 0;padding:20px 16px;border-radius:16px;background:var(--pink);color:#fff;font-weight:700;font-size:18px;width:100%}
input[type=file]{display:none}.list{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.r{background:var(--card);border-radius:12px;padding:10px 12px}.r b{display:block;font-weight:600;word-break:break-all;font-size:14.5px}.r small{color:var(--dim)}
.bar{height:6px;border-radius:3px;background:rgba(128,128,128,.25);margin-top:8px;overflow:hidden}.bar i{display:block;height:100%;width:0;background:var(--pink)}
.r.done .bar i{background:var(--ok)}.r.err .bar i{background:var(--err)}.r.err small{color:var(--err)}
</style></head><body>
<div class="who"><i id="av"></i><div><h1 id="name">…</h1><p id="about"></p></div></div>
<div id="info"></div>
<div id="form" hidden>
<label class="f" id="l-me"></label><input type="text" id="me" maxlength="40" autocomplete="nickname">
<label class="f" id="l-tags"></label><input type="text" id="tags" placeholder="tag1, tag2">
<label class="pick"><span id="t-pick"></span><input id="file" type="file" multiple accept="image/*,video/*"></label>
</div>
<div class="list" id="list"></div>
<script>
(function(){
var K=location.pathname.split("/").pop(), L=(navigator.language||"en").slice(0,2);
var T={en:{pick:"Choose photos / videos",me:"Your name",tags:"Tags of what you send (comma separated)",like:"Likes",no:"Does not want",gone:"This link is not valid, expired or switched off.",up:"uploading",done:"done",fail:"failed"},
 de:{pick:"Fotos / Videos auswählen",me:"Dein Name",tags:"Tags der Dateien (mit Komma)",like:"Mag",no:"Möchte nicht",gone:"Dieser Link ist ungültig, abgelaufen oder abgeschaltet.",up:"lädt hoch",done:"fertig",fail:"fehlgeschlagen"}}[L]||null;
if(!T)T={pick:"Choose photos / videos",me:"Your name",tags:"Tags of what you send (comma separated)",like:"Likes",no:"Does not want",gone:"This link is not valid, expired or switched off.",up:"uploading",done:"done",fail:"failed"};
function $(i){return document.getElementById(i)}
var sid=localStorage.sid||(localStorage.sid=Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2));
$("l-me").textContent=T.me;$("l-tags").textContent=T.tags;$("t-pick").textContent=T.pick;$("me").value=localStorage.me||"";
function chips(cls,label,a){if(!a||!a.length)return;var p=document.createElement("p");p.textContent=label;var d=document.createElement("div");d.className="chips "+cls;a.forEach(function(t){var b=document.createElement("b");b.textContent=t;d.appendChild(b)});$("info").appendChild(p);$("info").appendChild(d)}
fetch("/api/hello?l="+encodeURIComponent(K)).then(function(r){return r.json()}).then(function(h){
  if(!h.ok){$("name").textContent="";$("about").textContent=T.gone;return}
  $("name").textContent=h.name;$("about").textContent=h.about||"";
  if(h.avatar){var im=document.createElement("img");im.src=h.avatar;$("av").replaceWith(im)}
  chips("like",T.like,h.likes);chips("no",T.no,h.dislikes);$("form").hidden=false;
}).catch(function(){$("about").textContent=T.gone});
function row(f){var e=document.createElement("div");e.className="r";e.innerHTML="<b></b><small></small><div class=bar><i></i></div>";e.querySelector("b").textContent=f.name;$("list").appendChild(e);return e}
function upload(f){
  var e=row(f),s=e.querySelector("small");s.textContent=T.up;
  var tags=$("tags").value.split(",").map(function(x){return x.trim()}).filter(Boolean);
  return new Promise(function(res){
    var r=new XMLHttpRequest();
    r.open("POST","/api/send?l="+encodeURIComponent(K)+"&name="+encodeURIComponent(f.name)+"&from="+encodeURIComponent($("me").value||"")+"&sid="+sid+"&tags="+encodeURIComponent(JSON.stringify(tags))+"&m="+(f.lastModified||0));
    r.upload.onprogress=function(x){if(x.lengthComputable){var p=Math.round(x.loaded/x.total*100);e.querySelector("i").style.width=p+"%";s.textContent=T.up+" "+p+"%"}};
    r.onload=function(){var d={};try{d=JSON.parse(r.responseText)}catch(x){}
      if(r.status===200){e.className="r done";e.querySelector("i").style.width="100%";s.textContent=T.done}
      else{e.className="r err";s.textContent=T.fail+" – "+(d.detail||d.error||r.status)}res()};
    r.onerror=function(){e.className="r err";s.textContent=T.fail;res()};
    r.send(f);
  });
}
$("file").onchange=function(e){localStorage.me=$("me").value;var fs=Array.prototype.slice.call(e.target.files);e.target.value="";
  (function next(){var f=fs.shift();if(f)upload(f).then(next)})()};
})();
</script></body></html>
"""


# ---------- public server ----------

class Public(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "StashUISharing"

    def log_message(self, *a):
        pass

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send_json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, status, body):
        body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def drain(self, length):
        # read a small unwanted body so the answer reaches the sender; a big one just closes the connection
        if 0 < length <= 64 * MB:
            left = length
            while left > 0:
                chunk = self.rfile.read(min(1 << 20, left))
                if not chunk:
                    break
                left -= len(chunk)
        else:
            self.close_connection = True

    def gate(self, token, ip):
        """The link for this token, or None after answering with the reason."""
        if over("bad:" + ip, 30, 60):
            self.send_json(429, {"error": "too many tries"})
            return None
        link = find_link(token)
        if not link:
            hit("bad:" + ip)
            self.send_json(404, {"ok": False, "error": "invalid"})
            return None
        st = link_state(link)
        if st != "ok":
            self.send_json(410 if st == "expired" else 423, {"ok": False, "error": st})
            return None
        if not cfg["receiving"]:
            self.send_json(423, {"ok": False, "error": "off"})
            return None
        return link

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        self.do_GET()

    def watch(self, token, video, ip):
        """/w/<token> (the page) and /w/<token>/video.<ext> (the file)."""
        if over("wreq:" + ip, 900, 60):
            return self.send_html(429, note_page("busy"))
        hit("wreq:" + ip)
        if over("bad:" + ip, 30, 60):
            return self.send_html(429, note_page("invalid"))
        w = find_watch(token)
        if not w:
            hit("bad:" + ip)
            return self.send_html(404, note_page("invalid"))
        st = watch_state(w)
        if st != "ok":
            return self.send_html(410 if st in ("expired", "missing", "failed") else 503 if st == "preparing" else 423, note_page(st))
        if not viewer_ok(w, ip):
            return self.send_html(410, note_page("full"))
        ext = w.get("ext") or ".mp4"
        if not video:
            body = WATCH_PAGE.replace("__TITLE__", html_escape(w.get("title") or "Video")).replace("__EXT__", ext).replace(
                "__NOTE__", "Shared with a link" + (" that stops working after a while." if w.get("expires") else "."))
            return self.send_html(200, body)
        with lock:
            if streams["n"] >= MAX_STREAMS:
                return self.send_html(503, note_page("busy"))
            streams["n"] += 1
        try:
            stream_file(self, w["path"], MIME.get(ext, "application/octet-stream"))
        finally:
            with lock:
                streams["n"] -= 1

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        q = urllib.parse.parse_qs(u.query)
        ip = client_ip(self)
        if u.path == "/":
            return self.send_html(200, "<!doctype html><meta charset=utf-8><p style='font:16px system-ui;padding:20px'>Stash UI sharing</p>")
        w = re.fullmatch(r"/w/([A-Za-z0-9_-]{8,64})(?:/(video)(\.[A-Za-z0-9]{1,5})?)?/?", u.path)
        if w:
            return self.watch(w.group(1), bool(w.group(2)), ip)
        m = re.fullmatch(r"/s/([A-Za-z0-9_-]{8,64})", u.path)
        if m:
            link = find_link(m.group(1))
            ok = link and link_state(link) == "ok" and cfg["receiving"]
            if not ok:
                hit("bad:" + ip)
                return self.send_html(404, "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><p style='font:16px system-ui;padding:20px'>This link is not valid, expired or switched off.</p>")
            return self.send_html(200, PAGE)
        if u.path == "/api/hello":
            if over("hello:" + ip, 120, 60):
                return self.send_json(429, {"error": "too many requests"})
            hit("hello:" + ip)
            link = self.gate(q.get("l", [""])[0], ip)
            if link:
                self.send_json(200, public_profile(link))
            return
        self.send_json(404, {"error": "unknown"})

    def do_POST(self):
        u = urllib.parse.urlsplit(self.path)
        q = urllib.parse.parse_qs(u.query)
        ip = client_ip(self)
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self.close_connection = True
            return self.send_json(411, {"error": "length required"})
        if u.path == "/api/msg":
            return self.post_msg(q, ip, length)
        if u.path == "/api/send":
            return self.post_file(q, ip, length)
        self.close_connection = True
        self.send_json(404, {"error": "unknown"})

    def post_msg(self, q, ip, length):
        if length > 16 * 1024:
            self.close_connection = True
            return self.send_json(413, {"error": "too long"})
        raw = self.rfile.read(length)
        link = self.gate(q.get("l", [""])[0], ip)
        if not link:
            return
        try:
            d = json.loads(raw.decode("utf-8"))
            if not isinstance(d, dict):
                raise ValueError
        except ValueError:
            return self.send_json(400, {"error": "bad message"})
        sid = txt(d.get("sid"), 40)
        if is_blocked(sid, block_ip(ip)):
            return self.send_json(403, {"error": "blocked"})
        if not cfg["chat"]:
            return self.send_json(423, {"ok": False, "error": "chat off"})
        text = str(d.get("text") or "").replace("\x00", "").strip()[:2000]
        if not text:
            return self.send_json(400, {"error": "empty"})
        if over("msg:" + (sid or ip), 30, 3600):
            return self.send_json(429, {"error": "too many messages"})
        hit("msg:" + (sid or ip))
        with lock:
            messages.append({"id": secrets.token_hex(6), "at": time.time(), "from": txt(d.get("from"), 40) or "Unknown", "sid": sid,
                             "ip": block_ip(ip), "reply": clean_reply(d.get("reply")), "link": link["id"], "text": text, "read": False})
            save_messages()
        self.send_json(200, {"ok": True})

    def post_file(self, q, ip, length):
        link = self.gate(q.get("l", [""])[0], ip)
        if not link:
            self.drain(length)
            return
        sid = txt(q.get("sid", [""])[0], 40)
        who = sid or ip
        frm = txt(q.get("from", [""])[0], 40) or "Unknown"
        name = clean_name(q.get("name", [""])[0])
        ext = os.path.splitext(name)[1]

        def refuse(status, error, detail=""):
            self.drain(length)
            self.send_json(status, {"error": error, "detail": detail or error})

        if is_blocked(sid, block_ip(ip)):
            return refuse(403, "blocked")
        if ext not in MIME:
            return refuse(415, "file type not accepted")
        if length <= 0:
            return refuse(400, "empty file")
        if length > cfg["maxFileMB"] * MB:
            return refuse(413, "too big", f"too big (max {cfg['maxFileMB']} MB)")
        try:
            tags = tag_list(json.loads(q.get("tags", ["[]"])[0]))
        except ValueError:
            tags = []
        reason = tag_reason(tags)
        if reason:
            return refuse(422, "tags", reason)
        now = time.time()
        while sentlog and sentlog[0][0] < now - 86400:
            sentlog.popleft()
        if sum(1 for _, w in sentlog if w == who) >= cfg["perSenderPerDay"]:
            return refuse(429, "limit", "daily limit reached")
        with lock:
            full = inbox_bytes() + length > cfg["maxInboxGB"] * 1024 * MB
        try:
            os.makedirs(INBOX, exist_ok=True)
            if full or shutil.disk_usage(INBOX).free < length + 500 * MB:
                return refuse(507, "inbox full", "the inbox is full")
        except OSError as e:
            return refuse(500, str(e))
        if busy["n"] >= 4:
            return refuse(429, "busy", "busy – try again in a moment")
        fid = secrets.token_hex(6)
        stored = fid + ext
        part = os.path.join(INBOX, stored + ".part")
        busy["n"] += 1
        try:
            left = length
            with open(part, "wb") as f:
                while left > 0:
                    chunk = self.rfile.read(min(1 << 20, left))
                    if not chunk:
                        raise ConnectionError("upload interrupted")
                    f.write(chunk)
                    left -= len(chunk)
            os.replace(part, os.path.join(INBOX, stored))
            item = {"id": fid, "name": name, "file": stored, "size": length, "from": frm, "sid": sid, "ip": block_ip(ip),
                    "reply": clean_reply(q.get("reply", [""])[0]), "tags": tags, "at": now, "link": link["id"],
                    "kind": "image" if ext in IMG else "video"}
            try:
                ms = int(q.get("m", ["0"])[0] or 0)
                if 946684800000 < ms < now * 1000 + 86400000:
                    item["mtime"] = ms / 1000.0
            except ValueError:
                pass
            with lock:
                inbox.append(item)
                save_inbox()
            sentlog.append((now, who))
            self.send_json(200, {"ok": True, "id": fid})
        except Exception as e:  # noqa: BLE001 – an interrupted upload leaves nothing behind
            try:
                os.remove(part)
            except OSError:
                pass
            self.close_connection = True
            try:
                self.send_json(500, {"error": str(e)})
            except OSError:
                pass
        finally:
            busy["n"] -= 1


# ---------- admin server (your own Stash UI) ----------

def move_item(item, folder):
    src = os.path.join(INBOX, item["file"])
    dest_dir = os.path.join(folder, clean_dir(item.get("from")))
    os.makedirs(dest_dir, exist_ok=True)
    dest = unique_path(dest_dir, clean_name(item.get("name")))
    shutil.move(src, dest)
    if item.get("mtime"):
        try:
            os.utime(dest, (item["mtime"], item["mtime"]))
        except OSError:
            pass
    return dest_dir


def drop_items(ids, delete=True):
    ids = set(ids)
    with lock:
        keep, gone = [], []
        for x in inbox:
            (gone if x["id"] in ids else keep).append(x)
        inbox[:] = keep
        save_inbox()
    if delete:
        for x in gone:
            try:
                os.remove(os.path.join(INBOX, x["file"]))
            except OSError:
                pass
    return gone


def admin_state():
    with lock:
        return {
            "v": VERSION, "config": cfg, "publicPort": PUBLIC_PORT,
            "inbox": [{k: v for k, v in x.items() if k not in ("file", "ip")} for x in inbox], "used": inbox_bytes(),
            "messages": messages[-400:],
            "watches": [pub_watch(w) for w in watches],
            "unread": sum(1 for m in messages if not m.get("read")),
        }


class Admin(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "StashUISharingAdmin"

    def log_message(self, *a):
        pass

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send_json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def authed(self, q):
        return hmac.compare_digest(q.get("k", [""])[0].encode(), ADMIN_TOKEN.encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        q = urllib.parse.parse_qs(u.query)
        if not self.authed(q):
            return self.send_json(403, {"error": "wrong token"})
        if u.path == "/admin/ping":
            return self.send_json(200, {"ok": True, "v": VERSION, "pid": os.getpid(), "publicPort": PUBLIC_PORT, "busy": busy["n"]})
        if u.path == "/admin/state":
            return self.send_json(200, admin_state())
        if u.path == "/admin/summary":
            with lock:
                return self.send_json(200, {"inbox": len(inbox), "unread": sum(1 for m in messages if not m.get("read"))})
        if u.path == "/admin/file":
            return self.send_file(q.get("id", [""])[0])
        self.send_json(404, {"error": "unknown"})

    def send_file(self, fid):
        with lock:
            item = next((x for x in inbox if x["id"] == fid), None)
        path = os.path.join(INBOX, item["file"]) if item else ""
        if not item or not os.path.isfile(path):
            return self.send_json(404, {"error": "gone"})
        size = os.path.getsize(path)
        start, end, status = 0, size - 1, 200
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", "") or "")
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            status = 206
        self.send_response(status)
        self.send_header("Content-Type", MIME.get(os.path.splitext(path)[1].lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "private, max-age=600")
        self.cors()
        self.end_headers()
        try:
            with open(path, "rb") as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(1 << 20, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (OSError, ConnectionError):
            self.close_connection = True

    def do_POST(self):
        u = urllib.parse.urlsplit(self.path)
        q = urllib.parse.parse_qs(u.query)
        if not self.authed(q):
            self.close_connection = True
            return self.send_json(403, {"error": "wrong token"})
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
            d = json.loads(self.rfile.read(min(length, 1 << 20)).decode("utf-8") or "{}") if length else {}
            if not isinstance(d, dict):
                raise ValueError("bad body")
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})
        try:
            out = self.route(u.path, d)
        except Exception as e:  # noqa: BLE001
            return self.send_json(500, {"error": str(e)})
        if out is None:
            return self.send_json(404, {"error": "unknown"})
        self.send_json(200, out)

    def route(self, path, d):
        if path == "/admin/stop":
            threading.Thread(target=lambda: (time.sleep(0.3), os._exit(0)), daemon=True).start()
            return {"ok": True}
        if path == "/admin/config":
            return self.set_config(d)
        if path == "/admin/link":
            return self.links(d)
        if path == "/admin/watch":
            return self.watch_action(d)
        if path == "/admin/inbox":
            return self.inbox_action(d)
        if path == "/admin/block":
            return self.block(d)
        if path == "/admin/msg":
            return self.msg_action(d)
        return None

    def set_config(self, d):
        with lock:
            if "name" in d:
                cfg["name"] = txt(d["name"], 40)
            if "about" in d:
                cfg["about"] = txt(d["about"], 160)
            if "avatar" in d:
                cfg["avatar"] = clean_avatar(d["avatar"])
            for k in ("likes", "dislikes"):
                if k in d:
                    cfg[k] = tag_list(d[k])
            for k in ("requireLiked", "receiving", "chat"):
                if k in d:
                    cfg[k] = bool(d[k])
            for k, lo, hi in (("maxFileMB", 1, 20000), ("maxInboxGB", 1, 2000), ("perSenderPerDay", 1, 1000)):
                if k in d:
                    cfg[k] = max(lo, min(hi, int(float(d[k]))))
            if "baseUrl" in d:
                cfg["baseUrl"] = clean_url(d["baseUrl"])
            save_cfg()
        return {"ok": True, "config": cfg}

    def links(self, d):
        act = d.get("action")
        with lock:
            if act == "new":
                hours = d.get("hours")
                link = {"id": secrets.token_hex(4), "token": secrets.token_urlsafe(18), "label": txt(d.get("label"), 40),
                        "created": time.time(), "expires": time.time() + float(hours) * 3600 if hours else None, "enabled": True}
                cfg["links"].append(link)
            else:
                link = next((x for x in cfg["links"] if x["id"] == d.get("id")), None)
                if not link:
                    raise ValueError("no such link")
                if act == "set":
                    link["enabled"] = bool(d.get("enabled"))
                elif act == "rename":
                    link["label"] = txt(d.get("label"), 40)
                elif act == "del":
                    cfg["links"].remove(link)
                else:
                    raise ValueError("unknown action")
            save_cfg()
        return {"ok": True, "links": cfg["links"]}

    def watch_action(self, d):
        act = d.get("action")
        with lock:
            if act == "new":
                path = os.path.realpath(str(d.get("path") or ""))
                ext = os.path.splitext(path)[1].lower()
                if not os.path.isfile(path) or ext not in VID:
                    raise ValueError("that isn't a video file")
                if len(watches) >= 300:
                    raise ValueError("too many watch links – delete some")
                hours = d.get("hours")
                q = int(d.get("quality") or 0)
                if q and q not in QUALITY:
                    raise ValueError("unknown quality")
                ff = str(d.get("ffmpeg") or "")
                if q and not os.path.isfile(ff):
                    raise ValueError("ffmpeg not found")
                w = {"id": secrets.token_hex(4), "token": secrets.token_urlsafe(18), "title": txt(d.get("title"), 80) or "Video", "path": "" if q else path, "src": path,
                     "ext": ".mp4" if q else ext, "size": 0 if q else os.path.getsize(path), "scene": txt(d.get("scene"), 20), "created": time.time(),
                     "expires": time.time() + float(hours) * 3600 if hours else None, "enabled": True,
                     "maxViews": max(0, min(100000, int(float(d.get("maxViews") or 0)))), "views": 0, "last": None}
                if q:
                    w["prep"] = {"state": "queued", "pct": 0, "q": q}
                watches.append(w)
                if q:
                    threading.Thread(target=encode_watch, args=(w, ff, float(d.get("duration") or 0)), daemon=True).start()
            else:
                w = next((x for x in watches if x["id"] == d.get("id")), None)
                if not w:
                    raise ValueError("no such link")
                if act == "set":
                    w["enabled"] = bool(d.get("enabled"))
                elif act == "rename":
                    w["title"] = txt(d.get("title"), 80) or "Video"
                elif act == "extend":
                    hours = d.get("hours")
                    w["expires"] = time.time() + float(hours) * 3600 if hours else None
                    if d.get("maxViews") is not None:
                        w["maxViews"] = max(0, min(100000, int(float(d.get("maxViews") or 0))))
                elif act == "del":
                    watches.remove(w)
                    job = jobs.pop(w["id"], None)
                    if job:
                        try:
                            job.kill()
                        except OSError:
                            pass
                    for f in (os.path.join(WATCHDIR, w["id"] + ".mp4"), os.path.join(WATCHDIR, w["id"] + ".part.mp4")):  # the smaller copy goes with the link
                        try:
                            os.remove(f)
                        except OSError:
                            pass
                else:
                    raise ValueError("unknown action")
            save_watches()
        return {"ok": True, "watches": [pub_watch(x) for x in watches], "link": pub_watch(w) if act == "new" else None}

    def inbox_action(self, d):
        ids = [str(i) for i in d.get("ids", [])]
        act = d.get("action")
        if act == "reject":
            return {"ok": True, "removed": len(drop_items(ids))}
        if act == "move":
            folder = str(d.get("folder") or "")
            if not folder or not os.path.isabs(folder):
                raise ValueError("no folder")
            moved, failed, dirs = 0, 0, set()
            with lock:
                items = [x for x in inbox if x["id"] in set(ids)]
            done = []
            for x in items:
                try:
                    dirs.add(move_item(x, folder))
                    done.append(x["id"])
                    moved += 1
                except OSError:
                    failed += 1
            drop_items(done, delete=False)
            return {"ok": True, "moved": moved, "failed": failed, "dirs": sorted(dirs), "folder": folder}
        raise ValueError("unknown action")

    def block(self, d):
        act = d.get("action")
        with lock:
            if act == "block":
                item = next((x for x in inbox if x["id"] == d.get("id")), None) or next((m for m in messages if m["id"] == d.get("id")), None)
                if not item:
                    raise ValueError("nothing to block")
                sid, ip = item.get("sid") or "", item.get("ip")
                if not sid and not ip:
                    raise ValueError("this sender can't be recognised")
                cfg["blocked"].append({"sid": sid, "ip": ip, "name": item.get("from", ""), "at": time.time()})
                save_cfg()
                gone = [x["id"] for x in inbox if (sid and x.get("sid") == sid) or (ip and x.get("ip") == ip)]
            elif act == "unblock":
                cfg["blocked"] = [b for i, b in enumerate(cfg["blocked"]) if i != int(d.get("index", -1))]
                save_cfg()
                gone = []
            else:
                raise ValueError("unknown action")
        if gone:
            drop_items(gone)
        return {"ok": True, "removed": len(gone)}

    def msg_action(self, d):
        act = d.get("action")
        ids = set(str(i) for i in d.get("ids", []))
        with lock:
            if act == "read":
                for m in messages:
                    if m["id"] in ids or d.get("all"):
                        m["read"] = True
            elif act == "del":
                messages[:] = [m for m in messages if m["id"] not in ids]
            else:
                raise ValueError("unknown action")
            save_messages()
        return {"ok": True}


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def housekeeping():
    while True:
        time.sleep(300)
        for k in [k for k, d in list(hits.items()) if not d or d[-1] < time.time() - 3600]:
            hits.pop(k, None)
        for k in [k for k, t0 in list(viewers.items()) if t0 < time.time() - 1800]:
            viewers.pop(k, None)
        for f in os.listdir(INBOX) if os.path.isdir(INBOX) else []:  # leftovers of interrupted uploads
            p = os.path.join(INBOX, f)
            try:
                if f.endswith(".part") and time.time() - os.path.getmtime(p) > 3600:
                    os.remove(p)
            except OSError:
                pass


if __name__ == "__main__":
    os.makedirs(INBOX, exist_ok=True)
    threading.Thread(target=housekeeping, daemon=True).start()
    bind = os.environ.get("STASHUI_SHARE_BIND", "0.0.0.0")  # (tests set 127.0.0.1)
    admin = Server((bind, ADMIN_PORT), Admin)
    threading.Thread(target=admin.serve_forever, daemon=True).start()
    Server((bind, PUBLIC_PORT), Public).serve_forever()
