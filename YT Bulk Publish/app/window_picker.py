"""List the windows that are open on screen and take small pictures of them.

The pictures are shown as cards so the user can click the browser window
that has YouTube Studio open. Everything here is Windows-only; on other
systems the functions return empty results so the rest of the program can
still be imported and tested.
"""
from __future__ import annotations

import base64
import ctypes
import io
import sys
from dataclasses import dataclass, field

BROWSER_PROCESSES = {
    "chrome.exe": "Google Chrome",
    "msedge.exe": "Microsoft Edge",
    "brave.exe": "Brave",
    "vivaldi.exe": "Vivaldi",
    "opera.exe": "Opera",
    "chromium.exe": "Chromium",
    "firefox.exe": "Firefox",
}

THUMBNAIL_WIDTH = 360


@dataclass
class WindowInfo:
    handle: int
    title: str
    pid: int
    process: str
    browser_name: str
    is_browser: bool
    rect: tuple[int, int, int, int]
    thumbnail: str = ""  # data URL (PNG) or empty
    looks_like_youtube: bool = False
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "handle": self.handle,
            "title": self.title,
            "pid": self.pid,
            "process": self.process,
            "browser": self.browser_name,
            "is_browser": self.is_browser,
            "youtube": self.looks_like_youtube,
            "width": self.rect[2] - self.rect[0],
            "height": self.rect[3] - self.rect[1],
            "thumbnail": self.thumbnail,
        }


def _is_windows() -> bool:
    return sys.platform == "win32"


def _process_name(pid: int) -> str:
    try:
        import psutil

        return psutil.Process(pid).name().lower()
    except Exception:  # noqa: BLE001
        return ""


def _is_cloaked(handle: int) -> bool:
    """Skip invisible store-app windows that Windows keeps around."""
    try:
        cloaked = ctypes.c_int(0)
        # DWMWA_CLOAKED = 14
        ctypes.windll.dwmapi.DwmGetWindowAttribute(
            ctypes.c_void_p(handle), 14, ctypes.byref(cloaked), ctypes.sizeof(cloaked)
        )
        return bool(cloaked.value)
    except Exception:  # noqa: BLE001
        return False


def capture_window(handle: int, width: int = THUMBNAIL_WIDTH) -> str:
    """Return a PNG data URL of the window content, or an empty string."""
    if not _is_windows():
        return ""
    try:
        import win32con
        import win32gui
        import win32ui
        from PIL import Image
    except ImportError:
        return ""

    try:
        left, top, right, bottom = win32gui.GetWindowRect(handle)
        w, h = max(1, right - left), max(1, bottom - top)
        window_dc = win32gui.GetWindowDC(handle)
        mfc_dc = win32ui.CreateDCFromHandle(window_dc)
        save_dc = mfc_dc.CreateCompatibleDC()
        bitmap = win32ui.CreateBitmap()
        bitmap.CreateCompatibleBitmap(mfc_dc, w, h)
        save_dc.SelectObject(bitmap)
        # PW_RENDERFULLCONTENT (2) also captures hardware-accelerated browser content.
        ok = ctypes.windll.user32.PrintWindow(handle, save_dc.GetSafeHdc(), 2)
        info = bitmap.GetInfo()
        raw = bitmap.GetBitmapBits(True)
        image = Image.frombuffer("RGB", (info["bmWidth"], info["bmHeight"]), raw, "raw", "BGRX", 0, 1)
        win32gui.DeleteObject(bitmap.GetHandle())
        save_dc.DeleteDC()
        mfc_dc.DeleteDC()
        win32gui.ReleaseDC(handle, window_dc)
        if not ok or image.getbbox() is None:
            raise RuntimeError("blank capture")
    except Exception:  # noqa: BLE001
        try:
            from PIL import ImageGrab

            left, top, right, bottom = win32gui.GetWindowRect(handle)
            image = ImageGrab.grab(bbox=(left, top, right, bottom), all_screens=True)
        except Exception:  # noqa: BLE001
            return ""

    try:
        ratio = width / max(1, image.width)
        image = image.resize((width, max(1, int(image.height * ratio))))
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
    except Exception:  # noqa: BLE001
        return ""


def list_windows(only_browsers: bool = False, with_thumbnails: bool = True, skip_title: str = "") -> list[WindowInfo]:
    """Return the visible top-level windows, browsers first."""
    if not _is_windows():
        return []
    import win32con
    import win32gui
    import win32process

    found: list[WindowInfo] = []

    def visit(handle, _extra):
        if not win32gui.IsWindowVisible(handle):
            return
        title = win32gui.GetWindowText(handle).strip()
        if not title or title == skip_title:
            return
        style = win32gui.GetWindowLong(handle, win32con.GWL_EXSTYLE)
        if style & win32con.WS_EX_TOOLWINDOW:
            return
        if _is_cloaked(handle):
            return
        rect = win32gui.GetWindowRect(handle)
        if rect[2] - rect[0] < 120 or rect[3] - rect[1] < 80:
            return
        _thread_id, pid = win32process.GetWindowThreadProcessId(handle)
        process = _process_name(pid)
        browser_name = BROWSER_PROCESSES.get(process, "")
        is_browser = bool(browser_name)
        if only_browsers and not is_browser:
            return
        lowered = title.lower()
        found.append(
            WindowInfo(
                handle=int(handle),
                title=title,
                pid=int(pid),
                process=process,
                browser_name=browser_name,
                is_browser=is_browser,
                rect=tuple(rect),
                looks_like_youtube="youtube" in lowered or "studio" in lowered,
            )
        )

    win32gui.EnumWindows(visit, None)

    if with_thumbnails:
        for window in found:
            window.thumbnail = capture_window(window.handle)

    found.sort(key=lambda w: (not w.looks_like_youtube, not w.is_browser, w.title.lower()))
    return found


def focus_window(handle: int) -> bool:
    if not _is_windows():
        return False
    try:
        import win32con
        import win32gui

        if win32gui.IsIconic(handle):
            win32gui.ShowWindow(handle, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(handle)
        return True
    except Exception:  # noqa: BLE001
        return False
