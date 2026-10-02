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


def _keep_crash_notes(logs_folder: Path) -> None:
    """Write details of hard crashes and unexpected errors to Logs/Crash notes.txt.

    The packaged program has no console, so without this a crash leaves no trace.
    It also gives the libraries somewhere to write, because printing to a missing
    console fails.
    """
    import faulthandler
    import threading
    import traceback

    try:
        notes = open(logs_folder / "Crash notes.txt", "a", encoding="utf-8", buffering=1)  # noqa: SIM115
    except OSError:
        return
    if sys.stdout is None:
        sys.stdout = notes
    if sys.stderr is None:
        sys.stderr = notes
    try:
        # On Windows this also writes a "Windows fatal exception" block for some errors
        # that Windows or the window library handle afterwards; only a block that is
        # followed by the program closing is a real crash. Only the thread that failed
        # is written, because walking the other threads while they run is not safe.
        faulthandler.enable(file=notes, all_threads=False)
    except (OSError, ValueError, RuntimeError):
        pass

    def note(kind: str, exc_type, exc, tb) -> None:
        try:
            notes.write(f"--- {kind} ---\n{''.join(traceback.format_exception(exc_type, exc, tb))}\n")
        except Exception:  # noqa: BLE001
            pass

    previous_hook = sys.excepthook

    def on_error(exc_type, exc, tb):
        note("unexpected error", exc_type, exc, tb)
        previous_hook(exc_type, exc, tb)

    sys.excepthook = on_error
    threading.excepthook = lambda args: note(f"error in {getattr(args.thread, 'name', 'a helper')}", args.exc_type, args.exc_value, args.exc_traceback)


def main() -> None:
    if "--check" in sys.argv[1:]:
        raise SystemExit(startup_check())
    folders = ensure_folders()
    _keep_crash_notes(folders["logs"])
    import webview  # imported here so the rest of the app can be tested without it

    api = Api()
    size = api._window_size()
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
    # Kept in a private attribute: the window library looks through every public
    # attribute of the api object, and walking into the window froze the program.
    api._set_window(window)
    window.events.closing += api._remember_window_size
    gui = "edgechromium" if sys.platform == "win32" else None
    webview.start(gui=gui, debug=False, private_mode=False)


if __name__ == "__main__":
    main()
