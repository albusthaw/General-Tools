"""The bridge between the interface and the Python side.

Every public method here can be called from the interface. Methods return
plain dictionaries; when something goes wrong they return {"error": message}
written in everyday language.

Everything that is not meant to be called from the interface is kept in
attributes whose names start with an underscore. The window library looks
through every public attribute of this object when the page loads; a public
reference to the window itself (or to a browser tab) sends it wandering
through the whole window system, which froze or crashed the program.
"""
from __future__ import annotations

import csv
import datetime as _dt
import functools
import json
import os
import re
import subprocess
import sys
import threading
import traceback
from pathlib import Path

from . import browser_control, rename, window_picker
from .cdp import BrowserEndpoint, DevToolsError, Page
from .engine import BatchRunner
from .settings import APP_NAME, APP_VERSION, ActivityLog, Settings, ensure_folders
from .studio import Studio, StudioError, connect_studio

SUBTITLE = "Bulk publish, rename and update your YouTube videos"

BUSY_MESSAGE = "The tool is still busy with the last step. Please wait a moment, then try again."
RUNNING_MESSAGE = "Changes are still running. Wait until they finish, or press Stop first."
UNEXPECTED_MESSAGE = (
    "Something went wrong in that step. Try again; if it keeps happening, restart the program. "
    "The details are in the log file (Open log folder)."
)


def _safe(method):
    """Turn exceptions into {"error": ...} so the interface can show them."""

    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):
        try:
            return method(self, *args, **kwargs)
        except (StudioError, DevToolsError, RuntimeError, ValueError) as exc:
            self._log.error(str(exc))
            return {"error": str(exc)}
        except Exception:  # noqa: BLE001
            # Technical details go to the log file only; the screen gets plain words.
            self._log.error("Something went wrong in that step.")
            self._log.file_only(f"{method.__name__}: {traceback.format_exc()}")
            return {"error": UNEXPECTED_MESSAGE}

    return wrapper


class Api:
    def __init__(self):
        self._folders = ensure_folders()
        self._settings = Settings(self._folders["root"] / "settings.json")
        self._log = ActivityLog(self._folders["logs"])
        self._window = None  # set by main once the window exists
        self._endpoint: BrowserEndpoint | None = None
        self._page: Page | None = None
        self._studio: Studio | None = None
        self._selected_process: browser_control.BrowserProcess | None = None
        self._runner = BatchRunner(self._get_studio, self._log)
        self._videos: list[dict] = []
        self._maximized = False
        # One connection attempt and one window listing at a time: the interface
        # runs every call on its own thread, so a second press would otherwise
        # start a second copy of the same slow job.
        self._connect_lock = threading.Lock()
        self._list_lock = threading.Lock()
        self._log.info(f"{APP_NAME} {APP_VERSION} started. Folder: {self._folders['root']}")

    # ---- used by main (not visible to the interface) -------------------------------
    def _set_window(self, window) -> None:
        self._window = window

    def _window_size(self) -> dict:
        return self._settings.get("window", {}) or {}

    def _remember_window_size(self) -> None:
        if self._window is None:
            return
        try:
            self._settings.set("window", {"width": self._window.width, "height": self._window.height})
        except Exception:  # noqa: BLE001
            pass

    # ---- app -----------------------------------------------------------------------
    @_safe
    def app_info(self) -> dict:
        return {
            "name": APP_NAME,
            "version": APP_VERSION,
            "subtitle": SUBTITLE,
            "folder": str(self._folders["root"]),
            "settings": {
                "rename_rules": self._settings.get("rename_rules", []),
                "pause_between_videos": self._settings.get("pause_between_videos", 1.5),
            },
        }

    # ---- windows ---------------------------------------------------------------------
    @_safe
    def list_windows(self) -> dict:
        """List browser windows quickly, without pictures (see window_pictures)."""
        if not self._list_lock.acquire(timeout=20):
            raise RuntimeError(BUSY_MESSAGE)
        try:
            windows = window_picker.list_windows(only_browsers=True, with_thumbnails=False, skip_title=APP_NAME)
            profile = str(self._folders["profile"])
            # Many windows share one browser process, so each process is checked once.
            by_pid: dict[int, tuple[bool, bool]] = {}
            result = []
            for w in windows:
                item = w.to_dict()
                if w.is_browser and w.pid not in by_pid:
                    process = browser_control.inspect_pid(w.pid)
                    ready = bool(process and process.is_chromium_based and browser_control.find_endpoint(process))
                    own = bool(process and browser_control.same_path(process.user_data_dir, profile))
                    by_pid[w.pid] = (ready, own)
                item["remote"], item["tool_browser"] = by_pid.get(w.pid, (False, False))
                result.append(item)
        finally:
            self._list_lock.release()
        if sys.platform != "win32" and not result:
            return {"windows": [], "message": "Window pictures are only available on Windows."}
        return {"windows": result}

    @_safe
    def window_pictures(self, handles: list | None = None) -> dict:
        """Small pictures of the listed windows, taken one at a time with a time limit."""
        wanted = [int(h) for h in (handles or []) if str(h).lstrip("-").isdigit()]
        pictures = window_picker.capture_many(wanted)
        return {"pictures": {str(handle): data for handle, data in pictures.items() if data}}

    def _attach(self, endpoint: BrowserEndpoint, brand: str, wait_for_tab: float = 0.0) -> dict:
        old_page = self._page
        page, target = connect_studio(endpoint, self._log.write, wait_for_tab=wait_for_tab)
        if old_page is not None and old_page is not page:
            try:
                old_page.close()
            except Exception:  # noqa: BLE001
                pass
        self._endpoint = endpoint
        self._page = page
        self._studio = Studio(page, self._log.write)
        self._log.info(f"Connected to {brand}: {target.get('title', '') or target.get('url', '')}")
        signed_in = self._studio.wait_signed_in(timeout=8.0 if wait_for_tab else 2.0)
        if signed_in:
            return {"status": "connected", "browser": brand, "message": "YouTube Studio is open and signed in."}
        return {
            "status": "waiting_signin",
            "browser": brand,
            "message": "The browser is ready. Sign in to YouTube Studio in that window, then press the button below.",
        }

    @_safe
    def choose_window(self, handle: int) -> dict:
        if self._runner.running:
            # Connecting again would close the tab the run is working in.
            return {"status": "busy", "message": RUNNING_MESSAGE}
        if not self._connect_lock.acquire(blocking=False):
            return {"status": "busy", "message": BUSY_MESSAGE}
        try:
            match = next((w for w in window_picker.list_windows(with_thumbnails=False) if w.handle == int(handle)), None)
            if not match:
                return {"status": "error", "message": "That window has closed. Press Refresh and try again."}
            process = browser_control.inspect_pid(match.pid)
            if not process:
                return {"status": "not_browser", "message": "Pick a Google Chrome, Microsoft Edge or Brave window."}
            self._selected_process = process
            if process.exe_name == "firefox.exe":
                return {
                    "status": "needs_remote",
                    "message": "Firefox windows cannot be controlled by this tool. Let the tool open Chrome or Edge instead; you sign in there once.",
                }
            endpoint = browser_control.find_endpoint(process)
            if endpoint:
                window_picker.focus_window(match.handle)
                return self._attach(endpoint, process.brand)
            return {
                "status": "needs_remote",
                "browser": process.brand,
                "message": (
                    f"This {process.brand} window was opened normally, so the tool cannot reach inside it. "
                    "Let the tool open its own browser window instead. You sign in there once and it is remembered."
                ),
            }
        finally:
            self._connect_lock.release()

    def _bring_tool_browser_forward(self) -> None:
        pids = {p.pid for p in browser_control.profile_processes(self._folders["profile"])}
        for handle in window_picker.windows_of_processes(pids):
            if window_picker.focus_window(handle):
                break

    @_safe
    def open_tool_browser(self) -> dict:
        if self._runner.running:
            return {"status": "busy", "message": RUNNING_MESSAGE}
        if not self._connect_lock.acquire(blocking=False):
            return {"status": "busy", "message": BUSY_MESSAGE}
        try:
            return self._open_tool_browser()
        finally:
            self._connect_lock.release()

    def _open_tool_browser(self) -> dict:
        profile = self._folders["profile"]
        prefer = self._selected_process.exe_name if self._selected_process else "chrome.exe"
        exe = browser_control.find_browser_executable(prefer)
        if not exe and self._selected_process and os.path.isfile(self._selected_process.exe_path):
            exe = self._selected_process.exe_path
        brand = browser_control.KNOWN_BROWSERS.get(os.path.basename(exe).lower(), {}).get("name", "the browser") if exe else "the browser"

        # The tool's browser may still be open from before: use it instead of starting another.
        endpoint = browser_control.find_profile_endpoint(profile)
        if endpoint:
            self._log.info("The tool's browser is already open; using it.")
            running = browser_control.profile_processes(profile)
            if running:
                running_name = str(running[0].info.get("name") or "").lower()
                brand = browser_control.KNOWN_BROWSERS.get(running_name, {}).get("name", brand)
            result = self._attach(endpoint, brand)
            self._bring_tool_browser_forward()
            return result

        if browser_control.profile_processes(profile):
            # Open with the tool's profile but without remote control (for example after
            # a crash). It has to close before it can be started again with control.
            self._log.warning("The tool's browser is open but cannot be controlled. Closing it and starting it again.")
            browser_control.close_profile_browser(profile)

        if not exe:
            raise RuntimeError("No supported browser was found. Install Google Chrome or Microsoft Edge and try again.")
        self._log.info(f"Opening {brand} with the tool's own profile.")
        try:
            endpoint = browser_control.launch_controlled_browser(exe, profile, browser_control.STUDIO_URL)
        except browser_control.BrowserBusyError:
            self._log.warning("The tool's browser did not switch on remote control. Closing it and trying once more.")
            browser_control.close_profile_browser(profile)
            endpoint = browser_control.launch_controlled_browser(exe, profile, browser_control.STUDIO_URL)
        result = self._attach(endpoint, brand, wait_for_tab=8.0)
        self._bring_tool_browser_forward()
        return result

    @_safe
    def connect_status(self) -> dict:
        if not self._studio:
            return {"connected": False, "signed_in": False}
        try:
            url = self._studio.url()
        except DevToolsError:
            # The tab may have been replaced; try to attach again.
            if self._endpoint:
                self._page, _ = connect_studio(self._endpoint, self._log.write)
                self._studio = Studio(self._page, self._log.write)
                url = self._studio.url()
            else:
                return {"connected": False, "signed_in": False}
        return {"connected": True, "signed_in": self._studio.is_signed_in(), "url": url}

    def _get_studio(self) -> Studio:
        if not self._studio or not self._endpoint:
            raise RuntimeError("Connect to a browser window first (step 1).")
        try:
            self._studio.url()
        except DevToolsError:
            self._page, _ = connect_studio(self._endpoint, self._log.write)
            self._studio = Studio(self._page, self._log.write)
        return self._studio

    # ---- videos --------------------------------------------------------------------
    @_safe
    def load_videos(self, source: dict | None = None) -> dict:
        if self._runner.running:
            raise RuntimeError(RUNNING_MESSAGE)
        source = source or {}
        kind = str(source.get("kind") or "current")
        value = str(source.get("url") or "")
        studio = self._get_studio()
        if kind == "current" and not studio.current_page_is_list():
            # The open page is not a video list (for example the dashboard): read the channel's videos.
            self._log.info("The open page has no video list, so all channel videos are read instead.")
            kind = "channel"
        url = studio.open_list(kind, value)
        videos = studio.list_videos()
        self._videos = [v.to_dict() for v in videos]
        label = {"current": "the open page", "channel": "all channel videos", "playlist": "playlist"}.get(kind, kind)
        if kind == "playlist":
            found = re.search(r"(PL|UU|LL|OL)[\w-]+", url)
            label = ("playlist " + found.group(0)) if found else "playlist"
        self._settings.set("last_source", kind)
        drafts = sum(1 for v in self._videos if v["status"] == "draft")
        message = f"{len(self._videos)} videos found" + (f", {drafts} of them drafts." if drafts else ".")
        self._log.info(message)
        return {"videos": self._videos, "message": message, "source_label": label}

    @_safe
    def export_titles(self, videos: list[dict] | None = None) -> dict:
        videos = videos or self._videos
        if not videos:
            raise RuntimeError("Load the videos first.")
        stamp = _dt.datetime.now().strftime("%Y-%m-%d %H-%M")
        path = self._folders["root"] / f"Titles {stamp}.csv"
        with path.open("w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.writer(handle)
            writer.writerow(["Video ID", "Title", "Status", "Date", "Length"])
            for v in videos:
                writer.writerow([v.get("id", ""), v.get("title", ""), v.get("status_label", v.get("status", "")), v.get("date", ""), v.get("duration", "")])
        self._log.success(f"Saved title list to {path}")
        return {"path": str(path)}

    # ---- rename -----------------------------------------------------------------------
    @_safe
    def preview_rename(self, videos: list[dict], rules: list[dict]) -> dict:
        problems = rename.validate_rules(rules)
        rows = [row.to_dict() for row in rename.preview(videos or [], rules or [])]
        self._settings.set("rename_rules", rules or [])
        return {"rows": rows, "problems": problems}

    def _preset_path(self, name: str) -> Path:
        safe = re.sub(r"[^\w\- ]+", "", name).strip() or "preset"
        return self._folders["presets"] / f"{safe}.json"

    @_safe
    def list_presets(self) -> dict:
        names = sorted(p.stem for p in self._folders["presets"].glob("*.json"))
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
        self._settings.set("pause_between_videos", pause)
        self._get_studio()
        self._runner.start(videos, changes, dry_run=dry_run, pause=pause)
        return {"started": True}

    @_safe
    def progress(self, since: int = 0) -> dict:
        return self._runner.progress(int(since or 0))

    @_safe
    def stop_changes(self) -> dict:
        self._runner.stop()
        return {"stopping": True}

    # ---- window & folder ---------------------------------------------------------------
    @_safe
    def open_folder(self) -> dict:
        folder = str(self._folders["logs"])
        if sys.platform == "win32":
            os.startfile(folder)  # noqa: S606
        else:
            subprocess.Popen(["xdg-open", folder], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # noqa: S603, S607
        return {"opened": folder}

    @_safe
    def minimize(self) -> dict:
        if self._window:
            self._window.minimize()
        return {}

    @_safe
    def toggle_maximize(self) -> dict:
        if self._window:
            if self._maximized:
                self._window.restore()
            else:
                self._window.maximize()
            self._maximized = not self._maximized
        return {"maximized": self._maximized}

    @_safe
    def close(self) -> dict:
        if self._runner.running:
            self._runner.stop()
        if self._page:
            try:
                self._page.close()
            except Exception:  # noqa: BLE001
                pass
        if self._window:
            self._window.destroy()
        return {}
