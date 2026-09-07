"""A small stand-in for YouTube Studio used by the engine tests.

It serves a content list, a video editor and a draft wizard that use the same
element names the real pages use, and it records every save and publish so a
test can check the outcome. Run it directly to click around in a browser:

    python tests/mock_studio.py            (prints the address)
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

CHANNEL = "UCmockchannel0000000000"

INITIAL_VIDEOS = [
    {"id": "aB3dE5fG7hI", "title": "Bulk Test 1", "status": "draft", "description": "", "audience": "", "tags": [], "playlists": []},
    {"id": "jK9lM1nO3pQ", "title": "Bulk Test 2", "status": "draft", "description": "", "audience": "", "tags": [], "playlists": []},
    {"id": "rS5tU7vW9xY", "title": "Holiday vlog DRAFT part 1", "status": "private", "description": "Old text", "audience": "not_for_kids", "tags": ["old"], "playlists": []},
    {"id": "zA1bC3dE5fG", "title": "Holiday vlog DRAFT part 2", "status": "private", "description": "", "audience": "not_for_kids", "tags": [], "playlists": []},
    {"id": "hI7jK9lM1nO", "title": "Cooking with grandma", "status": "public", "description": "Recipe inside", "audience": "not_for_kids", "tags": ["food"], "playlists": ["Recipes"]},
]
PLAYLISTS = ["Recipes", "Travel 2026", "Shorts"]
PAGE_SIZE_DEFAULT = 3

SHELL = """<!doctype html><html><head><meta charset="utf-8"><title>{title}</title>
<style>
body{{font-family:sans-serif;margin:0;background:#f9f9f9}} ytcp-app{{display:block}} ytcp-header{{display:block;background:#fff;padding:12px 20px;border-bottom:1px solid #ddd}}
ytcp-video-row{{display:grid;grid-template-columns:120px 1fr 120px 140px 80px;gap:10px;padding:10px 20px;border-bottom:1px solid #eee;align-items:center}}
ytcp-button,button{{display:inline-block;padding:6px 12px;border:1px solid #888;border-radius:4px;background:#fff;cursor:pointer;font:inherit}}
ytcp-button[disabled],button[disabled]{{opacity:.4;pointer-events:none}}
#textbox{{border:1px solid #aaa;padding:8px;min-height:20px;background:#fff}}
tp-yt-paper-radio-button{{display:inline-block;padding:6px 10px;border:1px solid #bbb;border-radius:20px;margin:4px;cursor:pointer}}
tp-yt-paper-radio-button[aria-checked="true"]{{background:#cde;border-color:#06c}}
tp-yt-paper-item{{display:block;padding:6px 12px;cursor:pointer}} tp-yt-paper-item:hover{{background:#eee}}
.popup{{position:absolute;background:#fff;border:1px solid #999;padding:12px;box-shadow:0 4px 12px rgba(0,0,0,.2)}}
ytcp-uploads-dialog{{display:block;position:fixed;inset:60px 120px;background:#fff;border:1px solid #999;padding:20px;overflow:auto}}
.hidden{{display:none !important}} .checkbox-label{{display:block;padding:6px;cursor:pointer}}
.checkbox-label[aria-checked="true"]{{background:#cde}}
ytcp-chip{{display:inline-block;border:1px solid #999;border-radius:12px;padding:2px 8px;margin:2px}}
</style></head><body><ytcp-app><ytcp-header>Mock YouTube Studio</ytcp-header>{body}</ytcp-app>
<script>{script}</script></body></html>"""

LIST_SCRIPT = """
const state = window.__mock = {page: 0, pageSize: %(page_size)d, videos: %(videos)s};
function render() {
  const start = state.page * state.pageSize;
  const rows = state.videos.slice(start, start + state.pageSize);
  document.getElementById('rows').innerHTML = rows.map(v => `
    <ytcp-video-row>
      <img src="/thumb/${v.id}.png" alt="">
      <div><a id="video-title" href="/video/${v.id}/edit">${v.title}</a><div id="description-text">${v.description}</div></div>
      <div class="tablecell-visibility">${v.status === 'draft' ? 'Draft <ytcp-button class="edit-draft">Edit draft</ytcp-button>' : v.status[0].toUpperCase() + v.status.slice(1)}</div>
      <div class="tablecell-date">7 Sep 2026<br>Uploaded</div>
      <div class="video-duration">0:02</div>
    </ytcp-video-row>`).join('');
  document.querySelectorAll('.edit-draft').forEach(b => b.addEventListener('click', e => { location.href = e.target.closest('ytcp-video-row').querySelector('a').getAttribute('href'); }));
  const pages = Math.ceil(state.videos.length / state.pageSize);
  document.getElementById('navigate-after').toggleAttribute('disabled', state.page >= pages - 1);
  document.getElementById('navigate-before').toggleAttribute('disabled', state.page === 0);
  document.getElementById('page-desc').textContent = `${start + 1}-${Math.min(start + state.pageSize, state.videos.length)} of ${state.videos.length}`;
  document.getElementById('page-size-label').textContent = `Rows per page: ${state.pageSize}`;
}
document.getElementById('navigate-after').addEventListener('click', () => { state.page++; render(); });
document.getElementById('navigate-before').addEventListener('click', () => { state.page--; render(); });
document.getElementById('page-size-trigger').addEventListener('click', () => document.getElementById('page-size-menu').classList.toggle('hidden'));
document.querySelectorAll('#page-size-menu tp-yt-paper-item').forEach(it => it.addEventListener('click', () => { state.pageSize = Number(it.textContent); state.page = 0; document.getElementById('page-size-menu').classList.add('hidden'); render(); }));
render();
"""

LIST_BODY = """
<div id="rows"></div>
<ytcp-table-footer style="display:flex;gap:20px;padding:12px 20px;align-items:center">
  <div id="page-size"><ytcp-dropdown-trigger id="page-size-trigger" style="cursor:pointer;border:1px solid #ccc;padding:4px 8px"><span id="page-size-label"></span></ytcp-dropdown-trigger>
    <div id="page-size-menu" class="popup hidden"><tp-yt-paper-item>10</tp-yt-paper-item><tp-yt-paper-item>30</tp-yt-paper-item><tp-yt-paper-item>50</tp-yt-paper-item></div></div>
  <span id="page-desc" class="page-description"></span>
  <ytcp-icon-button id="navigate-before"><button>&lt;</button></ytcp-icon-button>
  <ytcp-icon-button id="navigate-after"><button>&gt;</button></ytcp-icon-button>
</ytcp-table-footer>
"""

EDITOR_BODY = """
<ytcp-video-metadata-editor style="display:grid;grid-template-columns:2fr 1fr;gap:30px;padding:20px">
 <div id="basics">
  <ytcp-button id="save" disabled>Save</ytcp-button>
  <h3>Title</h3>
  <ytcp-social-suggestions-textbox id="title-textarea"><div id="textbox" contenteditable="true">%(title)s</div></ytcp-social-suggestions-textbox>
  <h3>Description</h3>
  <ytcp-social-suggestions-textbox id="description-textarea"><div id="textbox" contenteditable="true">%(description)s</div></ytcp-social-suggestions-textbox>
  <h3>Playlists</h3>
  <ytcp-video-metadata-playlists><ytcp-text-dropdown-trigger id="playlists-dropdown" style="border:1px solid #ccc;padding:6px;cursor:pointer">%(playlists_label)s</ytcp-text-dropdown-trigger></ytcp-video-metadata-playlists>
  <ytcp-playlist-dialog class="popup hidden"><ytcp-checkbox-group id="playlist-items"></ytcp-checkbox-group><ytcp-button id="done-button">Done</ytcp-button></ytcp-playlist-dialog>
  <h3>Audience</h3>
  <ytkc-made-for-kids-select>
    <tp-yt-paper-radio-button name="VIDEO_MADE_FOR_KIDS_MFK" aria-checked="%(kids_checked)s">Yes, it's made for kids</tp-yt-paper-radio-button>
    <tp-yt-paper-radio-button name="VIDEO_MADE_FOR_KIDS_NOT_MFK" aria-checked="%(not_kids_checked)s">No, it's not made for kids</tp-yt-paper-radio-button>
  </ytkc-made-for-kids-select>
  <div><ytcp-button id="toggle-button">Show more</ytcp-button></div>
  <div id="more" class="hidden">
    <h3>Tags</h3>
    <ytcp-free-text-chip-bar id="tags-container"><span id="chips"></span><input id="text-input" placeholder="Add tag"></ytcp-free-text-chip-bar>
  </div>
 </div>
 <ytcp-video-metadata-editor-sidepanel>
  <h3>Visibility</h3>
  <ytcp-video-metadata-visibility><ytcp-text-dropdown-trigger id="visibility-cell" style="border:1px solid #ccc;padding:6px;cursor:pointer">%(status_label)s</ytcp-text-dropdown-trigger></ytcp-video-metadata-visibility>
  <ytcp-video-visibility-select class="popup hidden">
    <div id="privacy-radios">
      <tp-yt-paper-radio-button name="PRIVATE">Private</tp-yt-paper-radio-button>
      <tp-yt-paper-radio-button name="UNLISTED">Unlisted</tp-yt-paper-radio-button>
      <tp-yt-paper-radio-button name="PUBLIC">Public</tp-yt-paper-radio-button>
    </div>
    <ytcp-button id="save-button">Done</ytcp-button>
  </ytcp-video-visibility-select>
 </ytcp-video-metadata-editor-sidepanel>
</ytcp-video-metadata-editor>
"""

EDITOR_SCRIPT = """
const video = %(video)s; const playlists = %(playlists)s; let dirty = false;
const save = document.getElementById('save');
const markDirty = () => { dirty = true; save.removeAttribute('disabled'); };
document.querySelectorAll('#textbox').forEach(t => t.addEventListener('input', markDirty));
// audience radios
document.querySelectorAll('ytkc-made-for-kids-select tp-yt-paper-radio-button').forEach(r => r.addEventListener('click', () => {
  document.querySelectorAll('ytkc-made-for-kids-select tp-yt-paper-radio-button').forEach(x => x.setAttribute('aria-checked', 'false'));
  r.setAttribute('aria-checked', 'true'); video.audience = r.getAttribute('name') === 'VIDEO_MADE_FOR_KIDS_MFK' ? 'for_kids' : 'not_for_kids'; markDirty();
}));
document.getElementById('toggle-button').addEventListener('click', () => { document.getElementById('more').classList.toggle('hidden'); document.getElementById('toggle-button').textContent = document.getElementById('more').classList.contains('hidden') ? 'Show more' : 'Show less'; });
// tags
const chips = document.getElementById('chips'); const tagInput = document.getElementById('text-input');
function renderChips() { chips.innerHTML = video.tags.map((t, i) => `<ytcp-chip>${t} <button id="delete-icon" data-i="${i}">x</button></ytcp-chip>`).join(''); chips.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { video.tags.splice(Number(b.dataset.i), 1); renderChips(); markDirty(); })); }
tagInput.addEventListener('input', () => { if (tagInput.value.includes(',')) { tagInput.value.split(',').map(s => s.trim()).filter(Boolean).forEach(t => video.tags.push(t)); tagInput.value = ''; renderChips(); markDirty(); } });
renderChips();
// visibility popup
const visPopup = document.querySelector('ytcp-video-visibility-select'); const visCell = document.getElementById('visibility-cell');
let pendingStatus = video.status;
visCell.addEventListener('click', () => { visPopup.classList.remove('hidden'); visPopup.querySelectorAll('tp-yt-paper-radio-button').forEach(r => r.setAttribute('aria-checked', r.getAttribute('name').toLowerCase() === video.status ? 'true' : 'false')); });
visPopup.querySelectorAll('tp-yt-paper-radio-button').forEach(r => r.addEventListener('click', () => { visPopup.querySelectorAll('tp-yt-paper-radio-button').forEach(x => x.setAttribute('aria-checked', 'false')); r.setAttribute('aria-checked', 'true'); pendingStatus = r.getAttribute('name').toLowerCase(); }));
document.getElementById('save-button').addEventListener('click', () => { visPopup.classList.add('hidden'); if (pendingStatus !== video.status) { video.status = pendingStatus; visCell.textContent = pendingStatus[0].toUpperCase() + pendingStatus.slice(1); markDirty(); } });
// playlists popup
const plDialog = document.querySelector('ytcp-playlist-dialog'); const plItems = document.getElementById('playlist-items');
document.getElementById('playlists-dropdown').addEventListener('click', () => { plDialog.classList.remove('hidden'); plItems.innerHTML = playlists.map(p => `<label class="checkbox-label" aria-checked="${video.playlists.includes(p)}">${p}</label>`).join(''); plItems.querySelectorAll('.checkbox-label').forEach(l => l.addEventListener('click', () => { const on = l.getAttribute('aria-checked') === 'true'; l.setAttribute('aria-checked', String(!on)); })); });
document.getElementById('done-button').addEventListener('click', () => { const chosen = Array.from(plItems.querySelectorAll('.checkbox-label[aria-checked="true"]')).map(l => l.textContent.trim()); if (JSON.stringify(chosen) !== JSON.stringify(video.playlists)) { video.playlists = chosen; markDirty(); } document.getElementById('playlists-dropdown').textContent = chosen.length ? chosen.join(', ') : 'Select'; plDialog.classList.add('hidden'); });
// save
save.addEventListener('click', async () => {
  video.title = document.querySelector('#title-textarea #textbox').innerText.trim();
  video.description = document.querySelector('#description-textarea #textbox').innerText.trim();
  await fetch('/api/save', {method: 'POST', body: JSON.stringify(video)});
  setTimeout(() => { save.setAttribute('disabled', ''); dirty = false; }, 700);
});
"""

WIZARD_BODY = """
<ytcp-uploads-dialog>
  <div style="display:flex;justify-content:space-between"><b>%(title)s</b><ytcp-icon-button id="close-button"><button>X</button></ytcp-icon-button></div>
  <div class="stepper" style="margin:10px 0"><span id="step-badge-0" class="step-badge">Details</span> · <span id="step-badge-1" class="step-badge">Video elements</span> · <span id="step-badge-2" class="step-badge">Checks</span> · <span id="step-badge-3" class="step-badge">Visibility</span></div>
  <div id="step-0" class="step">
    <h3>Title</h3><ytcp-social-suggestions-textbox id="title-textarea"><div id="textbox" contenteditable="true">%(title)s</div></ytcp-social-suggestions-textbox>
    <h3>Description</h3><ytcp-social-suggestions-textbox id="description-textarea"><div id="textbox" contenteditable="true">%(description)s</div></ytcp-social-suggestions-textbox>
    <h3>Audience</h3>
    <ytkc-made-for-kids-select>
      <tp-yt-paper-radio-button name="VIDEO_MADE_FOR_KIDS_MFK" aria-checked="false">Yes, it's made for kids</tp-yt-paper-radio-button>
      <tp-yt-paper-radio-button name="VIDEO_MADE_FOR_KIDS_NOT_MFK" aria-checked="false">No, it's not made for kids</tp-yt-paper-radio-button>
    </ytkc-made-for-kids-select>
  </div>
  <div id="step-1" class="step hidden"><h3>Video elements</h3><p>Nothing here.</p></div>
  <div id="step-2" class="step hidden"><h3>Checks</h3><p>No issues found.</p></div>
  <div id="step-3" class="step hidden"><h3>Visibility</h3>
    <div id="privacy-radios">
      <tp-yt-paper-radio-button name="PRIVATE">Private</tp-yt-paper-radio-button>
      <tp-yt-paper-radio-button name="UNLISTED">Unlisted</tp-yt-paper-radio-button>
      <tp-yt-paper-radio-button name="PUBLIC">Public</tp-yt-paper-radio-button>
    </div>
  </div>
  <div style="margin-top:20px"><ytcp-button id="back-button">Back</ytcp-button> <ytcp-button id="next-button" disabled>Next</ytcp-button> <ytcp-button id="done-button" class="hidden" disabled>Done</ytcp-button></div>
</ytcp-uploads-dialog>
<ytcp-video-share-dialog class="popup hidden" style="top:200px;left:300px"><h3>Video published</h3><ytcp-button id="close-button">Close</ytcp-button></ytcp-video-share-dialog>
"""

WIZARD_SCRIPT = """
const video = %(video)s; let step = 0; let privacy = '';
const show = () => { document.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('hidden', i !== step)); document.getElementById('next-button').classList.toggle('hidden', step === 3); document.getElementById('done-button').classList.toggle('hidden', step !== 3); };
const audienceChosen = () => !!document.querySelector('ytkc-made-for-kids-select tp-yt-paper-radio-button[aria-checked="true"]');
document.querySelectorAll('ytkc-made-for-kids-select tp-yt-paper-radio-button').forEach(r => r.addEventListener('click', () => {
  document.querySelectorAll('ytkc-made-for-kids-select tp-yt-paper-radio-button').forEach(x => x.setAttribute('aria-checked', 'false')); r.setAttribute('aria-checked', 'true');
  video.audience = r.getAttribute('name') === 'VIDEO_MADE_FOR_KIDS_MFK' ? 'for_kids' : 'not_for_kids'; document.getElementById('next-button').removeAttribute('disabled');
}));
document.querySelectorAll('.step-badge').forEach((b, i) => b.addEventListener('click', () => { if (i > 0 && !audienceChosen()) return; step = i; show(); }));
document.getElementById('next-button').addEventListener('click', () => { if (!audienceChosen()) return; step = Math.min(3, step + 1); show(); });
document.getElementById('back-button').addEventListener('click', () => { step = Math.max(0, step - 1); show(); });
document.querySelectorAll('#privacy-radios tp-yt-paper-radio-button').forEach(r => r.addEventListener('click', () => { document.querySelectorAll('#privacy-radios tp-yt-paper-radio-button').forEach(x => x.setAttribute('aria-checked', 'false')); r.setAttribute('aria-checked', 'true'); privacy = r.getAttribute('name').toLowerCase(); document.getElementById('done-button').removeAttribute('disabled'); }));
document.getElementById('done-button').addEventListener('click', async () => {
  video.title = document.querySelector('#title-textarea #textbox').innerText.trim(); video.description = document.querySelector('#description-textarea #textbox').innerText.trim(); video.status = privacy;
  await fetch('/api/publish', {method: 'POST', body: JSON.stringify(video)});
  document.querySelector('ytcp-uploads-dialog').remove(); document.querySelector('ytcp-video-share-dialog').classList.remove('hidden');
});
document.querySelector('ytcp-video-share-dialog #close-button').addEventListener('click', () => { location.href = '/channel/%(channel)s/videos/upload'; });
document.querySelector('ytcp-uploads-dialog #close-button').addEventListener('click', async () => {
  video.title = document.querySelector('#title-textarea #textbox').innerText.trim(); video.description = document.querySelector('#description-textarea #textbox').innerText.trim();
  await fetch('/api/save', {method: 'POST', body: JSON.stringify(video)}); location.href = '/channel/%(channel)s/videos/upload';
});
show();
"""

PNG_1X1 = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0300050001019e7dcc0f0000000049454e44ae426082")


class MockState:
    def __init__(self):
        self.reset()

    def reset(self):
        self.videos = [dict(v, tags=list(v["tags"]), playlists=list(v["playlists"])) for v in INITIAL_VIDEOS]
        self.saves: list[dict] = []
        self.publishes: list[dict] = []
        self.page_size = PAGE_SIZE_DEFAULT

    def find(self, video_id: str) -> dict | None:
        return next((v for v in self.videos if v["id"] == video_id), None)


STATE = MockState()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):  # keep the test output quiet
        pass

    def _send(self, body: bytes, content_type: str = "text/html; charset=utf-8", status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        if path in ("/", ""):
            self.send_response(302)
            self.send_header("Location", f"/channel/{CHANNEL}")
            self.end_headers()
            return
        if path == f"/channel/{CHANNEL}":
            return self._send(SHELL.format(title="Dashboard", body="<p style='padding:20px'>Channel dashboard</p>", script="").encode())
        if path.startswith("/channel/") and path.endswith("/videos/upload") or path.startswith("/playlist/"):
            videos = STATE.videos if path.startswith("/channel/") else [v for v in STATE.videos if "Recipes" in v["playlists"]]
            script = LIST_SCRIPT % {"page_size": STATE.page_size, "videos": json.dumps(videos)}
            return self._send(SHELL.format(title="Channel content - YouTube Studio", body=LIST_BODY, script=script).encode())
        if path.startswith("/video/") and path.endswith("/edit"):
            video_id = path.split("/")[2]
            video = STATE.find(video_id)
            if not video:
                return self._send(b"not found", status=404)
            if video["status"] == "draft":
                body = WIZARD_BODY % {"title": video["title"], "description": video["description"]}
                script = WIZARD_SCRIPT % {"video": json.dumps(video), "channel": CHANNEL}
                return self._send(SHELL.format(title="Draft - YouTube Studio", body=body, script=script).encode())
            body = EDITOR_BODY % {
                "title": video["title"],
                "description": video["description"],
                "status_label": video["status"].capitalize(),
                "kids_checked": "true" if video["audience"] == "for_kids" else "false",
                "not_kids_checked": "true" if video["audience"] == "not_for_kids" else "false",
                "playlists_label": ", ".join(video["playlists"]) or "Select",
            }
            script = EDITOR_SCRIPT % {"video": json.dumps(video), "playlists": json.dumps(PLAYLISTS)}
            return self._send(SHELL.format(title="Video details - YouTube Studio", body=body, script=script).encode())
        if path.startswith("/thumb/"):
            return self._send(PNG_1X1, "image/png")
        if path == "/api/state":
            return self._send(json.dumps({"videos": STATE.videos, "saves": STATE.saves, "publishes": STATE.publishes}).encode(), "application/json")
        if path == "/api/reset":
            STATE.reset()
            return self._send(b"{}", "application/json")
        return self._send(b"not found", status=404)

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        payload = json.loads(self.rfile.read(length) or b"{}")
        path = urlparse(self.path).path
        video = STATE.find(payload.get("id", ""))
        if video is not None:
            video.update({k: payload[k] for k in ("title", "description", "status", "audience", "tags", "playlists") if k in payload})
        if path == "/api/publish":
            STATE.publishes.append(payload)
        else:
            STATE.saves.append(payload)
        self._send(b"{}", "application/json")


def start_server(port: int = 0) -> tuple[ThreadingHTTPServer, str]:
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/"


if __name__ == "__main__":
    srv, url = start_server(8765)
    print("Mock Studio at", url)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        srv.shutdown()
