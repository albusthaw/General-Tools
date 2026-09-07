"""Program entry point: opens the window and wires it to the Python side."""
from __future__ import annotations

import sys

from .api import Api
from .settings import APP_NAME, ensure_folders, resource_path


def main() -> None:
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
