/* Front-end logic for YT Bulk Publish. Talks to the Python side through window.pywebview.api. */
(function () {
  "use strict";

  // ---------- helpers ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function api() {
    if (window.pywebview && window.pywebview.api) return window.pywebview.api;
    if (window.__mockApi) return window.__mockApi;
    return null;
  }
  async function call(name, ...args) {
    const a = api();
    if (!a || typeof a[name] !== "function") throw new Error("The program is still starting. Please wait a moment.");
    const result = await a[name](...args);
    if (result && result.error) throw new Error(result.error);
    return result;
  }

  function toast(text, kind) {
    const el = document.createElement("div");
    el.className = "toast " + (kind || "");
    el.textContent = text;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function ask(title, text, withInput) {
    return new Promise((resolve) => {
      const wrap = $("#modal");
      $("#modal-title").textContent = title;
      $("#modal-text").textContent = text || "";
      const input = $("#modal-input");
      input.classList.toggle("hidden", !withInput);
      input.value = "";
      wrap.classList.remove("hidden");
      const done = (value) => { wrap.classList.add("hidden"); cleanup(); resolve(value); };
      const ok = () => done(withInput ? input.value.trim() : true);
      const cancel = () => done(null);
      const onKey = (e) => { if (e.key === "Enter") ok(); if (e.key === "Escape") cancel(); };
      function cleanup() {
        $("#modal-ok").removeEventListener("click", ok);
        $("#modal-cancel").removeEventListener("click", cancel);
        document.removeEventListener("keydown", onKey);
      }
      $("#modal-ok").addEventListener("click", ok);
      $("#modal-cancel").addEventListener("click", cancel);
      document.addEventListener("keydown", onKey);
      if (withInput) setTimeout(() => input.focus(), 30);
    });
  }

  // ---------- state ----------
  const state = {
    step: 1,
    windows: [],
    selectedWindow: null,
    connected: false,
    source: "current",
    videos: [],
    selected: new Set(),
    filterText: "",
    filterStatus: "all",
    rules: [],
    running: false,
    pollTimer: null,
    logCount: 0,
  };

  // ---------- steps ----------
  function goStep(n) {
    state.step = n;
    $$(".screen").forEach((s) => s.classList.toggle("is-active", s.id === "screen-" + n));
    $$(".step").forEach((b) => {
      const k = Number(b.dataset.step);
      b.classList.toggle("is-active", k === n);
      b.classList.toggle("is-done", k < n);
    });
    if (n === 3) refreshPreview();
    if (n === 4) renderSummary();
  }
  $$(".step").forEach((b) => b.addEventListener("click", () => {
    const k = Number(b.dataset.step);
    if (k === 1 || state.connected || k <= state.step) goStep(k);
  }));

  // ---------- window controls ----------
  $("#btn-min").addEventListener("click", () => call("minimize").catch(() => {}));
  $("#btn-max").addEventListener("click", () => call("toggle_maximize").catch(() => {}));
  $("#btn-close").addEventListener("click", async () => {
    if (state.running) {
      const sure = await ask("Changes are still running", "Close anyway? The current video may be left half done.");
      if (!sure) return;
    }
    call("close").catch(() => window.close());
  });

  // ---------- step 1: windows ----------
  function banner(kind, title, text, actionLabel, action) {
    const el = $("#connect-banner");
    el.className = "banner glass " + (kind || "");
    el.innerHTML = `<div><strong>${esc(title)}</strong><span class="text">${esc(text || "")}</span></div>` +
      (actionLabel ? `<button class="btn primary" id="banner-action">${esc(actionLabel)}</button>` : "");
    el.classList.remove("hidden");
    if (actionLabel) $("#banner-action").addEventListener("click", action);
  }

  async function loadWindows() {
    const grid = $("#window-grid");
    grid.innerHTML = '<div class="empty glass">Looking for open windows…</div>';
    try {
      const result = await call("list_windows");
      state.windows = result.windows || [];
      renderWindows();
    } catch (err) {
      grid.innerHTML = `<div class="empty glass">${esc(err.message)}</div>`;
    }
  }

  function renderWindows() {
    const grid = $("#window-grid");
    if (!state.windows.length) {
      grid.innerHTML = '<div class="empty glass">No browser windows found. Open YouTube Studio in Chrome or Edge, then press Refresh. Or use “Open a browser just for this tool”.</div>';
      return;
    }
    grid.innerHTML = state.windows.map((w) => `
      <div class="glass win-card ${state.selectedWindow === w.handle ? "is-selected" : ""}" data-handle="${w.handle}">
        <div class="thumb">${w.thumbnail ? `<img src="${w.thumbnail}" alt="">` : "No preview"}</div>
        <div class="meta">
          <div class="title" title="${esc(w.title)}">${esc(w.title)}</div>
          <div class="sub">
            <span>${esc(w.browser || w.process || "")}</span>
            ${w.youtube ? '<span class="tag yt">YouTube</span>' : ""}
            ${w.remote ? '<span class="tag ok">Ready</span>' : ""}
          </div>
        </div>
      </div>`).join("");
    $$(".win-card", grid).forEach((card) => card.addEventListener("click", () => chooseWindow(Number(card.dataset.handle))));
  }

  async function chooseWindow(handle) {
    state.selectedWindow = handle;
    renderWindows();
    banner("", "Connecting…", "Checking whether the tool can work inside this window.");
    try {
      const result = await call("choose_window", handle);
      handleConnectResult(result);
    } catch (err) {
      banner("bad", "Could not connect", err.message);
    }
  }

  function handleConnectResult(result) {
    if (result.status === "connected") {
      state.connected = true;
      banner("ok", "Connected to " + (result.browser || "the browser"), result.message || "YouTube Studio is ready.", "Continue to your videos", () => { goStep(2); autoLoadIfPossible(); });
      toast("Connected", "ok");
    } else if (result.status === "needs_remote") {
      banner("warn", "This window cannot be controlled yet", result.message, "Open a browser just for this tool", openToolBrowser);
    } else if (result.status === "not_browser") {
      banner("warn", "That is not a browser window", result.message);
    } else if (result.status === "waiting_signin") {
      state.connected = true;
      banner("warn", "Please sign in", result.message, "I have signed in", async () => {
        const check = await call("connect_status").catch(() => ({}));
        if (check.signed_in) { banner("ok", "Signed in", "YouTube Studio is ready.", "Continue to your videos", () => { goStep(2); autoLoadIfPossible(); }); }
        else toast("YouTube Studio is not open yet in that browser. Sign in, then try again.", "bad");
      });
    } else {
      banner("bad", "Something went wrong", result.message || "");
    }
  }

  async function openToolBrowser() {
    banner("", "Opening a browser…", "A new browser window will appear. If YouTube asks you to sign in, do it there.");
    try {
      const result = await call("open_tool_browser");
      handleConnectResult(result);
      loadWindows();
    } catch (err) {
      banner("bad", "Could not open a browser", err.message);
    }
  }

  $("#btn-refresh-windows").addEventListener("click", loadWindows);
  $("#btn-open-tool-browser").addEventListener("click", openToolBrowser);

  // ---------- step 2: videos ----------
  $$("#source-seg .seg-btn").forEach((b) => b.addEventListener("click", () => {
    $$("#source-seg .seg-btn").forEach((x) => x.classList.remove("is-active"));
    b.classList.add("is-active");
    state.source = b.dataset.source;
    $("#playlist-field").classList.toggle("hidden", state.source !== "playlist");
  }));

  async function autoLoadIfPossible() {
    if (!state.videos.length) loadVideos();
  }

  async function loadVideos() {
    const status = $("#videos-status");
    const btn = $("#btn-load-videos");
    btn.disabled = true;
    status.textContent = "Reading the video list from YouTube Studio… this can take a little while for long lists.";
    try {
      const result = await call("load_videos", { kind: state.source, url: $("#playlist-url").value.trim() });
      state.videos = result.videos || [];
      state.selected = new Set();
      status.textContent = result.message || `${state.videos.length} videos found.`;
      $("#videos-lead").textContent = result.source_label ? `Showing: ${result.source_label}` : "Tick the videos you want to change.";
      renderVideos();
    } catch (err) {
      status.textContent = err.message;
      toast(err.message, "bad");
    } finally {
      btn.disabled = false;
    }
  }
  $("#btn-load-videos").addEventListener("click", loadVideos);

  function visibleVideos() {
    const q = state.filterText.toLowerCase();
    return state.videos.filter((v) => (state.filterStatus === "all" || v.status === state.filterStatus) && (!q || (v.title || "").toLowerCase().includes(q)));
  }

  function renderVideos() {
    const rows = $("#video-rows");
    const list = visibleVideos();
    if (!list.length) {
      rows.innerHTML = `<tr><td colspan="6" class="empty-cell">${state.videos.length ? "Nothing matches the filter." : "No videos loaded yet. Choose where to look and press “Load videos”."}</td></tr>`;
    } else {
      rows.innerHTML = list.map((v) => `
        <tr data-id="${esc(v.id)}" class="${state.selected.has(v.id) ? "is-selected" : ""}">
          <td class="col-check"><input type="checkbox" ${state.selected.has(v.id) ? "checked" : ""}></td>
          <td class="col-thumb">${v.thumbnail ? `<img class="vthumb" src="${esc(v.thumbnail)}" alt="">` : ""}</td>
          <td><div class="vtitle">${esc(v.title)}</div><div class="vid">${esc(v.id)}</div></td>
          <td><span class="status-pill ${esc(v.status)}">${esc(v.status_label || v.status)}</span></td>
          <td>${esc(v.date || "")}</td>
          <td>${esc(v.duration || "")}</td>
        </tr>`).join("");
      $$("tr", rows).forEach((tr) => {
        tr.addEventListener("click", (e) => {
          const id = tr.dataset.id;
          if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
          if (e.target.tagName !== "INPUT") $("input", tr).checked = state.selected.has(id);
          tr.classList.toggle("is-selected", state.selected.has(id));
          updateSelection();
        });
      });
    }
    updateSelection();
  }

  function updateSelection() {
    $("#selection-count").textContent = `${state.selected.size} selected of ${state.videos.length}`;
    $("#btn-to-changes").disabled = state.selected.size === 0;
  }

  $("#video-search").addEventListener("input", (e) => { state.filterText = e.target.value; renderVideos(); });
  $$("#status-chips .chip").forEach((c) => c.addEventListener("click", () => {
    $$("#status-chips .chip").forEach((x) => x.classList.remove("is-active"));
    c.classList.add("is-active");
    state.filterStatus = c.dataset.status;
    renderVideos();
  }));
  $("#btn-select-all").addEventListener("click", () => { visibleVideos().forEach((v) => state.selected.add(v.id)); renderVideos(); });
  $("#btn-select-none").addEventListener("click", () => { state.selected.clear(); renderVideos(); });
  $("#btn-export-titles").addEventListener("click", async () => {
    try {
      const r = await call("export_titles", state.videos);
      toast("Saved: " + r.path, "ok");
    } catch (err) { toast(err.message, "bad"); }
  });
  $("#btn-back-1").addEventListener("click", () => goStep(1));
  $("#btn-to-changes").addEventListener("click", () => goStep(3));

  // ---------- step 3: change cards ----------
  $$(".card").forEach((card) => {
    const sw = $(".switch input", card);
    const sync = () => card.classList.toggle("is-on", sw.checked);
    sw.addEventListener("change", sync);
    sync();
  });
  $$('input[name="visibility"]').forEach((r) => r.addEventListener("change", () => {
    $("#schedule-row").classList.toggle("hidden", r.value !== "schedule" || !r.checked);
  }));
  function segHandler(id, onChange) {
    $$(`#${id} .seg-btn`).forEach((b) => b.addEventListener("click", () => {
      $$(`#${id} .seg-btn`).forEach((x) => x.classList.remove("is-active"));
      b.classList.add("is-active");
      onChange(b.dataset.mode);
    }));
  }
  segHandler("description-mode", (mode) => {
    $("#description-find-row").classList.toggle("hidden", mode !== "find");
    $("#description-text-field").classList.toggle("hidden", mode === "find");
  });
  segHandler("tags-mode", () => {});
  const segValue = (id) => ($(`#${id} .seg-btn.is-active`) || {}).dataset?.mode;

  // ---------- rename rules ----------
  const RULE_NAMES = {
    replace: "Change a word or phrase", remove: "Remove text", prefix: "Add at start", suffix: "Add at end",
    number: "Number", case: "Letter case", trim: "Tidy spaces", regex: "Advanced pattern",
  };
  function newRule(type) {
    switch (type) {
      case "replace": return { type, find: "", with: "", match_case: false, whole_word: false };
      case "remove": return { type, text: "", match_case: false };
      case "prefix": return { type, text: "" };
      case "suffix": return { type, text: "" };
      case "number": return { type, template: "{title} {n}", start: 1, step: 1, padding: 0 };
      case "case": return { type, mode: "title" };
      case "regex": return { type, pattern: "", with: "", match_case: false };
      default: return { type: "trim" };
    }
  }
  function ruleControls(rule, i) {
    const inp = (key, ph, type) => `<input type="${type || "text"}" data-i="${i}" data-key="${key}" value="${esc(rule[key])}" placeholder="${esc(ph || "")}">`;
    const chk = (key, label) => `<label class="mini"><input type="checkbox" data-i="${i}" data-key="${key}" ${rule[key] ? "checked" : ""}> ${label}</label>`;
    switch (rule.type) {
      case "replace": return `${inp("find", "word or phrase to find")} <span class="mini">→</span> ${inp("with", "new text")} ${chk("match_case", "Match case")} ${chk("whole_word", "Whole words")}`;
      case "remove": return `${inp("text", "text to remove")} ${chk("match_case", "Match case")}`;
      case "prefix": return inp("text", "text to add at the start");
      case "suffix": return inp("text", "text to add at the end");
      case "number": return `${inp("template", "{title} {n}")} <span class="mini">start</span>${inp("start", "", "number")} <span class="mini">step</span>${inp("step", "", "number")} <span class="mini">digits</span>${inp("padding", "", "number")}`;
      case "case": return `<select data-i="${i}" data-key="mode">
          <option value="title" ${rule.mode === "title" ? "selected" : ""}>Title Case</option>
          <option value="sentence" ${rule.mode === "sentence" ? "selected" : ""}>Sentence case</option>
          <option value="upper" ${rule.mode === "upper" ? "selected" : ""}>UPPER CASE</option>
          <option value="lower" ${rule.mode === "lower" ? "selected" : ""}>lower case</option></select>`;
      case "regex": return `${inp("pattern", "pattern")} <span class="mini">→</span> ${inp("with", "replacement")} ${chk("match_case", "Match case")}`;
      default: return `<span class="mini">Removes double spaces and trims the ends.</span>`;
    }
  }
  function renderRules() {
    const list = $("#rule-list");
    if (!state.rules.length) {
      list.innerHTML = '<div class="muted pad">No steps yet. Pick a step type above and press “Add step”.</div>';
    } else {
      list.innerHTML = state.rules.map((r, i) => `
        <div class="rule" data-i="${i}">
          <button class="move" data-dir="-1" title="Move up">▲</button><button class="move" data-dir="1" title="Move down">▼</button>
          <span class="rule-name">${i + 1}. ${RULE_NAMES[r.type] || r.type}</span>
          ${ruleControls(r, i)}
          <button class="x" title="Remove step">✕</button>
        </div>`).join("");
      $$(".rule input, .rule select", list).forEach((el) => el.addEventListener("input", (e) => {
        const rule = state.rules[Number(el.dataset.i)];
        const key = el.dataset.key;
        if (el.type === "checkbox") rule[key] = el.checked;
        else if (el.type === "number") rule[key] = Number(el.value || 0);
        else rule[key] = el.value;
        refreshPreview();
      }));
      $$(".rule .x", list).forEach((x) => x.addEventListener("click", () => { state.rules.splice(Number(x.closest(".rule").dataset.i), 1); renderRules(); refreshPreview(); }));
      $$(".rule .move", list).forEach((m) => m.addEventListener("click", () => {
        const i = Number(m.closest(".rule").dataset.i), j = i + Number(m.dataset.dir);
        if (j < 0 || j >= state.rules.length) return;
        [state.rules[i], state.rules[j]] = [state.rules[j], state.rules[i]];
        renderRules(); refreshPreview();
      }));
    }
    $("#on-title").checked = state.rules.length > 0 || $("#on-title").checked;
    $('.card[data-card="title"]').classList.toggle("is-on", $("#on-title").checked);
  }
  $("#btn-add-rule").addEventListener("click", () => { state.rules.push(newRule($("#rule-type").value)); renderRules(); refreshPreview(); });

  let previewTimer = null;
  function refreshPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const box = $("#rename-preview");
      const chosen = state.videos.filter((v) => state.selected.has(v.id));
      if (!state.rules.length) { box.innerHTML = '<div class="muted pad">Add a step to see the new titles.</div>'; $("#preview-count").textContent = ""; $("#rule-problems").textContent = ""; return; }
      try {
        const r = await call("preview_rename", chosen, state.rules);
        $("#rule-problems").textContent = (r.problems || []).join(" ");
        const rows = r.rows || [];
        const changed = rows.filter((x) => x.changed).length;
        $("#preview-count").textContent = `${changed} of ${rows.length} titles change`;
        box.innerHTML = rows.map((x) => `
          <div class="preview-row">
            ${x.changed ? `<div class="old">${esc(x.old)}</div><div class="new">${esc(x.new)}</div>` : `<div class="same">${esc(x.old)} <span class="muted">(no change)</span></div>`}
            ${x.problems && x.problems.length ? `<div class="problem">${esc(x.problems.join(" "))}</div>` : ""}
          </div>`).join("") || '<div class="muted pad">Select videos in step 2 to preview.</div>';
      } catch (err) {
        box.innerHTML = `<div class="muted pad">${esc(err.message)}</div>`;
      }
    }, 180);
  }

  // presets
  async function loadPresets() {
    try {
      const r = await call("list_presets");
      const sel = $("#preset-select");
      sel.innerHTML = '<option value="">Saved rule sets…</option>' + (r.presets || []).map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
    } catch (_) { /* presets are optional */ }
  }
  $("#btn-save-preset").addEventListener("click", async () => {
    if (!state.rules.length) return toast("Add at least one step first.");
    const name = await ask("Save rule set", "Give this set of rename steps a name.", true);
    if (!name) return;
    await call("save_preset", name, state.rules).catch((e) => toast(e.message, "bad"));
    await loadPresets();
    toast("Saved", "ok");
  });
  $("#btn-load-preset").addEventListener("click", async () => {
    const name = $("#preset-select").value;
    if (!name) return;
    try { const r = await call("load_preset", name); state.rules = r.rules || []; renderRules(); refreshPreview(); } catch (e) { toast(e.message, "bad"); }
  });
  $("#btn-delete-preset").addEventListener("click", async () => {
    const name = $("#preset-select").value;
    if (!name) return;
    if (!(await ask("Delete rule set", `Delete “${name}”?`))) return;
    await call("delete_preset", name).catch(() => {});
    loadPresets();
  });

  $("#btn-back-2").addEventListener("click", () => goStep(2));
  $("#btn-to-run").addEventListener("click", () => {
    const plan = buildPlan();
    if (!plan.changes.length) return toast("Switch on at least one change first.");
    goStep(4);
  });

  // ---------- plan ----------
  function buildPlan() {
    const changes = [];
    if ($("#on-visibility").checked) {
      const mode = ($('input[name="visibility"]:checked') || {}).value || "public";
      changes.push({ kind: "visibility", mode, date: $("#schedule-date").value, time: $("#schedule-time").value, gap_minutes: Number($("#schedule-gap").value || 0) });
    }
    if ($("#on-title").checked && state.rules.length) changes.push({ kind: "title", rules: state.rules });
    if ($("#on-description").checked) {
      changes.push({ kind: "description", mode: segValue("description-mode") || "replace", text: $("#description-text").value, find: $("#description-find").value, with: $("#description-with").value });
    }
    if ($("#on-tags").checked) changes.push({ kind: "tags", mode: segValue("tags-mode") || "add", text: $("#tags-text").value });
    if ($("#on-audience").checked) changes.push({ kind: "audience", value: ($('input[name="audience"]:checked') || {}).value || "not_for_kids" });
    if ($("#on-playlist").checked && $("#playlist-name").value.trim()) changes.push({ kind: "playlist", name: $("#playlist-name").value.trim() });
    const videos = state.videos.filter((v) => state.selected.has(v.id));
    return { videos, changes, dry_run: $("#opt-dry-run").checked, pause: Number($("#opt-pause").value || 0) };
  }

  const SUMMARY_LABEL = {
    visibility: (c) => c.mode === "schedule" ? `Schedule for ${c.date || "?"} ${c.time || ""}` : `Set to ${c.mode}`,
    title: (c) => `${c.rules.length} rename step${c.rules.length === 1 ? "" : "s"}`,
    description: (c) => ({ replace: "Replace the description", prepend: "Add text at the start", append: "Add text at the end", find: `Change “${c.find}” to “${c.with}”` }[c.mode]),
    tags: (c) => (c.mode === "add" ? "Add tags: " : "Replace tags with: ") + c.text,
    audience: (c) => c.value === "for_kids" ? "Made for kids" : "Not made for kids",
    playlist: (c) => `Add to “${c.name}”`,
  };
  function renderSummary() {
    const plan = buildPlan();
    $("#summary-list").innerHTML = `<li><b>Videos</b>${plan.videos.length} selected</li>` +
      plan.changes.map((c) => `<li><b>${esc(c.kind)}</b>${esc(SUMMARY_LABEL[c.kind](c))}</li>`).join("");
    $("#results-list").innerHTML = plan.videos.map((v) => `<div class="result" data-id="${esc(v.id)}"><span class="dot"></span><span class="rtitle">${esc(v.title)}</span><span class="rmsg"></span></div>`).join("");
    $("#results-count").textContent = `${plan.videos.length} videos`;
  }

  // ---------- run ----------
  $("#btn-back-3").addEventListener("click", () => goStep(3));
  $("#btn-start").addEventListener("click", async () => {
    const plan = buildPlan();
    if (!plan.videos.length) return toast("No videos selected.");
    if (!plan.changes.length) return toast("Nothing to change.");
    if (!plan.dry_run) {
      const sure = await ask("Ready to start?", `${plan.videos.length} video${plan.videos.length === 1 ? "" : "s"} will be changed in YouTube Studio. Continue?`);
      if (!sure) return;
    }
    try {
      await call("start_changes", plan);
      state.running = true;
      state.logCount = 0;
      $("#log").innerHTML = "";
      $("#btn-start").classList.add("hidden");
      $("#btn-stop").classList.remove("hidden");
      pollProgress();
    } catch (err) { toast(err.message, "bad"); }
  });
  $("#btn-stop").addEventListener("click", async () => {
    await call("stop_changes").catch(() => {});
    $("#btn-stop").disabled = true;
    $("#btn-stop").textContent = "Stopping…";
  });

  function pollProgress() {
    clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(async () => {
      try {
        const p = await call("progress", state.logCount);
        (p.log || []).forEach(appendLog);
        state.logCount = p.log_total || state.logCount;
        (p.items || []).forEach((it) => {
          const row = $(`.result[data-id="${CSS.escape(it.id)}"]`);
          if (!row) return;
          row.className = "result " + it.state;
          $(".rmsg", row).textContent = it.message || "";
        });
        const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
        $("#progress-fill").style.width = pct + "%";
        $("#progress-text").textContent = p.running ? `Working on ${p.done + 1} of ${p.total}: ${p.current || ""}` : (p.summary || "Finished");
        if (p.running) pollProgress();
        else finishRun(p);
      } catch (err) {
        appendLog({ time: "", level: "error", message: err.message });
        pollProgress();
      }
    }, 700);
  }
  function finishRun(p) {
    state.running = false;
    $("#btn-start").classList.remove("hidden");
    $("#btn-start").textContent = "Run again";
    $("#btn-stop").classList.add("hidden");
    $("#btn-stop").disabled = false;
    $("#btn-stop").textContent = "Stop after this video";
    toast(p.summary || "Finished", p.failed ? "bad" : "ok");
  }
  function appendLog(entry) {
    const log = $("#log");
    const line = document.createElement("div");
    line.className = "line " + (entry.level || "");
    line.innerHTML = `<span class="time">${esc(entry.time)}</span>${esc(entry.message)}`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }
  $("#btn-open-folder").addEventListener("click", () => call("open_folder").catch((e) => toast(e.message, "bad")));

  // ---------- start ----------
  async function init() {
    try {
      const info = await call("app_info");
      if (info && info.subtitle) $("#brand-sub").textContent = info.subtitle;
      if (info && info.settings) {
        if (Array.isArray(info.settings.rename_rules) && info.settings.rename_rules.length) { state.rules = info.settings.rename_rules; }
        if (info.settings.pause_between_videos != null) $("#opt-pause").value = info.settings.pause_between_videos;
      }
    } catch (_) { /* first paint can happen before the bridge is ready */ }
    renderRules();
    loadPresets();
    loadWindows();
    const today = new Date(); today.setDate(today.getDate() + 1);
    $("#schedule-date").value = today.toISOString().slice(0, 10);
  }
  if (window.pywebview && window.pywebview.api) init();
  else window.addEventListener("pywebviewready", init, { once: true });
  if (window.__mockApi) init();
  setTimeout(() => { if (!api()) $("#window-grid").innerHTML = '<div class="empty glass">Still starting… if this message stays, restart the program.</div>'; }, 6000);
})();
