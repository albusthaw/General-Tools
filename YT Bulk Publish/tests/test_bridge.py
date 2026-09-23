"""Checks for the object the interface talks to (no browser needed).

The window library (pywebview) looks through every public attribute of this
object each time the page loads and follows every attribute that is itself an
object. A public reference to the window, a browser tab or the settings made
it wander through the whole window system, which froze or crashed the program.
These tests keep that from coming back.
"""
from __future__ import annotations

import inspect
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def exposed_names(obj, base: str = "", seen: set | None = None) -> list[str]:
    """The same walk pywebview 6 does in util.get_functions (simplified)."""
    seen = set() if seen is None else seen
    if id(obj) in seen:
        return []
    seen.add(id(obj))
    names: list[str] = []
    for name in dir(obj):
        if name.startswith("_"):
            continue
        attr = getattr(obj, name)
        full = f"{base}.{name}" if base else name
        if inspect.ismethod(attr) or inspect.isfunction(attr):
            names.append(full)
        elif inspect.isclass(attr) or (not callable(attr) and hasattr(attr, "__module__")):
            names.extend(exposed_names(attr, full, seen))
    return names


class BridgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.home = tempfile.mkdtemp(prefix="ytbp-home-")
        os.environ["YT_BULK_PUBLISH_HOME"] = cls.home
        from app.api import Api

        cls.api = Api()

    @classmethod
    def tearDownClass(cls):
        os.environ.pop("YT_BULK_PUBLISH_HOME", None)
        shutil.rmtree(cls.home, ignore_errors=True)

    def test_only_plain_functions_are_exposed(self):
        # Pretend the program is fully connected, as it is after step 1.
        self.api._set_window(object())
        names = exposed_names(self.api)
        self.assertTrue(names)
        nested = [n for n in names if "." in n]
        self.assertEqual(nested, [], "the interface must not see inside helper objects")
        for name in dir(self.api):
            if not name.startswith("_"):
                self.assertTrue(inspect.ismethod(getattr(self.api, name)), f"public attribute {name} is not a function")

    def test_interface_functions_exist(self):
        names = set(exposed_names(self.api))
        for needed in ("app_info", "list_windows", "window_pictures", "choose_window", "open_tool_browser",
                       "connect_status", "load_videos", "start_changes", "progress", "stop_changes", "close"):
            self.assertIn(needed, names)

    def test_wrapped_functions_keep_their_names(self):
        self.assertEqual(self.api.choose_window.__name__, "choose_window")
        self.assertIn("handle", inspect.signature(self.api.choose_window).parameters)

    def test_errors_come_back_as_messages(self):
        result = self.api.load_videos({"kind": "channel"})
        self.assertIn("error", result)
        self.assertIn("Connect to a browser window first", result["error"])

    def test_window_list_off_windows(self):
        result = self.api.list_windows()
        self.assertIn("windows", result)
        pictures = self.api.window_pictures([1, 2, "x"])
        self.assertIn("pictures", pictures)
        if sys.platform != "win32":
            self.assertEqual(result["windows"], [])
            self.assertEqual(pictures["pictures"], {})

    def test_connecting_is_refused_while_changes_run(self):
        # Connecting again would close the tab the run works in and stop the run.
        self.api._runner.running = True
        try:
            self.assertEqual(self.api.choose_window(123)["status"], "busy")
            self.assertEqual(self.api.open_tool_browser()["status"], "busy")
            self.assertIn("still running", self.api.load_videos({"kind": "channel"})["error"])
        finally:
            self.api._runner.running = False

    def test_unexpected_problems_show_plain_words(self):
        from unittest import mock

        with mock.patch("app.api.window_picker.list_windows", side_effect=AttributeError("'NoneType' object has no attribute 'pid'")):
            result = self.api.list_windows()
        self.assertIn("Something went wrong", result["error"])
        self.assertNotIn("NoneType", result["error"])
        self.assertNotIn("NoneType", " ".join(line["message"] for line in self.api._log.recent()))
        self.assertIn("NoneType", self.api._log.path.read_text(encoding="utf-8"))

    def test_second_connect_press_is_turned_away(self):
        self.assertTrue(self.api._connect_lock.acquire(blocking=False))
        try:
            self.assertEqual(self.api.open_tool_browser()["status"], "busy")
            self.assertEqual(self.api.choose_window(123)["status"], "busy")
        finally:
            self.api._connect_lock.release()


if __name__ == "__main__":
    unittest.main(verbosity=2)
