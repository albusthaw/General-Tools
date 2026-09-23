"""Windows-only checks for listing windows and taking their pictures.

A small test window is opened with tkinter, found in the window list, pictured
and brought to the front. Skipped on other systems or when no window can be shown.
"""
from __future__ import annotations

import os
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import window_picker  # noqa: E402

TITLE = "YTBP picture test window"


@unittest.skipUnless(sys.platform == "win32", "window pictures are only available on Windows")
class WindowPictureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import tkinter
        except ImportError as exc:
            raise unittest.SkipTest(f"tkinter is not available: {exc}")
        try:
            cls.root = tkinter.Tk()
        except Exception as exc:  # noqa: BLE001
            raise unittest.SkipTest(f"no desktop to show a window on: {exc}")
        cls.root.title(TITLE)
        cls.root.geometry("420x300+80+80")
        tkinter.Label(cls.root, text="Picture test", bg="#6a5cff", fg="white", font=("Segoe UI", 28)).pack(fill="both", expand=True)
        for _ in range(20):
            cls.root.update()
            time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        cls.root.destroy()

    def find_test_window(self):
        windows = window_picker.list_windows(skip_own_windows=False)
        return next((w for w in windows if w.title == TITLE), None)

    def test_window_is_listed_and_pictured(self):
        window = self.find_test_window()
        self.assertIsNotNone(window, "the test window should be in the list")
        self.assertEqual(window.pid, os.getpid())
        self.assertFalse(window.minimized)
        self.assertFalse(window_picker._is_hung(window.handle))
        picture = window_picker.capture_window(window.handle)
        self.assertTrue(picture.startswith("data:image/jpeg;base64,"), picture[:40])
        self.assertGreater(len(picture), 500)
        pictures = window_picker.capture_many([window.handle, 0])
        self.assertTrue(pictures[window.handle])
        self.assertEqual(pictures[0], "")

    def test_own_windows_are_left_out_by_default(self):
        titles = [w.title for w in window_picker.list_windows()]
        self.assertNotIn(TITLE, titles)

    def test_window_can_be_found_and_brought_forward(self):
        window = self.find_test_window()
        self.assertIn(window.handle, window_picker.windows_of_processes({os.getpid()}))
        self.assertTrue(window_picker.focus_window(window.handle))

    def test_minimised_window_is_listed_without_picture(self):
        self.root.iconify()
        try:
            for _ in range(20):
                self.root.update()
                time.sleep(0.05)
            window = self.find_test_window()
            self.assertIsNotNone(window)
            self.assertTrue(window.minimized)
            self.assertEqual(window_picker.capture_window(window.handle), "")
        finally:
            self.root.deiconify()
            for _ in range(10):
                self.root.update()
                time.sleep(0.05)


if __name__ == "__main__":
    unittest.main(verbosity=2)
