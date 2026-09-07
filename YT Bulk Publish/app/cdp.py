"""A small client for the Chrome DevTools Protocol.

The tool talks to a Chromium-based browser (Chrome, Edge, Brave, ...) that was
started with a remote-control port. Everything here is plain HTTP plus one
WebSocket per tab, so no browser driver has to be bundled with the program.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

import websocket  # websocket-client

DEFAULT_TIMEOUT = 30.0


class DevToolsError(RuntimeError):
    """Raised when the browser rejects a command or does not answer in time."""


class BrowserEndpoint:
    """The HTTP side of the DevTools protocol (list tabs, open tabs, ...)."""

    def __init__(self, host: str = "127.0.0.1", port: int = 9222):
        self.host = host
        self.port = int(port)

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def _request(self, path: str, method: str = "GET", timeout: float = 5.0) -> Any:
        request = urllib.request.Request(self.base_url + path, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
                raw = response.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, OSError) as exc:
            raise DevToolsError(f"Cannot reach the browser at {self.base_url}: {exc}") from exc
        if not raw.strip():
            return None
        try:
            return json.loads(raw)
        except ValueError:
            return raw  # some endpoints answer with a short sentence instead of JSON

    def is_alive(self, timeout: float = 2.0) -> bool:
        try:
            self._request("/json/version", timeout=timeout)
            return True
        except DevToolsError:
            return False

    def version(self) -> dict:
        return self._request("/json/version")

    def targets(self) -> list[dict]:
        data = self._request("/json/list")
        return [t for t in (data or []) if isinstance(t, dict)]

    def pages(self) -> list[dict]:
        return [t for t in self.targets() if t.get("type") == "page"]

    def find_page(self, url_contains: str) -> dict | None:
        for target in self.pages():
            if url_contains in (target.get("url") or ""):
                return target
        return None

    def new_page(self, url: str = "about:blank") -> dict:
        quoted = urllib.parse.quote(url, safe=":/?&=%#")
        try:
            return self._request(f"/json/new?{quoted}", method="PUT")
        except DevToolsError:
            # Older builds accept GET only.
            return self._request(f"/json/new?{quoted}", method="GET")

    def activate(self, target_id: str) -> None:
        self._request(f"/json/activate/{target_id}")

    def close_page(self, target_id: str) -> None:
        self._request(f"/json/close/{target_id}")

    def connect(self, target: dict | str) -> "Page":
        if isinstance(target, str):
            match = next((t for t in self.targets() if t.get("id") == target), None)
            if not match:
                raise DevToolsError("That browser tab is no longer open.")
            target = match
        ws_url = target.get("webSocketDebuggerUrl")
        if not ws_url:
            raise DevToolsError("The browser did not give a control address for this tab.")
        page = Page(ws_url, target_id=target.get("id", ""))
        page.connect()
        return page


class Page:
    """One browser tab controlled through its WebSocket."""

    def __init__(self, ws_url: str, target_id: str = ""):
        self.ws_url = ws_url
        self.target_id = target_id
        self._ws: websocket.WebSocket | None = None
        self._next_id = 0
        self._lock = threading.Lock()
        self._pending: dict[int, dict] = {}
        self._pending_cv = threading.Condition(self._lock)
        self._events: list[tuple[float, str, dict]] = []
        self._event_handlers: dict[str, list[Callable[[dict], None]]] = {}
        self._reader: threading.Thread | None = None
        self._closed = False

    # ---- connection -----------------------------------------------------
    def connect(self) -> None:
        try:
            self._ws = websocket.create_connection(self.ws_url, suppress_origin=True, timeout=DEFAULT_TIMEOUT)
        except Exception as exc:  # noqa: BLE001
            raise DevToolsError(f"Cannot open a control link to the tab: {exc}") from exc
        self._ws.settimeout(0.5)
        self._closed = False
        self._reader = threading.Thread(target=self._read_loop, name="devtools-reader", daemon=True)
        self._reader.start()
        self.send("Page.enable")
        self.send("Runtime.enable")

    def close(self) -> None:
        self._closed = True
        try:
            if self._ws:
                self._ws.close()
        except Exception:  # noqa: BLE001
            pass
        self._ws = None

    def _read_loop(self) -> None:
        while not self._closed and self._ws is not None:
            try:
                raw = self._ws.recv()
            except websocket.WebSocketTimeoutException:
                continue
            except Exception:  # noqa: BLE001
                break
            if not raw:
                continue
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if "id" in message:
                with self._pending_cv:
                    self._pending[message["id"]] = message
                    self._pending_cv.notify_all()
            elif "method" in message:
                params = message.get("params") or {}
                with self._lock:
                    self._events.append((time.time(), message["method"], params))
                    if len(self._events) > 2000:
                        del self._events[:1000]
                for handler in list(self._event_handlers.get(message["method"], [])):
                    try:
                        handler(params)
                    except Exception:  # noqa: BLE001
                        pass
        self._closed = True
        with self._pending_cv:
            self._pending_cv.notify_all()

    # ---- commands ---------------------------------------------------------
    def send(self, method: str, params: dict | None = None, timeout: float = DEFAULT_TIMEOUT) -> dict:
        if self._ws is None or self._closed:
            raise DevToolsError("The control link to the browser tab is closed.")
        with self._lock:
            self._next_id += 1
            message_id = self._next_id
        payload = json.dumps({"id": message_id, "method": method, "params": params or {}})
        try:
            self._ws.send(payload)
        except Exception as exc:  # noqa: BLE001
            raise DevToolsError(f"Lost the control link while sending {method}: {exc}") from exc
        deadline = time.time() + timeout
        with self._pending_cv:
            while message_id not in self._pending:
                remaining = deadline - time.time()
                if remaining <= 0:
                    raise DevToolsError(f"The browser did not answer {method} within {timeout:.0f} seconds.")
                if self._closed:
                    raise DevToolsError("The control link to the browser tab was closed.")
                self._pending_cv.wait(min(remaining, 0.5))
            response = self._pending.pop(message_id)
        if "error" in response:
            error = response["error"]
            raise DevToolsError(f"{method} failed: {error.get('message', error)}")
        return response.get("result") or {}

    def on(self, event: str, handler: Callable[[dict], None]) -> None:
        self._event_handlers.setdefault(event, []).append(handler)

    def events_since(self, timestamp: float, name: str | None = None) -> list[dict]:
        with self._lock:
            return [p for (ts, n, p) in self._events if ts >= timestamp and (name is None or n == name)]

    # ---- page level -------------------------------------------------------
    def navigate(self, url: str, timeout: float = 45.0) -> None:
        started = time.time()
        self.send("Page.navigate", {"url": url})
        deadline = started + timeout
        while time.time() < deadline:
            if self.events_since(started, "Page.loadEventFired"):
                return
            time.sleep(0.2)
        # Some single-page apps never fire the load event again; make sure the URL changed.
        if url.split("#")[0] not in self.url():
            raise DevToolsError(f"The page did not finish loading: {url}")

    def wait_ready(self, timeout: float = 30.0) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                if self.evaluate("document.readyState") in ("interactive", "complete"):
                    return
            except DevToolsError:
                pass
            time.sleep(0.2)

    def url(self) -> str:
        return str(self.evaluate("location.href"))

    def title(self) -> str:
        return str(self.evaluate("document.title"))

    def bring_to_front(self) -> None:
        try:
            self.send("Page.bringToFront")
        except DevToolsError:
            pass

    def evaluate(self, expression: str, await_promise: bool = True, timeout: float = DEFAULT_TIMEOUT) -> Any:
        result = self.send(
            "Runtime.evaluate",
            {
                "expression": expression,
                "awaitPromise": await_promise,
                "returnByValue": True,
                "userGesture": True,
            },
            timeout=timeout,
        )
        if "exceptionDetails" in result:
            details = result["exceptionDetails"]
            text = details.get("exception", {}).get("description") or details.get("text") or "script error"
            raise DevToolsError(text.splitlines()[0][:300])
        return result.get("result", {}).get("value")

    def call(self, function_source: str, *args: Any, timeout: float = DEFAULT_TIMEOUT) -> Any:
        """Run a JavaScript function expression with JSON-safe arguments."""
        encoded = ", ".join(json.dumps(a) for a in args)
        return self.evaluate(f"({function_source})({encoded})", timeout=timeout)

    def wait_for(self, expression: str, timeout: float = 20.0, interval: float = 0.25, message: str = "") -> Any:
        """Poll a JavaScript expression until it returns something truthy."""
        deadline = time.time() + timeout
        last_error: str | None = None
        while time.time() < deadline:
            try:
                value = self.evaluate(expression)
                if value:
                    return value
            except DevToolsError as exc:
                last_error = str(exc)
            time.sleep(interval)
        detail = f" ({last_error})" if last_error else ""
        raise DevToolsError((message or "Waited too long for the page") + detail)

    # ---- input --------------------------------------------------------------
    def mouse_click(self, x: float, y: float, count: int = 1) -> None:
        base = {"x": float(x), "y": float(y), "button": "left", "clickCount": count}
        self.send("Input.dispatchMouseEvent", {"type": "mouseMoved", **base, "button": "none"})
        self.send("Input.dispatchMouseEvent", {"type": "mousePressed", **base})
        self.send("Input.dispatchMouseEvent", {"type": "mouseReleased", **base})

    def mouse_move(self, x: float, y: float) -> None:
        self.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": float(x), "y": float(y), "button": "none"})

    def insert_text(self, text: str) -> None:
        self.send("Input.insertText", {"text": text})

    _KEY_CODES = {
        "Enter": ("Enter", "\r", 13),
        "Tab": ("Tab", "", 9),
        "Escape": ("Escape", "", 27),
        "Backspace": ("Backspace", "", 8),
        "Delete": ("Delete", "", 46),
        "ArrowDown": ("ArrowDown", "", 40),
        "ArrowUp": ("ArrowUp", "", 38),
        "End": ("End", "", 35),
        "Home": ("Home", "", 36),
        "a": ("KeyA", "a", 65),
    }

    def press(self, key: str, ctrl: bool = False, shift: bool = False) -> None:
        code, text, key_code = self._KEY_CODES.get(key, (key, key if len(key) == 1 else "", 0))
        modifiers = (2 if ctrl else 0) | (8 if shift else 0)
        down = {
            "type": "rawKeyDown" if not text or ctrl else "keyDown",
            "key": key,
            "code": code,
            "windowsVirtualKeyCode": key_code,
            "nativeVirtualKeyCode": key_code,
            "modifiers": modifiers,
        }
        if text and not ctrl:
            down["text"] = text
            down["unmodifiedText"] = text
        self.send("Input.dispatchKeyEvent", down)
        self.send(
            "Input.dispatchKeyEvent",
            {
                "type": "keyUp",
                "key": key,
                "code": code,
                "windowsVirtualKeyCode": key_code,
                "nativeVirtualKeyCode": key_code,
                "modifiers": modifiers,
            },
        )

    def select_all(self) -> None:
        self.press("a", ctrl=True)

    # ---- misc -----------------------------------------------------------------
    def screenshot(self, path: str) -> None:
        import base64

        data = self.send("Page.captureScreenshot", {"format": "png"}, timeout=60)
        with open(path, "wb") as handle:
            handle.write(base64.b64decode(data.get("data", "")))
