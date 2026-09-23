"""List the windows that are open on screen and take small pictures of them.

The pictures are shown as cards so the user can click the browser window
that has YouTube Studio open. Everything here is Windows-only; on other
systems the functions return empty results so the rest of the program can
still be imported and tested.

Listing is kept quick on purpose: windows are listed first without pictures,
and pictures are taken afterwards, one window at a time, with a time limit.
Minimised windows and windows that have stopped responding are not pictured,
because asking a frozen window to draw itself can block for a long time.
"""
from __future__ import annotations

import base64
import ctypes
import io
import os
import sys
import threading
import time
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
# Upper limit for taking all pictures in one go; windows left over show "No preview".
PICTURE_BUDGET_SECONDS = 8.0

# The drawing calls used for pictures are not safe to run from two threads at the
# same time, and the interface can ask twice (for example Refresh pressed twice).
_capture_lock = threading.Lock()


@dataclass
class WindowInfo:
    handle: int
    title: str
    pid: int
    process: str
    browser_name: str
    is_browser: bool
    rect: tuple[int, int, int, int]
    thumbnail: str = ""  # data URL (JPEG) or empty
    looks_like_youtube: bool = False
    minimized: bool = False
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
            "minimized": self.minimized,
            "width": self.rect[2] - self.rect[0],
            "height": self.rect[3] - self.rect[1],
            "thumbnail": self.thumbnail,
        }


def _is_windows() -> bool:
    return sys.platform == "win32"


def _process_name(pid: int, cache: dict[int, str] | None = None) -> str:
    if cache is not None and pid in cache:
        return cache[pid]
    try:
        import psutil

        name = psutil.Process(pid).name().lower()
    except Exception:  # noqa: BLE001
        name = ""
    if cache is not None:
        cache[pid] = name
    return name


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


_gdi = None


def _gdi_functions():
    """Windows drawing functions with their exact argument types.

    Own copies of the libraries are loaded so the types set here cannot clash with
    other code, and so 64-bit handles are never cut short.
    """
    global _gdi
    if _gdi is not None:
        return _gdi
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32")
    gdi32 = ctypes.WinDLL("gdi32")

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [
            ("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG), ("biHeight", wintypes.LONG),
            ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
            ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG), ("biYPelsPerMeter", wintypes.LONG),
            ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD),
        ]

    class BITMAPINFO(ctypes.Structure):
        _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wintypes.DWORD * 3)]

    user32.GetWindowDC.argtypes = [wintypes.HWND]
    user32.GetWindowDC.restype = wintypes.HDC
    user32.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
    user32.ReleaseDC.restype = ctypes.c_int
    user32.PrintWindow.argtypes = [wintypes.HWND, wintypes.HDC, wintypes.UINT]
    user32.PrintWindow.restype = wintypes.BOOL
    user32.SendMessageTimeoutW.argtypes = [
        wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM, wintypes.UINT, wintypes.UINT,
        ctypes.POINTER(ctypes.c_size_t),
    ]
    user32.SendMessageTimeoutW.restype = ctypes.c_ssize_t
    gdi32.CreateCompatibleDC.argtypes = [wintypes.HDC]
    gdi32.CreateCompatibleDC.restype = wintypes.HDC
    gdi32.CreateCompatibleBitmap.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int]
    gdi32.CreateCompatibleBitmap.restype = wintypes.HBITMAP
    gdi32.SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]
    gdi32.SelectObject.restype = wintypes.HGDIOBJ
    gdi32.DeleteObject.argtypes = [wintypes.HGDIOBJ]
    gdi32.DeleteObject.restype = wintypes.BOOL
    gdi32.DeleteDC.argtypes = [wintypes.HDC]
    gdi32.DeleteDC.restype = wintypes.BOOL
    gdi32.GetDIBits.argtypes = [
        wintypes.HDC, wintypes.HBITMAP, wintypes.UINT, wintypes.UINT, ctypes.c_void_p,
        ctypes.POINTER(BITMAPINFO), wintypes.UINT,
    ]
    gdi32.GetDIBits.restype = ctypes.c_int
    _gdi = (user32, gdi32, BITMAPINFO, BITMAPINFOHEADER)
    return _gdi


def _is_hung(handle: int) -> bool:
    """True when the window does not answer within a quarter of a second."""
    try:
        user32 = _gdi_functions()[0]
        answer = ctypes.c_size_t(0)
        # WM_NULL (0) with SMTO_ABORTIFHUNG (2) | SMTO_BLOCK (1): a quick "are you there?".
        return not user32.SendMessageTimeoutW(handle, 0, 0, 0, 0x0003, 250, ctypes.byref(answer))
    except Exception:  # noqa: BLE001
        return False


def _encode(image, width: int) -> str:
    image = image.convert("RGB")
    ratio = width / max(1, image.width)
    image = image.resize((width, max(1, int(image.height * ratio))))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=72)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _print_window(handle: int):
    """Ask the window to draw itself into a picture (works for covered browser windows too)."""
    import win32gui
    from PIL import Image

    user32, gdi32, BITMAPINFO, BITMAPINFOHEADER = _gdi_functions()
    left, top, right, bottom = win32gui.GetWindowRect(handle)
    w, h = max(1, right - left), max(1, bottom - top)
    window_dc = user32.GetWindowDC(handle)
    if not window_dc:
        return None
    memory_dc = bitmap = old = None
    try:
        memory_dc = gdi32.CreateCompatibleDC(window_dc)
        bitmap = gdi32.CreateCompatibleBitmap(window_dc, w, h)
        if not memory_dc or not bitmap:
            return None
        old = gdi32.SelectObject(memory_dc, bitmap)
        # PW_RENDERFULLCONTENT (2) also captures hardware-accelerated browser content.
        ok = user32.PrintWindow(handle, memory_dc, 2)
        # The bitmap has to be taken out of the drawing context before reading it.
        gdi32.SelectObject(memory_dc, old)
        old = None
        if not ok:
            return None
        info = BITMAPINFO()
        info.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        info.bmiHeader.biWidth = w
        info.bmiHeader.biHeight = -h  # negative: rows from the top down
        info.bmiHeader.biPlanes = 1
        info.bmiHeader.biBitCount = 32
        info.bmiHeader.biCompression = 0  # BI_RGB
        pixels = ctypes.create_string_buffer(w * h * 4)
        if gdi32.GetDIBits(memory_dc, bitmap, 0, h, pixels, ctypes.byref(info), 0) != h:
            return None
        image = Image.frombuffer("RGB", (w, h), pixels.raw, "raw", "BGRX", 0, 1)
    finally:
        # Clean up in the order Windows expects, whatever happened above.
        if old is not None:
            gdi32.SelectObject(memory_dc, old)
        if bitmap:
            gdi32.DeleteObject(bitmap)
        if memory_dc:
            gdi32.DeleteDC(memory_dc)
        user32.ReleaseDC(handle, window_dc)
    if image.getbbox() is None:
        return None  # all black: the window did not draw itself
    return image


def capture_window(handle: int, width: int = THUMBNAIL_WIDTH) -> str:
    """Return a small JPEG data URL of the window content, or an empty string."""
    if not _is_windows():
        return ""
    try:
        import win32gui
        from PIL import Image  # noqa: F401
    except ImportError:
        return ""
    try:
        if not win32gui.IsWindow(handle) or win32gui.IsIconic(handle) or _is_hung(handle):
            return ""
    except Exception:  # noqa: BLE001
        return ""

    with _capture_lock:
        image = None
        try:
            image = _print_window(handle)
        except Exception:  # noqa: BLE001
            image = None
        if image is None:
            try:
                from PIL import ImageGrab

                left, top, right, bottom = win32gui.GetWindowRect(handle)
                if right - left > 0 and bottom - top > 0 and left > -30000:
                    image = ImageGrab.grab(bbox=(left, top, right, bottom), all_screens=True)
            except Exception:  # noqa: BLE001
                image = None
        if image is None:
            return ""
        try:
            return _encode(image, width)
        except Exception:  # noqa: BLE001
            return ""


def capture_many(handles: list[int], budget: float = PICTURE_BUDGET_SECONDS) -> dict[int, str]:
    """Take pictures of several windows, stopping when the time budget is used up."""
    pictures: dict[int, str] = {}
    deadline = time.time() + budget
    for handle in handles:
        if time.time() > deadline:
            break
        pictures[int(handle)] = capture_window(int(handle))
    return pictures


def list_windows(
    only_browsers: bool = False,
    with_thumbnails: bool = False,
    skip_title: str = "",
    include_youtube_titles: bool = True,
    skip_own_windows: bool = True,
) -> list[WindowInfo]:
    """Return the visible top-level windows, YouTube and browsers first.

    With only_browsers, windows of other programs are left out, except (when
    include_youtube_titles is on) windows whose title mentions YouTube or Studio.
    """
    if not _is_windows():
        return []
    import win32con
    import win32gui
    import win32process

    own_pid = os.getpid()
    names: dict[int, str] = {}
    found: list[WindowInfo] = []

    def visit(handle, _extra):
        try:
            if not win32gui.IsWindowVisible(handle):
                return
            title = win32gui.GetWindowText(handle).strip()
            if not title or (skip_title and title == skip_title):
                return
            style = win32gui.GetWindowLong(handle, win32con.GWL_EXSTYLE)
            if style & win32con.WS_EX_TOOLWINDOW:
                return
            if _is_cloaked(handle):
                return
            _thread_id, pid = win32process.GetWindowThreadProcessId(handle)
            if skip_own_windows and pid == own_pid:
                return
            minimized = bool(win32gui.IsIconic(handle))
            rect = win32gui.GetWindowRect(handle)
            if not minimized and (rect[2] - rect[0] < 120 or rect[3] - rect[1] < 80):
                return
            process = _process_name(pid, names)
            browser_name = BROWSER_PROCESSES.get(process, "")
            is_browser = bool(browser_name)
            lowered = title.lower()
            looks_like_youtube = "youtube" in lowered or "studio" in lowered
            if only_browsers and not is_browser and not (include_youtube_titles and looks_like_youtube):
                return
            found.append(
                WindowInfo(
                    handle=int(handle),
                    title=title,
                    pid=int(pid),
                    process=process,
                    browser_name=browser_name,
                    is_browser=is_browser,
                    rect=tuple(rect),
                    looks_like_youtube=looks_like_youtube,
                    minimized=minimized,
                )
            )
        except Exception:  # noqa: BLE001
            return  # a window that closed while we looked at it

    win32gui.EnumWindows(visit, None)
    found.sort(key=lambda w: (not w.looks_like_youtube, not w.is_browser, w.title.lower()))

    if with_thumbnails:
        pictures = capture_many([w.handle for w in found])
        for window in found:
            window.thumbnail = pictures.get(window.handle, "")
    return found


def windows_of_processes(pids: set[int] | list[int]) -> list[int]:
    """Handles of the visible top-level windows that belong to the given processes."""
    if not _is_windows():
        return []
    try:
        import win32gui
        import win32process
    except ImportError:
        return []
    wanted = {int(p) for p in pids}
    handles: list[int] = []

    def visit(handle, _extra):
        try:
            _thread, pid = win32process.GetWindowThreadProcessId(handle)
            if pid in wanted and win32gui.IsWindowVisible(handle) and win32gui.GetWindowText(handle).strip():
                handles.append(int(handle))
        except Exception:  # noqa: BLE001
            return

    try:
        win32gui.EnumWindows(visit, None)
    except Exception:  # noqa: BLE001
        pass
    return handles


def focus_window(handle: int) -> bool:
    if not _is_windows():
        return False
    try:
        import win32con
        import win32gui

        if win32gui.IsIconic(handle):
            win32gui.ShowWindow(handle, win32con.SW_RESTORE)
        try:
            win32gui.SetForegroundWindow(handle)
        except Exception:  # noqa: BLE001
            # Windows sometimes refuses to hand over the focus; at least raise the window.
            win32gui.BringWindowToTop(handle)
        return True
    except Exception:  # noqa: BLE001
        return False
