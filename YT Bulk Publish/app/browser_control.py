"""Find, inspect and start browsers so the tool can work inside them.

A browser can only be controlled when it was started with a remote-control
port. This module figures out whether the window the user picked already has
one, and if not, starts a browser (same brand when possible) with a profile
kept in the tool's own folder so the sign-in only has to happen once.
"""
from __future__ import annotations

import os
import re
import shlex
import socket
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from .cdp import BrowserEndpoint

KNOWN_BROWSERS = {
    "chrome.exe": {
        "name": "Google Chrome",
        "user_data": r"%LOCALAPPDATA%\Google\Chrome\User Data",
        "paths": [
            r"%PROGRAMFILES%\Google\Chrome\Application\chrome.exe",
            r"%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe",
            r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe",
        ],
    },
    "msedge.exe": {
        "name": "Microsoft Edge",
        "user_data": r"%LOCALAPPDATA%\Microsoft\Edge\User Data",
        "paths": [
            r"%PROGRAMFILES(X86)%\Microsoft\Edge\Application\msedge.exe",
            r"%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe",
        ],
    },
    "brave.exe": {
        "name": "Brave",
        "user_data": r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data",
        "paths": [
            r"%PROGRAMFILES%\BraveSoftware\Brave-Browser\Application\brave.exe",
            r"%PROGRAMFILES(X86)%\BraveSoftware\Brave-Browser\Application\brave.exe",
        ],
    },
    "vivaldi.exe": {
        "name": "Vivaldi",
        "user_data": r"%LOCALAPPDATA%\Vivaldi\User Data",
        "paths": [r"%LOCALAPPDATA%\Vivaldi\Application\vivaldi.exe"],
    },
    "chromium.exe": {
        "name": "Chromium",
        "user_data": r"%LOCALAPPDATA%\Chromium\User Data",
        "paths": [r"%LOCALAPPDATA%\Chromium\Application\chromium.exe"],
    },
}

STUDIO_URL = "https://studio.youtube.com/"
PROBE_PORTS = tuple(range(9222, 9232))


@dataclass
class BrowserProcess:
    pid: int
    exe_name: str
    exe_path: str
    cmdline: list[str] = field(default_factory=list)
    user_data_dir: str = ""
    profile_dir: str = ""
    debug_port: int | None = None

    @property
    def brand(self) -> str:
        return KNOWN_BROWSERS.get(self.exe_name, {}).get("name", self.exe_name or "Browser")

    @property
    def is_chromium_based(self) -> bool:
        return self.exe_name in KNOWN_BROWSERS


def _expand(path: str) -> str:
    return os.path.expandvars(path)


def _flag_value(cmdline: list[str], flag: str) -> str:
    prefix = f"--{flag}="
    for part in cmdline:
        if part.startswith(prefix):
            return part[len(prefix):].strip('"')
    return ""


def inspect_pid(pid: int) -> BrowserProcess | None:
    """Describe the process that owns a window (None if it is not a known browser)."""
    try:
        import psutil

        proc = psutil.Process(int(pid))
        exe_name = proc.name().lower()
        exe_path = proc.exe()
        cmdline = proc.cmdline()
    except Exception:  # noqa: BLE001
        return None
    if exe_name not in KNOWN_BROWSERS and exe_name != "firefox.exe":
        return None
    info = BrowserProcess(pid=int(pid), exe_name=exe_name, exe_path=exe_path, cmdline=cmdline)
    info.user_data_dir = _flag_value(cmdline, "user-data-dir") or _expand(
        KNOWN_BROWSERS.get(exe_name, {}).get("user_data", "")
    )
    info.profile_dir = _flag_value(cmdline, "profile-directory") or "Default"
    port = _flag_value(cmdline, "remote-debugging-port")
    if port.isdigit():
        info.debug_port = int(port)
    return info


def _port_from_active_file(user_data_dir: str) -> int | None:
    """Chromium writes the live remote-control port into DevToolsActivePort."""
    if not user_data_dir:
        return None
    path = Path(user_data_dir) / "DevToolsActivePort"
    try:
        first_line = path.read_text(encoding="utf-8", errors="ignore").splitlines()[0].strip()
        return int(first_line) if first_line.isdigit() else None
    except (OSError, IndexError, ValueError):
        return None


def find_endpoint(process: BrowserProcess | None) -> BrowserEndpoint | None:
    """Return a working remote-control endpoint for this browser, if there is one."""
    candidates: list[int] = []
    if process:
        if process.debug_port:
            candidates.append(process.debug_port)
        file_port = _port_from_active_file(process.user_data_dir)
        if file_port:
            candidates.append(file_port)
    candidates.extend(p for p in PROBE_PORTS if p not in candidates)
    for port in candidates:
        endpoint = BrowserEndpoint(port=port)
        if endpoint.is_alive(timeout=0.8):
            return endpoint
    return None


def free_port(preferred: int = 9222) -> int:
    for port in [preferred, *PROBE_PORTS]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def find_browser_executable(prefer_exe: str = "") -> str:
    """Find an installed Chromium-based browser, preferring the given brand."""
    order = [prefer_exe] + [name for name in ("chrome.exe", "msedge.exe", "brave.exe", "vivaldi.exe", "chromium.exe") if name != prefer_exe]
    for exe_name in order:
        entry = KNOWN_BROWSERS.get(exe_name)
        if not entry:
            continue
        for candidate in entry["paths"]:
            expanded = _expand(candidate)
            if os.path.isfile(expanded):
                return expanded
    if sys.platform == "win32":
        try:
            import winreg

            for exe_name in order:
                if exe_name not in KNOWN_BROWSERS:
                    continue
                for root in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
                    try:
                        key = winreg.OpenKey(root, rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe_name}")
                        value, _kind = winreg.QueryValueEx(key, "")
                        if value and os.path.isfile(value):
                            return value
                    except OSError:
                        continue
        except ImportError:
            pass
    return ""


def launch_controlled_browser(
    exe_path: str,
    profile_folder: str | Path,
    url: str = STUDIO_URL,
    port: int | None = None,
    wait_seconds: float = 25.0,
    profile_directory: str = "",
) -> BrowserEndpoint:
    """Start a browser with remote control switched on and wait until it answers."""
    if not exe_path or not os.path.isfile(exe_path):
        raise RuntimeError("No supported browser was found on this computer. Install Google Chrome or Microsoft Edge.")
    port = port or free_port()
    profile_folder = str(profile_folder)
    Path(profile_folder).mkdir(parents=True, exist_ok=True)
    args = [
        exe_path,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile_folder}",
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-session-crashed-bubble",
        "--new-window",
    ]
    if profile_directory:
        args.append(f"--profile-directory={profile_directory}")
    args.append(url)
    creation_flags = 0
    if sys.platform == "win32":
        creation_flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    subprocess.Popen(args, creationflags=creation_flags, close_fds=True)  # noqa: S603
    endpoint = BrowserEndpoint(port=port)
    deadline = time.time() + wait_seconds
    while time.time() < deadline:
        if endpoint.is_alive(timeout=1.0):
            return endpoint
        time.sleep(0.5)
    raise RuntimeError(
        "The browser started but did not switch on remote control. If it was already running, close every "
        "window of it and try again."
    )


def close_browser(exe_name: str, wait_seconds: float = 20.0) -> bool:
    """Ask every window of a browser to close, then wait for the processes to end."""
    if sys.platform != "win32":
        return False
    import psutil
    import win32con
    import win32gui
    import win32process

    pids = {p.pid for p in psutil.process_iter(["name"]) if (p.info["name"] or "").lower() == exe_name}
    if not pids:
        return True

    def visit(handle, _extra):
        _thread, pid = win32process.GetWindowThreadProcessId(handle)
        if pid in pids and win32gui.IsWindowVisible(handle):
            win32gui.PostMessage(handle, win32con.WM_CLOSE, 0, 0)

    win32gui.EnumWindows(visit, None)
    deadline = time.time() + wait_seconds
    while time.time() < deadline:
        alive = [pid for pid in pids if psutil.pid_exists(pid)]
        if not alive:
            return True
        time.sleep(0.5)
    return False


def describe_command(args: list[str]) -> str:
    return " ".join(shlex.quote(a) for a in args)


def is_studio_url(url: str) -> bool:
    return bool(re.match(r"^https://studio\.youtube\.com/", url or ""))
