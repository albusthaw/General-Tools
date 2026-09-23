"""Tests for finding and starting the browser.

The first group needs no browser. The second starts a Chromium-based browser
the way the tool does (its own profile, the port chosen by the browser) and
is skipped when no browser is found.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import browser_control  # noqa: E402
from app.cdp import BrowserEndpoint  # noqa: E402
from tests.test_engine_mock import find_chromium  # noqa: E402


def serve(body: bytes, content_type: str) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):  # noqa: N802
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


class WithoutBrowserTest(unittest.TestCase):
    def test_any_web_server_is_not_taken_for_a_browser(self):
        server = serve(b"<html>hello</html>", "text/html")
        try:
            self.assertFalse(BrowserEndpoint(port=server.server_address[1]).is_alive(timeout=2))
        finally:
            server.shutdown()
            server.server_close()

    def test_browser_port_is_reached_even_with_a_proxy_set(self):
        server = serve(json.dumps({"Browser": "Chrome/140", "webSocketDebuggerUrl": "ws://x"}).encode(), "application/json")
        dead_proxy = {"HTTP_PROXY": "http://127.0.0.1:9", "http_proxy": "http://127.0.0.1:9", "NO_PROXY": "", "no_proxy": ""}
        try:
            # urllib caches its default opener (and the proxy settings) on first use, so the
            # cache is cleared here; otherwise going back to plain urlopen would go unnoticed.
            with mock.patch.dict(os.environ, dead_proxy), mock.patch.object(urllib.request, "_opener", None):
                self.assertTrue(BrowserEndpoint(port=server.server_address[1]).is_alive(timeout=2))
        finally:
            server.shutdown()
            server.server_close()

    def test_normal_browser_is_answered_quickly(self):
        # A process that listens on no port at all: no guessing of common ports, so no waiting.
        process = browser_control.BrowserProcess(pid=os.getpid(), exe_name="chrome.exe", exe_path="", user_data_dir=tempfile.gettempdir())
        started = time.time()
        with mock.patch.object(browser_control, "listening_ports", return_value=[]):
            self.assertIsNone(browser_control.find_endpoint(process))
        self.assertLess(time.time() - started, 1.0)

    def test_pop_ups_are_answered_only_during_the_tools_own_steps(self):
        from app.cdp import Page

        page = Page("ws://127.0.0.1:1/devtools/page/x")
        sent = []
        page.send_nowait = lambda method, params=None: sent.append((method, params))
        page._answer_dialog({"type": "beforeunload"})
        self.assertEqual(sent, [], "a person using the tab keeps the browser's own question")
        with page.answering_dialogs():
            page._answer_dialog({"type": "beforeunload"})
            page._answer_dialog({"type": "confirm"})
            page._answer_dialog({"type": "alert"})
        self.assertEqual(sent, [
            ("Page.handleJavaScriptDialog", {"accept": True}),
            ("Page.handleJavaScriptDialog", {"accept": False}),
            ("Page.handleJavaScriptDialog", {"accept": True}),
        ])
        self.assertEqual(page.leave_prompts_answered, 1)
        page._answer_dialog({"type": "beforeunload"})
        self.assertEqual(len(sent), 3)

    def test_port_file_is_read(self):
        folder = tempfile.mkdtemp(prefix="ytbp-port-")
        try:
            Path(folder, "DevToolsActivePort").write_text("51234\n/devtools/browser/abc\n", encoding="utf-8")
            self.assertEqual(browser_control._port_from_active_file(folder), 51234)
            Path(folder, "DevToolsActivePort").write_text("0\n", encoding="utf-8")
            self.assertIsNone(browser_control._port_from_active_file(folder))
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    def test_left_over_port_file_is_ignored_without_a_running_browser(self):
        folder = tempfile.mkdtemp(prefix="ytbp-stale-")
        server = serve(json.dumps({"Browser": "Chrome/140", "webSocketDebuggerUrl": "ws://x"}).encode(), "application/json")
        try:
            Path(folder, "DevToolsActivePort").write_text(f"{server.server_address[1]}\n", encoding="utf-8")
            self.assertIsNone(browser_control.find_profile_endpoint(folder))
        finally:
            server.shutdown()
            server.server_close()
            shutil.rmtree(folder, ignore_errors=True)


class LaunchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.exe = find_chromium()
        if not cls.exe:
            raise unittest.SkipTest("no Chromium-based browser available")
        cls.profile = tempfile.mkdtemp(prefix="ytbp-launch-profile-")
        cls.extra = ["--headless=new", "--disable-gpu"] + (["--no-sandbox"] if sys.platform.startswith("linux") else [])

    @classmethod
    def tearDownClass(cls):
        browser_control.close_profile_browser(cls.profile, wait_seconds=5)
        shutil.rmtree(cls.profile, ignore_errors=True)

    def test_launch_find_and_close(self):
        started = time.time()
        endpoint = browser_control.launch_controlled_browser(self.exe, self.profile, "about:blank", extra_args=self.extra)
        self.assertLess(time.time() - started, 30)
        self.assertTrue(endpoint.is_alive())
        self.assertNotEqual(endpoint.port, 0)
        self.assertEqual(browser_control._port_from_active_file(self.profile), endpoint.port)

        # The running browser is found again from its profile, and from its process.
        again = browser_control.find_profile_endpoint(self.profile)
        self.assertIsNotNone(again)
        self.assertEqual(again.port, endpoint.port)
        processes = browser_control.profile_processes(self.profile)
        self.assertTrue(processes)
        described = browser_control.BrowserProcess(pid=processes[0].pid, exe_name="chrome.exe", exe_path=self.exe, user_data_dir="")
        found = browser_control.find_endpoint(described)
        self.assertIsNotNone(found, "the port should be found from the ports the browser listens on")
        self.assertEqual(found.port, endpoint.port)

        self.assertTrue(browser_control.close_profile_browser(self.profile, wait_seconds=10))
        self.assertEqual(browser_control.profile_processes(self.profile), [])
        self.assertIsNone(browser_control.find_profile_endpoint(self.profile))


if __name__ == "__main__":
    unittest.main(verbosity=2)
