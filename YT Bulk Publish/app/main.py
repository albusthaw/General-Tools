"""Program entry point: opens the window and wires it to the Python side."""
from __future__ import annotations

import sys
from pathlib import Path

from .api import Api
from .settings import APP_NAME, ensure_folders, resource_path


def startup_check() -> int:
    """Prove the packaged program can start: load every part, create the folders, exit.

    Used by the build to test the finished EXE without opening a window. A short
    report is written next to the program (or next to run.py when run from source).
    """
    base = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1]
    report = base / "startup-check.txt"
    lines = [f"{APP_NAME} start-up check"]
    try:
        folders = ensure_folders()
        lines.append(f"folders ready: {folders['root']}")
        import webview

        lines.append(f"window library loaded: pywebview {getattr(webview, '__version__', '?')}")
        from . import api as _api, browser_control as _bc, cdp as _cdp, rename as _rename, studio as _studio, window_picker as _wp  # noqa: F401

        lines.append("all program parts loaded")
        page = resource_path("ui", "index.html")
        lines.append(f"interface file present: {page.exists()} ({page})")
        if not page.exists():
            raise FileNotFoundError("the interface file is missing from the build")
        lines.append("result: OK")
        code = 0
    except Exception as exc:  # noqa: BLE001
        lines.append(f"result: FAILED ({type(exc).__name__}: {exc})")
        code = 1
    try:
        report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    except OSError:
        pass
    return code


def main() -> None:
    if "--check" in sys.argv[1:]:
        raise SystemExit(startup_check())
    ensure_folders()
    import webview  # imported here so the rest of the app can be tested without it

    api = Api()
    size = api.settings.get("window", {}) or {}
    window = webview.create_window(
        APP_NAME,
        str(resource_path("ui", "index.html")),
        js_api=api,
        width=int(size.get("width", 1180)),
        height=int(size.get("height", 780)),
        min_size=(960, 640),
        frameless=True,
        easy_drag=False,
        background_color="#f3f5fb",
        text_select=False,
    )
    api.window = window

    def remember_size():
        try:
            api.settings.set("window", {"width": window.width, "height": window.height})
        except Exception:  # noqa: BLE001
            pass

    window.events.closing += remember_size
    gui = "edgechromium" if sys.platform == "win32" else None
    webview.start(gui=gui, debug=False, private_mode=False)


if __name__ == "__main__":
    main()
