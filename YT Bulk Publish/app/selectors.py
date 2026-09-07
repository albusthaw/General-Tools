"""Where things live on YouTube Studio pages, plus a small helper script.

YouTube changes its pages from time to time. Every element below is described
by a list of candidates, tried in order, and many actions also fall back to
finding a button by its visible text. If YouTube moves something, this is the
only file that normally needs an update.
"""

STUDIO_HOST = "studio.youtube.com"
STUDIO_URL = "https://studio.youtube.com/"

# ---- content list ---------------------------------------------------------
ROW = ["ytcp-video-row"]
ROW_TITLE = ["#video-title", "a#video-title", "a[href*='/video/']"]
NEXT_PAGE = ["ytcp-table-footer #navigate-after", "#navigate-after", "ytcp-icon-button[aria-label*='Next']"]
FOOTER = ["ytcp-table-footer", "#footer"]
PAGE_SIZE_TRIGGER = [
    "ytcp-table-footer #page-size ytcp-dropdown-trigger",
    "ytcp-table-footer ytcp-select#page-size #trigger",
    "ytcp-table-footer ytcp-dropdown-trigger",
    "#page-size ytcp-dropdown-trigger",
]
PAGE_SIZE_ITEM = ["tp-yt-paper-item", "ytcp-text-menu tp-yt-paper-item", "tp-yt-paper-listbox tp-yt-paper-item", "paper-item"]
EDIT_DRAFT_BUTTON = ["ytcp-button", "button", "a"]
EDIT_DRAFT_TEXT = r"edit\s*draft"

# ---- video details editor (studio.youtube.com/video/<id>/edit) ------------
EDITOR_ROOT = ["ytcp-video-metadata-editor", "ytcp-video-metadata-editor-basics", "#basics"]
TITLE_BOX = ["#title-textarea #textbox", "ytcp-social-suggestions-textbox#title-textarea #textbox", "#title-textarea [contenteditable]", "ytcp-video-title #textbox"]
DESCRIPTION_BOX = ["#description-textarea #textbox", "ytcp-social-suggestions-textbox#description-textarea #textbox", "#description-textarea [contenteditable]", "ytcp-video-description #textbox"]
SAVE_BUTTON = ["ytcp-button#save", "#save", "ytcp-button#save-button"]
SAVE_TEXT = r"^\s*save\s*$"
SHOW_MORE = ["#toggle-button", "ytcp-button#toggle-button"]
SHOW_MORE_TEXT = r"show\s*more"
TAGS_INPUT = ["#tags-container input", "ytcp-free-text-chip-bar#tags-container input", "ytcp-free-text-chip-bar input", "#tags-container #text-input"]
TAG_CHIP_REMOVE = ["#tags-container ytcp-chip #delete-icon", "#tags-container ytcp-chip [id*='delete']", "#tags-container ytcp-chip button", "#tags-container ytcp-chip .remove-chip-icon"]
AUDIENCE_KIDS = ["tp-yt-paper-radio-button[name='VIDEO_MADE_FOR_KIDS_MFK']", "[name='VIDEO_MADE_FOR_KIDS_MFK']"]
AUDIENCE_NOT_KIDS = ["tp-yt-paper-radio-button[name='VIDEO_MADE_FOR_KIDS_NOT_MFK']", "[name='VIDEO_MADE_FOR_KIDS_NOT_MFK']"]

VISIBILITY_OPENER = [
    "ytcp-video-metadata-visibility #container",
    "ytcp-video-metadata-visibility #select-button",
    "ytcp-video-metadata-visibility ytcp-text-dropdown-trigger",
    "ytcp-video-metadata-visibility #visibility-cell",
    "ytcp-video-metadata-visibility",
    "#visibility-cell",
]
VISIBILITY_POPUP = ["ytcp-video-visibility-edit-popup tp-yt-paper-dialog", "ytcp-video-visibility-edit-popup", "ytcp-video-visibility-select"]
VISIBILITY_RADIOS = ["#privacy-radios", "ytcp-video-visibility-select"]
VISIBILITY_RADIO = {
    "public": ["tp-yt-paper-radio-button[name='PUBLIC']", "[name='PUBLIC']"],
    "unlisted": ["tp-yt-paper-radio-button[name='UNLISTED']", "[name='UNLISTED']"],
    "private": ["tp-yt-paper-radio-button[name='PRIVATE']", "[name='PRIVATE']"],
}
SCHEDULE_RADIO = ["#schedule-radio-button", "tp-yt-paper-radio-button#schedule-radio-button", "[name='SCHEDULE']"]
SCHEDULE_DATE_TRIGGER = ["#datepicker-trigger", "ytcp-datetime-picker #datepicker-trigger", "ytcp-text-dropdown-trigger#datepicker-trigger"]
SCHEDULE_DATE_INPUT = ["ytcp-date-picker input", "ytcp-date-picker tp-yt-paper-input input", "tp-yt-paper-dialog input", "ytcp-date-picker #textbox"]
SCHEDULE_TIME_TRIGGER = ["#time-of-day-trigger", "ytcp-datetime-picker #time-of-day-trigger", "ytcp-text-dropdown-trigger#time-of-day-trigger"]
SCHEDULE_TIME_ITEM = ["tp-yt-paper-item", "ytcp-text-menu tp-yt-paper-item", "paper-item"]
VISIBILITY_DONE = [
    "ytcp-video-visibility-edit-popup #save-button",
    "ytcp-video-visibility-edit-popup ytcp-button#save-button",
    "ytcp-video-visibility-select #save-button",
    "ytcp-video-visibility-select ytcp-button",
    "ytcp-video-metadata-visibility ytcp-button",
]
VISIBILITY_DONE_TEXT = r"^\s*(done|save)\s*$"

PLAYLIST_OPENER = ["ytcp-video-metadata-playlists ytcp-text-dropdown-trigger", "ytcp-video-metadata-playlists", "#playlists-dropdown"]
PLAYLIST_DIALOG = ["ytcp-playlist-dialog", "tp-yt-paper-dialog"]
PLAYLIST_ITEM = ["ytcp-playlist-dialog ytcp-checkbox-group .checkbox-label", "ytcp-playlist-dialog #checkbox-label", "ytcp-playlist-dialog tp-yt-paper-checkbox", "ytcp-playlist-dialog li", "ytcp-playlist-dialog label"]
PLAYLIST_DONE = ["ytcp-playlist-dialog #done-button", "ytcp-playlist-dialog ytcp-button"]
PLAYLIST_DONE_TEXT = r"^\s*done\s*$"

# ---- upload / draft wizard (ytcp-uploads-dialog) -------------------------
WIZARD = ["ytcp-uploads-dialog"]
# The host element above has no size of its own; these inner parts show when it is open.
WIZARD_VISIBLE = [
    "ytcp-uploads-dialog tp-yt-paper-dialog",
    "ytcp-uploads-dialog #scrollable-content",
    "ytcp-uploads-dialog #next-button",
    "ytcp-uploads-dialog #done-button",
]
WIZARD_NEXT = ["ytcp-uploads-dialog #next-button", "#next-button"]
WIZARD_DONE = ["ytcp-uploads-dialog #done-button", "#done-button"]
WIZARD_CLOSE = [
    "ytcp-uploads-dialog #ytcp-uploads-dialog-close-button",
    "#ytcp-uploads-dialog-close-button",
    "ytcp-uploads-dialog #close-button",
    "ytcp-uploads-dialog ytcp-icon-button[aria-label*='Close']",
]
# A draft opens straight into the wizard through this link on the content page.
DRAFT_DEEP_LINK = "{base}channel/{channel}/videos/upload?d=ud&udvid={video_id}"
WIZARD_STEP_VISIBILITY = ["ytcp-uploads-dialog #step-badge-3", "#step-badge-3", "ytcp-uploads-dialog .step-badge:nth-of-type(4)"]
WIZARD_STEP_DETAILS = ["ytcp-uploads-dialog #step-badge-0", "#step-badge-0"]
SHARE_DIALOG_CLOSE = [
    "ytcp-video-share-dialog #close-button",
    "ytcp-uploads-still-processing-dialog #close-button",
    "ytcp-uploads-still-processing-dialog ytcp-button",
    "tp-yt-paper-dialog #close-button",
]
SHARE_DIALOG_CLOSE_TEXT = r"^\s*(close|done|ok)\s*$"

# ---- confirmations that sometimes pop up -----------------------------------
CONFIRM_BUTTON = ["ytcp-confirmation-dialog ytcp-button", "tp-yt-paper-dialog ytcp-button", "ytcp-dialog ytcp-button"]
CONFIRM_TEXT = r"^\s*(save|continue|confirm|publish|yes|got it|ok|done)\s*$"


# ---- helper script injected into the Studio tab ---------------------------
HELPER_JS = r"""
(() => {
  if (window.__ytbp && window.__ytbp.version === 3) return true;
  const H = { version: 3, store: {}, nextId: 1 };

  H.plainAll = (selector, root) => { try { return Array.from((root || document).querySelectorAll(selector)); } catch (e) { return []; } };
  H.deepAll = (selector, root) => {
    const out = []; const seen = new Set();
    const walk = (node, depth) => {
      if (!node || depth > 12) return;
      for (const m of H.plainAll(selector, node)) { if (!seen.has(m)) { seen.add(m); out.push(m); } }
      let hosts = [];
      try { hosts = Array.from(node.querySelectorAll('*')).filter(e => e.shadowRoot); } catch (e) {}
      for (const host of hosts) walk(host.shadowRoot, depth + 1);
    };
    walk(root || document, 0);
    if (root && root.shadowRoot) walk(root.shadowRoot, 1);
    return out;
  };
  H.all = (selector, root) => { const plain = H.plainAll(selector, root); return plain.length ? plain : H.deepAll(selector, root); };
  H.visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };
  H.text = (el) => ((el && (el.innerText != null ? el.innerText : el.textContent)) || '').replace(/\s+/g, ' ').trim();
  H.list = (selectors) => Array.isArray(selectors) ? selectors : [selectors];
  H.first = (selectors, root, needVisible) => {
    for (const s of H.list(selectors)) {
      const found = H.all(s, root);
      if (!found.length) continue;
      const vis = found.find(H.visible);
      if (vis) return vis;
      if (!needVisible) return found[0];
    }
    return null;
  };
  H.byText = (selectors, pattern, root, flags) => {
    const re = new RegExp(pattern, flags == null ? 'i' : flags);
    for (const s of H.list(selectors)) {
      for (const el of H.all(s, root)) { if (H.visible(el) && re.test(H.text(el))) return el; }
    }
    return null;
  };
  H.mark = (el) => { if (!el) return 0; for (const k in H.store) { if (H.store[k] === el) return Number(k); } const id = H.nextId++; H.store[id] = el; return id; };
  H.get = (id) => H.store[id] || null;
  H.find = (selectors, needVisible) => H.mark(H.first(selectors, document, needVisible));
  H.findIn = (parentId, selectors, needVisible) => H.mark(H.first(selectors, H.get(parentId) || document, needVisible));
  H.findText = (selectors, pattern, parentId) => H.mark(H.byText(selectors, pattern, parentId ? H.get(parentId) : document));
  H.count = (selectors) => { let n = 0; for (const s of H.list(selectors)) n = Math.max(n, H.all(s).length); return n; };
  H.exists = (selectors, needVisible) => !!H.first(selectors, document, needVisible);
  H.rect = (id) => {
    const el = H.get(id); if (!el) return null;
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, visible: H.visible(el) };
  };
  H.jsClick = (id) => { const el = H.get(id); if (!el) return false; el.click(); return true; };
  H.focus = (id) => { const el = H.get(id); if (!el) return false; el.focus(); if (el.select) { try { el.select(); } catch (e) {} } return document.activeElement === el || (el.contains && el.contains(document.activeElement)); };
  H.value = (id) => { const el = H.get(id); if (!el) return null; if ('value' in el && el.tagName !== 'DIV') return el.value; return H.text(el); };
  H.setText = (id, text) => {
    const el = H.get(id); if (!el) return null;
    el.focus();
    const isField = ('value' in el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    try { if (isField) el.select(); else document.execCommand('selectAll', false, null); } catch (e) {}
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) {}
    const now = isField ? el.value : H.text(el);
    if (!ok || now !== text.replace(/\s+/g, ' ').trim() && now !== text) {
      if (isField) { el.value = text; } else { el.textContent = text; }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return isField ? el.value : H.text(el);
  };
  H.isDisabled = (id) => { const el = H.get(id); if (!el) return true; return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || (el.disabled === true); };
  H.isChecked = (id) => { const el = H.get(id); if (!el) return false; return el.checked === true || el.getAttribute('aria-checked') === 'true' || el.hasAttribute('checked') || el.classList.contains('checked') || el.classList.contains('iron-selected'); };
  H.attr = (id, name) => { const el = H.get(id); return el ? el.getAttribute(name) : null; };

  H.videoIdFrom = (row) => {
    for (const a of row.querySelectorAll('a[href]')) { const m = (a.getAttribute('href') || '').match(/\/video\/([\w-]{11})/); if (m) return m[1]; }
    for (const img of row.querySelectorAll('img[src]')) { const m = img.src.match(/\/vi(?:_webp)?\/([\w-]{11})\//); if (m) return m[1]; }
    const attr = row.getAttribute('video-id') || row.getAttribute('data-video-id'); if (attr) return attr;
    try { const d = row.__data || row.data || {}; const v = d.video || d.videoData || d; if (v && typeof v.videoId === 'string') return v.videoId; } catch (e) {}
    return '';
  };
  H.statusFrom = (text) => {
    if (/\bdraft\b/i.test(text)) return 'draft';
    if (/\bscheduled\b/i.test(text)) return 'scheduled';
    if (/\bunlisted\b/i.test(text)) return 'unlisted';
    if (/\bprivate\b/i.test(text)) return 'private';
    if (/\bmembers/i.test(text)) return 'members';
    if (/\bpublic\b/i.test(text)) return 'public';
    return '';
  };
  H.parseRows = () => H.all('ytcp-video-row').map((row) => {
    const titleEl = H.first(['#video-title', 'a#video-title', 'a[href*="/video/"]'], row) ;
    const title = H.text(titleEl);
    const id = H.videoIdFrom(row);
    const visCell = H.first(['.tablecell-visibility', '[class*="visibility"]', 'ytcp-video-visibility-select'], row);
    let visText = H.text(visCell);
    if (!visText) { visText = H.text(row); if (title) visText = visText.split(title).join(' '); const desc = H.text(H.first(['#description-text', '[id*="description"]'], row)); if (desc) visText = visText.split(desc).join(' '); }
    const status = H.statusFrom(visText);
    const dateEl = H.first(['.tablecell-date', '[class*="tablecell-date"]', '[class*="date"]'], row);
    const dateText = H.text(dateEl).replace(/\b(Published|Uploaded|Scheduled|Draft)\b/gi, '').trim();
    const durEl = H.first(['ytcp-badge.timestamp-badge .label', 'ytcp-badge .label', '.video-duration', '[class*="duration"]', 'ytcp-thumbnail-badge'], row);
    const img = H.first(['img[src*="ytimg"]', 'img[src*="/vi/"]', 'img'], row);
    const hasEditDraft = !!H.byText(['ytcp-button', 'button', 'a'], 'edit\\s*draft', row);
    return { id, title, status: status || (hasEditDraft ? 'draft' : ''), date: dateText, duration: H.text(durEl), thumbnail: img ? img.src : '', draft: status === 'draft' || hasEditDraft };
  });
  H.rowFor = (videoId, title) => {
    const rows = H.all('ytcp-video-row');
    for (const row of rows) { if (videoId && H.videoIdFrom(row) === videoId) return H.mark(row); }
    if (title) { for (const row of rows) { if (H.text(H.first(['#video-title', 'a#video-title'], row)) === title) return H.mark(row); } }
    return 0;
  };
  H.channelId = () => {
    const m = location.pathname.match(/channel\/(UC[\w-]+)/); if (m) return m[1];
    const a = document.querySelector('a[href*="/channel/UC"]'); if (a) { const mm = a.getAttribute('href').match(/channel\/(UC[\w-]+)/); if (mm) return mm[1]; }
    try { const c = window.yt && yt.config_ && (yt.config_.CHANNEL_ID || (yt.config_.DELEGATED_SESSION_ID)); if (c && /^UC/.test(c)) return c; } catch (e) {}
    return '';
  };
  H.signedIn = () => location.host.includes(H.studioHost || 'studio.youtube.com') && !location.pathname.startsWith('/signin') && !!document.querySelector('ytcp-app, #menu-paper-icon-item-0, ytcp-navigation-drawer, #main-menu, ytcp-header');
  window.__ytbp = H;
  return true;
})()
"""
