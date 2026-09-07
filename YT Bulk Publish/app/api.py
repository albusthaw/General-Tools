"""The bridge between the interface and the Python side.

Every public method here can be called from the interface. Methods return
plain dictionaries; when something goes wrong they return {"error": message}
written in everyday language.
"""
from __future__ import annotations

import csv
import datetime as _dt
import json
import os
import re
import subprocess
import sys
import threading
from pathlib import Path

from . import browser_control, rename, window_picker
from .cdp import BrowserEndpoint, DevToolsError, Page
from .engine import BatchRunner
from .settings import APP_NAME, APP_VERSION, ActivityLog, Settings, ensure_folders
from .studio import Studio, StudioError, connect_studio

SUBTITLE = "Bulk publish, rename and update your YouTube videos"


def _safe(method):
    """Turn exceptions into {"error": ...} so the interface can show them."""

    def wrapper(self, *args, **kwargs):
        try:
            return method(self, *args, **kwargs)
        except (StudioError, DevToolsError, RuntimeError, ValueError) as exc:
            self.log.error(str(exc))
            return {"error": str(exc)}
        except Exception as exc:  # noqa: BLE001
            self.log.error(f"Unexpected problem: {exc!r}")
            return {"error": f"Something unexpected happened: {exc}"}

    wrapper.__name__ = method.__name__
    return wrapper


class Api:
    def __init__(self):
        self.folders = ensure_folders()
        self.settings = Settings(self.folders["root"] / "settings.json")
        self.log = ActivityLog(self.folders["logs"])
        self.window = None  # set by main once the window exists
        self.endpoint: BrowserEndpoint | None = None
        self.page: Page | None = None
        self.studio: Studio | None = None
        self.selected_process: browser_control.BrowserProcess | None = None
        self.runner = BatchRunner(self._get_studio, self.log)
        self.videos: list[dict] = []
        self._maximized = False
        self._lock = threading.Lock()
        self.log.info(f"{APP_NAME} {APP_VERSION} started. Folder: {self.folders['root']}")

    # ---- app -----------------------------------------------------------------------
    @_safe
    def app_info(self) -> dict:
        return {
            "name": APP_NAME,
            "version": APP_VERSION,
            "subtitle": SUBTITLE,
            "folder": str(self.folders["root"]),
            "settings": {
                "rename_rules": self.settings.get("rename_rules", []),
                "pause_between_videos": self.settings.get("pause_between_videos", 1.5),
            },
        }

    # ---- windows ---------------------------------------------------------------------
    @_safe
    def list_windows(self) -> dict:
        windows = window_picker.list_windows(only_browsers=False, with_thumbnails=True, skip_title=APP_NAME)
        result = []
        for w in windows:
            if not w.is_browser and not w.looks_like_youtube:
                continue
            item = w.to_dict()
            process = browser_control.inspect_pid(w.pid)
            item["remote"] = bool(process and browser_control.find_endpoint(process)) if w.is_browser else False
            result.append(item)
        if sys.platform != "win32" and not result:
            return {"windows": [], "message": "Window pictures are only available on Windows."}
        return {"windows": result}

    def _attach(self, endpoint: BrowserEndpoint, brand: str) -> dict:
        self.endpoint = endpoint
        if self.page:
            try:
                self.page.close()
            except Exception:  # noqa: BLE001
                pass
        self.page, target = connect_studio(endpoint, self.log.write)
        self.studio = Studio(self.page, self.log.write)
        self.log.info(f"Connected to {brand}: {target.get('title', '')}")
        if self.studio.is_signed_in():
            return {"status": "connected", "browser": brand, "message": "YouTube Studio is open and signed in."}
        return {
            "status": "waiting_signin",
            "browser": brand,
            "message": "The browser is ready. Sign in to YouTube Studio in that window, then press the button below.",
        }

    @_safe
    def choose_window(self, handle: int) -> dict:
        match = next((w for w in window_picker.list_windows(with_thumbnails=False) if w.handle == int(handle)), None)
        if not match:
            return {"status": "error", "message": "That window has closed. Press Refresh and try again."}
        window_picker.focus_window(match.handle)
        process = browser_control.inspect_pid(match.pid)
        if not process:
            return {"status": "not_browser", "message": "Pick a Google Chrome, Microsoft Edge or Brave window."}
        self.selected_process = process
        if process.exe_name == "firefox.exe":
            return {
                "status": "needs_remote",
                "message": "Firefox windows cannot be controlled by this tool. Let the tool open Chrome or Edge instead; you sign in there once.",
            }
        endpoint = browser_control.find_endpoint(process)
        if endpoint:
            return self._attach(endpoint, process.brand)
        return {
            "status": "needs_remote",
            "browser": process.brand,
            "message": (
                f"This {process.brand} window was opened normally, so the tool cannot reach inside it. "
                "Let the tool open its own browser window instead. You sign in there once and it is remembered."
            ),
        }

    @_safe
    def open_tool_browser(self) -> dict:
        prefer = self.selected_process.exe_name if self.selected_process else "chrome.exe"
        exe = browser_control.find_browser_executable(prefer)
        if not exe and self.selected_process and os.path.isfile(self.selected_process.exe_path):
            exe = self.selected_process.exe_path
        if not exe:
            raise RuntimeError("No supported browser was found. Install Google Chrome or Microsoft Edge and try again.")
        brand = browser_control.KNOWN_BROWSERS.get(os.path.basename(exe).lower(), {}).get("name", "the browser")
        self.log.info(f"Opening {brand} with the tool's own profile.")
        endpoint = browser_control.find_endpoint(None)
        if endpoint:
            # A tool-controlled browser is already running from an earlier start.
            return self._attach(endpoint, brand)
        endpoint = browser_control.launch_controlled_browser(
            exe, self.folders["profile"], browser_control.STUDIO_URL, port=int(self.settings.get("remote_port", 9222))
        )
        self.settings.set("remote_port", endpoint.port)
        # Give the first tab a moment to appear.
        import time

        time.sleep(1.5)
        return self._attach(endpoint, brand)

    @_safe
    def connect_status(self) -> dict:
        if not self.studio:
            return {"connected": False, "signed_in": False}
        try:
            url = self.studio.url()
        except DevToolsError:
            # The tab may have been replaced; try to attach again.
            if self.endpoint:
                self.page, _ = connect_studio(self.endpoint, self.log.write)
                self.studio = Studio(self.page, self.log.write)
                url = self.studio.url()
            else:
                return {"connected": False, "signed_in": False}
        return {"connected": True, "signed_in": self.studio.is_signed_in(), "url": url}

    def _get_studio(self) -> Studio:
        if not self.studio or not self.endpoint:
            raise RuntimeError("Connect to a browser window first (step 1).")
        try:
            self.studio.url()
        except DevToolsError:
            self.page, _ = connect_studio(self.endpoint, self.log.write)
            self.studio = Studio(self.page, self.log.write)
        return self.studio

    # ---- videos --------------------------------------------------------------------
    @_safe
    def load_videos(self, source: dict | None = None) -> dict:
        source = source or {}
        kind = str(source.get("kind") or "current")
        value = str(source.get("url") or "")
        studio = self._get_studio()
        url = studio.open_list(kind, value)
        videos = studio.list_videos()
        self.videos = [v.to_dict() for v in videos]
        label = {"current": "the open page", "channel": "all channel videos", "playlist": "playlist"}.get(kind, kind)
        if kind == "playlist":
            found = re.search(r"(PL|UU|LL|OL)[\w-]+", url)
            label = ("playlist " + found.group(0)) if found else "playlist"
        self.settings.set("last_source", kind)
        drafts = sum(1 for v in self.videos if v["status"] == "draft")
        message = f"{len(self.videos)} videos found" + (f", {drafts} of them drafts." if drafts else ".")
        self.log.info(message)
        return {"videos": self.videos, "message": message, "source_label": label}

    @_safe
    def export_titles(self, videos: list[dict] | None = None) -> dict:
        videos = videos or self.videos
        if not videos:
            raise RuntimeError("Load the videos first.")
        stamp = _dt.datetime.now().strftime("%Y-%m-%d %H-%M")
        path = self.folders["root"] / f"Titles {stamp}.csv"
        with path.open("w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.writer(handle)
            writer.writerow(["Video ID", "Title", "Status", "Date", "Length"])
            for v in videos:
                writer.writerow([v.get("id", ""), v.get("title", ""), v.get("status_label", v.get("status", "")), v.get("date", ""), v.get("duration", "")])
        self.log.success(f"Saved title list to {path}")
        return {"path": str(path)}

    # ---- rename -----------------------------------------------------------------------
    @_safe
    def preview_rename(self, videos: list[dict], rules: list[dict]) -> dict:
        problems = rename.validate_rules(rules)
        rows = [row.to_dict() for row in rename.preview(videos or [], rules or [])]
        self.settings.set("rename_rules", rules or [])
        return {"rows": rows, "problems": problems}

    def _preset_path(self, name: str) -> Path:
        safe = re.sub(r"[^\w\- ]+", "", name).strip() or "preset"
        return self.folders["presets"] / f"{safe}.json"

    @_safe
    def list_presets(self) -> dict:
        names = sorted(p.stem for p in self.folders["presets"].glob("*.json"))
        return {"presets": names}

    @_safe
    def save_preset(self, name: str, rules: list[dict]) -> dict:
        if not name:
            raise ValueError("Give the rule set a name.")
        self._preset_path(name).write_text(json.dumps(rules or [], indent=2), encoding="utf-8")
        return {"saved": True}

    @_safe
    def load_preset(self, name: str) -> dict:
        path = self._preset_path(name)
        if not path.exists():
            raise ValueError("That rule set no longer exists.")
        return {"rules": json.loads(path.read_text(encoding="utf-8"))}

    @_safe
    def delete_preset(self, name: str) -> dict:
        path = self._preset_path(name)
        if path.exists():
            path.unlink()
        return {"deleted": True}

    # ---- running ------------------------------------------------------------------------
    @_safe
    def start_changes(self, plan: dict) -> dict:
        plan = plan or {}
        videos = plan.get("videos") or []
        changes = plan.get("changes") or []
        dry_run = bool(plan.get("dry_run"))
        pause = float(plan.get("pause") or 0)
        self.settings.set("pause_between_videos", pause)
        self._get_studio()
        self.runner.start(videos, changes, dry_run=dry_run, pause=pause)
        return {"started": True}

    @_safe
    def progress(self, since: int = 0) -> dict:
        return self.runner.progress(int(since or 0))

    @_safe
    def stop_changes(self) -> dict:
        self.runner.stop()
        return {"stopping": True}

    # ---- window & folder ---------------------------------------------------------------
    @_safe
    def open_folder(self) -> dict:
        folder = str(self.folders["logs"])
        if sys.platform == "win32":
            os.startfile(folder)  # noqa: S606
        else:
            subprocess.Popen(["xdg-open", folder])  # noqa: S603, S607
        return {"opened": folder}

    @_safe
    def minimize(self) -> dict:
        if self.window:
            self.window.minimize()
        return {}

    @_safe
    def toggle_maximize(self) -> dict:
        if self.window:
            if self._maximized:
                self.window.restore()
            else:
                self.window.maximize()
            self._maximized = not self._maximized
        return {"maximized": self._maximized}

    @_safe
    def close(self) -> dict:
        if self.page:
            try:
                self.page.close()
            except Exception:  # noqa: BLE001
                pass
        if self.window:
            self.window.destroy()
        return {}
