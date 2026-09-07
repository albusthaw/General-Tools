"""Folders, saved preferences and the activity log.

Everything the program keeps lives in one folder called "YT Bulk Publish"
inside the user's Documents folder:

    Documents/YT Bulk Publish/
        Browser Profile/   sign-in data for the tool-controlled browser
        Logs/              one text log per run
        Presets/           saved rename and settings presets
        settings.json      window size, last used options
"""
from __future__ import annotations

import ctypes
import datetime as _dt
import json
import os
import sys
import threading
from pathlib import Path

APP_NAME = "YT Bulk Publish"
APP_VERSION = "1.0.0"


def _documents_folder() -> Path:
    """Return the user's Documents folder (works with OneDrive-redirected folders)."""
    if sys.platform == "win32":
        try:
            buffer = ctypes.create_unicode_buffer(1024)
            # CSIDL_PERSONAL = 5 -> "My Documents", SHGFP_TYPE_CURRENT = 0
            if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buffer) == 0 and buffer.value:
                return Path(buffer.value)
        except Exception:  # noqa: BLE001
            pass
        user_profile = os.environ.get("USERPROFILE")
        if user_profile:
            return Path(user_profile) / "Documents"
    home_documents = Path.home() / "Documents"
    return home_documents if home_documents.exists() else Path.home()


def app_folder() -> Path:
    override = os.environ.get("YT_BULK_PUBLISH_HOME")
    return Path(override) if override else _documents_folder() / APP_NAME


def ensure_folders() -> dict[str, Path]:
    """Create the app folder tree if needed and return the paths."""
    root = app_folder()
    folders = {
        "root": root,
        "profile": root / "Browser Profile",
        "logs": root / "Logs",
        "presets": root / "Presets",
    }
    for path in folders.values():
        path.mkdir(parents=True, exist_ok=True)
    return folders


def resource_path(*parts: str) -> Path:
    """Locate a bundled file both when running from source and from the packaged EXE."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    if getattr(sys, "_MEIPASS", None):
        return base / "app" / Path(*parts)
    return base / Path(*parts)


class Settings:
    """Small JSON-backed preference store."""

    DEFAULTS = {
        "window": {"width": 1180, "height": 780},
        "last_source": "",
        "audience": "not_for_kids",
        "pause_between_videos": 1.5,
        "rename_rules": [],
        "remote_port": 9222,
    }

    def __init__(self, path: Path | None = None):
        self.path = path or (app_folder() / "settings.json")
        self.data = dict(self.DEFAULTS)
        self.load()

    def load(self) -> None:
        try:
            if self.path.exists():
                stored = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(stored, dict):
                    self.data.update(stored)
        except (OSError, ValueError):
            pass

    def save(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
        except OSError:
            pass

    def get(self, key: str, default=None):
        return self.data.get(key, default)

    def set(self, key: str, value) -> None:
        self.data[key] = value
        self.save()


class ActivityLog:
    """Thread-safe log that writes to a file and keeps recent lines for the screen."""

    def __init__(self, folder: Path | None = None, keep: int = 500):
        folder = folder or ensure_folders()["logs"]
        stamp = _dt.datetime.now().strftime("%Y-%m-%d %H-%M-%S")
        self.path = folder / f"Run {stamp}.txt"
        self.keep = keep
        self.lines: list[dict] = []
        self._lock = threading.Lock()
        self._listeners: list = []

    def subscribe(self, callback) -> None:
        self._listeners.append(callback)

    def write(self, message: str, level: str = "info") -> dict:
        entry = {
            "time": _dt.datetime.now().strftime("%H:%M:%S"),
            "level": level,
            "message": str(message),
        }
        with self._lock:
            self.lines.append(entry)
            if len(self.lines) > self.keep:
                del self.lines[: len(self.lines) - self.keep]
            try:
                with self.path.open("a", encoding="utf-8") as handle:
                    handle.write(f"[{entry['time']}] {level.upper():7} {entry['message']}\n")
            except OSError:
                pass
        for callback in list(self._listeners):
            try:
                callback(entry)
            except Exception:  # noqa: BLE001
                pass
        return entry

    def info(self, message: str) -> None:
        self.write(message, "info")

    def success(self, message: str) -> None:
        self.write(message, "success")

    def warning(self, message: str) -> None:
        self.write(message, "warning")

    def error(self, message: str) -> None:
        self.write(message, "error")

    def recent(self, since_index: int = 0) -> list[dict]:
        with self._lock:
            return list(self.lines[since_index:])
