"""End-to-end test of the browser engine against the mock YouTube Studio.

A Chromium-based browser is started with a remote-control port, the mock
server is started, and the real Studio automation code is run against it.
The test is skipped when no browser can be found.
"""
from __future__ import annotations

import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import browser_control  # noqa: E402
from app.cdp import BrowserEndpoint  # noqa: E402
from app.engine import BatchRunner, build_changes  # noqa: E402
from app.settings import ActivityLog  # noqa: E402
from app.studio import Changes, Studio, Video, connect_studio  # noqa: E402
from tests import mock_studio  # noqa: E402


def find_chromium() -> str:
    explicit = os.environ.get("YT_BULK_TEST_BROWSER")
    if explicit and os.path.isfile(explicit):
        return explicit
    found = browser_control.find_browser_executable()
    if found:
        return found
    for pattern in ("/opt/pw-browsers/chromium-*/chrome-linux/chrome", os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux/chrome")):
        matches = sorted(glob.glob(pattern))
        if matches:
            return matches[-1]
    for name in ("chromium", "chromium-browser", "google-chrome", "chrome"):
        path = shutil.which(name)
        if path:
            return path
    return ""


class MockStudioTest(unittest.TestCase):
    browser: subprocess.Popen | None = None
    port = 9555

    @classmethod
    def setUpClass(cls):
        exe = find_chromium()
        if not exe:
            raise unittest.SkipTest("no Chromium-based browser available")
        cls.server, cls.base_url = mock_studio.start_server()
        cls.profile = tempfile.mkdtemp(prefix="ytbp-test-profile-")
        cls.browser = subprocess.Popen(
            [
                exe,
                f"--remote-debugging-port={cls.port}",
                f"--user-data-dir={cls.profile}",
                "--headless=new",
                "--no-sandbox",
                "--no-first-run",
                "--disable-gpu",
                "--window-size=1300,900",
                cls.base_url,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        cls.endpoint = BrowserEndpoint(port=cls.port)
        deadline = time.time() + 30
        while time.time() < deadline and not cls.endpoint.is_alive():
            time.sleep(0.3)
        if not cls.endpoint.is_alive():
            raise unittest.SkipTest("browser did not start with remote control")
        cls.log_lines: list[str] = []
        cls.page, _ = connect_studio(cls.endpoint, base_url=cls.base_url)
        cls.studio = Studio(cls.page, log=lambda m, level="info": cls.log_lines.append(f"{level}: {m}"), slow=0.1, base_url=cls.base_url)

    @classmethod
    def tearDownClass(cls):
        try:
            cls.page.close()
        except Exception:  # noqa: BLE001
            pass
        if cls.browser:
            cls.browser.terminate()
            try:
                cls.browser.wait(timeout=10)
            except subprocess.TimeoutExpired:
                cls.browser.kill()
        cls.server.shutdown()
        shutil.rmtree(cls.profile, ignore_errors=True)

    def setUp(self):
        urllib.request.urlopen(self.base_url + "api/reset").read()

    def state(self) -> dict:
        return json.loads(urllib.request.urlopen(self.base_url + "api/state").read())

    # ---- tests -----------------------------------------------------------------
    def test_01_signed_in_and_channel(self):
        self.studio.goto(self.base_url)
        self.assertTrue(self.studio.is_signed_in())
        self.assertEqual(self.studio.channel_id(), mock_studio.CHANNEL)

    def test_02_list_videos_across_pages(self):
        self.studio.open_list("channel")
        videos = self.studio.list_videos()
        self.assertEqual([v.id for v in videos], [v["id"] for v in mock_studio.INITIAL_VIDEOS])
        statuses = {v.id: v.status for v in videos}
        self.assertEqual(statuses["aB3dE5fG7hI"], "draft")
        self.assertEqual(statuses["rS5tU7vW9xY"], "private")
        self.assertEqual(statuses["hI7jK9lM1nO"], "public")
        self.assertTrue(videos[0].draft)
        self.assertEqual(videos[2].title, "Holiday vlog DRAFT part 1")  # a title containing "DRAFT" is not a draft
        self.assertTrue(all(v.thumbnail for v in videos))

    def test_03_playlist_list(self):
        self.studio.open_list("playlist", "https://studio.youtube.com/playlist/PLmockplaylist123456/videos")
        videos = self.studio.list_videos()
        self.assertEqual([v.id for v in videos], ["hI7jK9lM1nO"])

    def test_04_edit_private_video(self):
        video = Video(id="rS5tU7vW9xY", title="Holiday vlog DRAFT part 1", status="private")
        changes = Changes(
            visibility="unlisted",
            new_title="Holiday vlog Final part 1",
            description_mode="append",
            description_text="See you next week!",
            tags_mode="add",
            tags=["travel", "2026"],
            audience="not_for_kids",
            playlist_name="Travel 2026",
        )
        result = self.studio.apply(video, changes)
        self.assertIn("title changed", result.lower())
        saved = self.state()["videos"][2]
        self.assertEqual(saved["title"], "Holiday vlog Final part 1")
        self.assertEqual(saved["description"], "Old text\nSee you next week!")
        self.assertEqual(saved["status"], "unlisted")
        self.assertEqual(saved["tags"], ["old", "travel", "2026"])
        self.assertEqual(saved["playlists"], ["Travel 2026"])
        self.assertEqual(len(self.state()["saves"]), 1)

    def test_05_publish_draft(self):
        video = Video(id="aB3dE5fG7hI", title="Bulk Test 1", status="draft", draft=True)
        changes = Changes(visibility="public", new_title="Episode 1", audience="not_for_kids", description_mode="replace", description_text="First episode")
        result = self.studio.apply(video, changes)
        self.assertIn("published as public", result.lower())
        published = self.state()["publishes"]
        self.assertEqual(len(published), 1)
        self.assertEqual(published[0]["title"], "Episode 1")
        self.assertEqual(published[0]["status"], "public")
        self.assertEqual(published[0]["audience"], "not_for_kids")
        self.assertEqual(self.state()["videos"][0]["status"], "public")

    def test_06_draft_without_audience_is_reported(self):
        from app.studio import StudioError

        video = Video(id="jK9lM1nO3pQ", title="Bulk Test 2", status="draft", draft=True)
        with self.assertRaises(StudioError):
            self.studio.apply(video, Changes(visibility="public"))
        self.studio._close_wizard()

    def test_07_dry_run_changes_nothing(self):
        video = Video(id="zA1bC3dE5fG", title="Holiday vlog DRAFT part 2", status="private")
        result = self.studio.apply(video, Changes(visibility="public", new_title="Changed"), dry_run=True)
        self.assertTrue(result.startswith("Practice run"))
        self.assertEqual(self.state()["saves"], [])
        self.assertEqual(self.state()["videos"][3]["title"], "Holiday vlog DRAFT part 2")

    def test_08_batch_runner_with_ui_plan(self):
        log = ActivityLog(Path(tempfile.mkdtemp(prefix="ytbp-log-")))
        runner = BatchRunner(lambda: self.studio, log)
        videos = [
            {"id": "aB3dE5fG7hI", "title": "Bulk Test 1", "status": "draft", "draft": True},
            {"id": "jK9lM1nO3pQ", "title": "Bulk Test 2", "status": "draft", "draft": True},
            {"id": "zA1bC3dE5fG", "title": "Holiday vlog DRAFT part 2", "status": "private"},
        ]
        plan = [
            {"kind": "visibility", "mode": "public"},
            {"kind": "title", "rules": [{"type": "replace", "find": "DRAFT", "with": "Final"}, {"type": "number", "template": "{n}. {title}", "start": 1}]},
            {"kind": "audience", "value": "not_for_kids"},
        ]
        per_video, new_titles = build_changes(plan, [v["title"] for v in videos])
        self.assertEqual(new_titles, ["1. Bulk Test 1", "2. Bulk Test 2", "3. Holiday vlog Final part 2"])
        runner.start(videos, plan, dry_run=False, pause=0)
        deadline = time.time() + 120
        while time.time() < deadline and runner.progress()["running"]:
            time.sleep(0.5)
        progress = runner.progress()
        self.assertFalse(progress["running"])
        self.assertEqual([i["state"] for i in progress["items"]], ["done", "done", "done"], progress["items"])
        state = self.state()
        self.assertEqual([v["title"] for v in state["videos"][:2]], ["1. Bulk Test 1", "2. Bulk Test 2"])
        self.assertEqual(state["videos"][3]["title"], "3. Holiday vlog Final part 2")
        self.assertEqual({v["status"] for v in [state["videos"][0], state["videos"][1], state["videos"][3]]}, {"public"})
        self.assertIn("3 video(s) updated, 0 problem(s)", progress["summary"])

    def test_09_stop_skips_remaining(self):
        log = ActivityLog(Path(tempfile.mkdtemp(prefix="ytbp-log-")))
        runner = BatchRunner(lambda: self.studio, log)
        videos = [{"id": "zA1bC3dE5fG", "title": "Holiday vlog DRAFT part 2", "status": "private"}, {"id": "hI7jK9lM1nO", "title": "Cooking with grandma", "status": "public"}]
        runner.start(videos, [{"kind": "visibility", "mode": "unlisted"}], dry_run=False, pause=3)
        time.sleep(0.5)
        runner.stop()
        deadline = time.time() + 90
        while time.time() < deadline and runner.progress()["running"]:
            time.sleep(0.5)
        progress = runner.progress()
        self.assertEqual(progress["items"][1]["state"], "skipped")
        self.assertIn("stopped early", progress["summary"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
