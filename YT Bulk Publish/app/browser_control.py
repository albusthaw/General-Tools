"""Find, inspect and start browsers so the tool can work inside them.

A browser can only be controlled when it was started with a remote-control
port. This module figures out whether the window the user picked already has
one, and if not, starts a browser (same brand when possible) with a profile
kept in the tool's own folder so the sign-in only has to happen once.

Everything here has to answer quickly: the interface waits on these calls, so
ports are looked up from the browser process itself instead of being guessed,
and every network check uses a short time limit.
"""
from __future__ import annotations

import os
import re
import shlex
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
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
# Ports people commonly use for remote control. Only tried when nothing better is known.
PROBE_PORTS = tuple(range(9222, 9232))
# Time limit for one "is a browser listening here?" check. Local answers take a few
# milliseconds; a closed port on Windows can otherwise hang for about two seconds.
PORT_CHECK_TIMEOUT = 0.6


# Browsers started by this program (kept so their process handles stay valid).
_LAUNCHED: list[subprocess.Popen] = []


class BrowserBusyError(RuntimeError):
    """The tool's own browser profile is open in a browser that cannot be controlled."""


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


def same_path(a: str, b: str) -> bool:
    if not a or not b:
        return False
    try:
        return os.path.normcase(os.path.abspath(a)).rstrip("\\/") == os.path.normcase(os.path.abspath(b)).rstrip("\\/")
    except (TypeError, ValueError):
        return False


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
    if port.isdigit() and int(port) > 0:
        info.debug_port = int(port)
    return info


def _port_from_active_file(user_data_dir: str | Path) -> int | None:
    """Chromium writes the live remote-control port into DevToolsActivePort."""
    if not user_data_dir:
        return None
    path = Path(user_data_dir) / "DevToolsActivePort"
    try:
        first_line = path.read_text(encoding="utf-8", errors="ignore").splitlines()[0].strip()
        return int(first_line) if first_line.isdigit() and int(first_line) > 0 else None
    except (OSError, IndexError, ValueError):
        return None


def listening_ports(pid: int) -> list[int] | None:
    """Local TCP ports a process listens on, or None when the system does not say."""
    try:
        import psutil

        proc = psutil.Process(int(pid))
        getter = getattr(proc, "net_connections", None) or proc.connections
        connections = getter(kind="tcp")
    except Exception:  # noqa: BLE001
        return None
    ports = set()
    for conn in connections:
        address = getattr(conn, "laddr", None)
        if conn.status == "LISTEN" and address and address.ip in ("127.0.0.1", "::1", "0.0.0.0", "::"):
            ports.add(int(address.port))
    return sorted(ports)


def _first_alive(ports: list[int]) -> BrowserEndpoint | None:
    """Check several ports at the same time and return the first one (in order) that answers."""
    ordered: list[int] = []
    for port in ports:
        if port and port not in ordered:
            ordered.append(int(port))
    if not ordered:
        return None
    if len(ordered) == 1:
        endpoint = BrowserEndpoint(port=ordered[0])
        return endpoint if endpoint.is_alive(timeout=PORT_CHECK_TIMEOUT) else None
    with ThreadPoolExecutor(max_workers=min(8, len(ordered))) as pool:
        answers = list(pool.map(lambda p: BrowserEndpoint(port=p).is_alive(timeout=PORT_CHECK_TIMEOUT), ordered))
    for port, alive in zip(ordered, answers):
        if alive:
            return BrowserEndpoint(port=port)
    return None


def find_endpoint(process: BrowserProcess | None, try_common_ports: bool = False) -> BrowserEndpoint | None:
    """Return a working remote-control endpoint for this browser process, if it has one.

    The port comes from the browser's own start-up options, its DevToolsActivePort
    file, or the ports the process is listening on. Common ports are only tried
    when asked, because they may belong to a different browser.
    """
    candidates: list[int] = []
    if process:
        if process.debug_port:
            candidates.append(process.debug_port)
        file_port = _port_from_active_file(process.user_data_dir)
        if file_port:
            candidates.append(file_port)
        listening = listening_ports(process.pid)
        if listening is not None:
            # The system told us exactly which ports this browser has open:
            # only those can be its remote-control port.
            candidates = [p for p in candidates if p in listening] + [p for p in listening if p not in candidates]
    if try_common_ports:
        candidates.extend(p for p in PROBE_PORTS if p not in candidates)
    return _first_alive(candidates)


def profile_processes(profile_folder: str | Path) -> list:
    """Main browser processes that are using the given profile folder."""
    try:
        import psutil
    except ImportError:
        return []
    found = []
    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            cmdline = proc.info.get("cmdline") or []
            if any(part.startswith("--type=") for part in cmdline):
                continue  # helper processes (tabs, GPU) follow the main one
            if same_path(_flag_value(cmdline, "user-data-dir"), str(profile_folder)):
                found.append(proc)
        except Exception:  # noqa: BLE001
            continue
    return found


def find_profile_endpoint(profile_folder: str | Path) -> BrowserEndpoint | None:
    """Return the remote-control endpoint of a browser already running with this profile."""
    file_port = _port_from_active_file(profile_folder)
    try:
        import psutil  # noqa: F401
    except ImportError:
        return _first_alive([file_port or 0])
    # The port file can be left behind by a browser that has closed, so it only
    # counts while a browser is really running with this profile.
    for proc in profile_processes(profile_folder):
        cmdline = proc.info.get("cmdline") or []
        ports: list[int] = []
        flag = _flag_value(cmdline, "remote-debugging-port")
        if flag.isdigit() and int(flag) > 0:
            ports.append(int(flag))
        if file_port:
            ports.append(file_port)
        listening = listening_ports(proc.pid)
        if listening is not None:
            ports = [p for p in ports if p in listening] + [p for p in listening if p not in ports]
        endpoint = _first_alive(ports)
        if endpoint:
            return endpoint
    return None


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
    port: int = 0,
    wait_seconds: float = 30.0,
    profile_directory: str = "",
    extra_args: list[str] | tuple[str, ...] = (),
) -> BrowserEndpoint:
    """Start a browser with remote control switched on and wait until it answers.

    With port 0 the browser picks a free port itself and writes it into the
    profile's DevToolsActivePort file, so a port already taken by another program
    can never stop it from starting.
    """
    if not exe_path or not os.path.isfile(exe_path):
        raise RuntimeError("No supported browser was found on this computer. Install Google Chrome or Microsoft Edge.")
    profile_folder = str(profile_folder)
    Path(profile_folder).mkdir(parents=True, exist_ok=True)
    active_file = Path(profile_folder) / "DevToolsActivePort"
    try:
        active_file.unlink()  # left over from an earlier run; the browser writes a fresh one
    except OSError:
        pass
    args = [
        exe_path,
        f"--remote-debugging-port={int(port or 0)}",
        f"--user-data-dir={profile_folder}",
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-session-crashed-bubble",
        # Chrome slows down pages in windows that are covered (for example by this
        # program's own window) or in the background. Studio then reacts slowly and
        # every step takes longer, so keep the page running at full speed.
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
        "--new-window",
        *extra_args,
    ]
    if profile_directory:
        args.append(f"--profile-directory={profile_directory}")
    args.append(url)
    options: dict = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    if sys.platform == "win32":
        options["creationflags"] = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        if getattr(sys, "frozen", False):
            # The packaged program points Windows at its own unpacked files for DLLs,
            # and a started program inherits that. Reset it so the browser loads its own.
            try:
                import ctypes

                ctypes.windll.kernel32.SetDllDirectoryW(None)
            except Exception:  # noqa: BLE001
                pass
    else:
        options["start_new_session"] = True
    process = subprocess.Popen(args, **options)  # noqa: S603
    _LAUNCHED.append(process)  # the browser keeps running after this call returns
    deadline = time.time() + wait_seconds
    exited_at: float | None = None
    while time.time() < deadline:
        candidates = [_port_from_active_file(profile_folder) or 0]
        if port:
            candidates.append(int(port))
        endpoint = _first_alive(candidates)
        if endpoint:
            return endpoint
        if exited_at is None and process.poll() is not None:
            exited_at = time.time()
        if exited_at is not None and time.time() - exited_at > 4:
            # The browser handed the request to a copy that was already running with
            # this profile and then quit, so remote control was not switched on.
            raise BrowserBusyError(
                "The tool's browser is already open but the tool cannot reach inside it. "
                "Close that browser window and try again."
            )
        time.sleep(0.25)
    raise RuntimeError(
        "The browser started but did not switch on remote control in time. Close every window of the "
        "tool's browser and try again."
    )


def close_profile_browser(profile_folder: str | Path, wait_seconds: float = 12.0) -> bool:
    """Close the browser that is using the tool's own profile (never the person's normal browser)."""
    processes = profile_processes(profile_folder)
    if not processes:
        return True
    pids = {p.pid for p in processes}
    if sys.platform == "win32":
        try:
            import win32con
            import win32gui
            import win32process

            def visit(handle, _extra):
                _thread, pid = win32process.GetWindowThreadProcessId(handle)
                if pid in pids and win32gui.IsWindowVisible(handle):
                    win32gui.PostMessage(handle, win32con.WM_CLOSE, 0, 0)

            win32gui.EnumWindows(visit, None)
        except Exception:  # noqa: BLE001
            pass
    else:
        for proc in processes:
            try:
                proc.terminate()
            except Exception:  # noqa: BLE001
                pass
    try:
        import psutil
    except ImportError:
        return False
    deadline = time.time() + wait_seconds
    while time.time() < deadline:
        if not any(psutil.pid_exists(pid) for pid in pids):
            return True
        time.sleep(0.25)
    # Still running (for example with no window left): end it.
    for proc in processes:
        try:
            proc.terminate()
        except Exception:  # noqa: BLE001
            pass
    try:
        psutil.wait_procs(processes, timeout=5)
    except Exception:  # noqa: BLE001
        pass
    return not any(psutil.pid_exists(pid) for pid in pids)


def describe_command(args: list[str]) -> str:
    return " ".join(shlex.quote(a) for a in args)


def is_studio_url(url: str) -> bool:
    return bool(re.match(r"^https://studio\.youtube\.com/", url or ""))
