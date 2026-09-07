"""Paging stress test: many videos spread over several pages of the mock Studio.

Set YT_BULK_MOCK_COUNT to change the number of generated videos (default 32).
"""
from __future__ import annotations

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

from app.cdp import BrowserEndpoint  # noqa: E402
from app.studio import Studio, connect_studio  # noqa: E402
from tests import mock_studio  # noqa: E402
from tests.test_engine_mock import find_chromium  # noqa: E402

COUNT = int(os.environ.get("YT_BULK_MOCK_COUNT", "32"))


class PagingTest(unittest.TestCase):
    port = 9557

    @classmethod
    def setUpClass(cls):
        exe = find_chromium()
        if not exe:
            raise unittest.SkipTest("no Chromium-based browser available")
        cls.server, cls.base_url = mock_studio.start_server()
        urllib.request.urlopen(cls.base_url + f"api/load_many?count={COUNT}&page_size=10").read()
        cls.profile = tempfile.mkdtemp(prefix="ytbp-paging-profile-")
        cls.browser = subprocess.Popen(
            [exe, f"--remote-debugging-port={cls.port}", f"--user-data-dir={cls.profile}", "--headless=new", "--no-sandbox",
             "--no-first-run", "--disable-gpu", "--window-size=1300,900", cls.base_url],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        cls.endpoint = BrowserEndpoint(port=cls.port)
        deadline = time.time() + 30
        while time.time() < deadline and not cls.endpoint.is_alive():
            time.sleep(0.3)
        if not cls.endpoint.is_alive():
            raise unittest.SkipTest("browser did not start with remote control")
        cls.page, _ = connect_studio(cls.endpoint, base_url=cls.base_url)
        cls.messages: list[str] = []
        cls.studio = Studio(cls.page, log=lambda m, level="info": cls.messages.append(m), slow=0.1, base_url=cls.base_url)

    @classmethod
    def tearDownClass(cls):
        try:
            cls.page.close()
        except Exception:  # noqa: BLE001
            pass
        cls.browser.terminate()
        try:
            cls.browser.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.browser.kill()
        cls.server.shutdown()
        shutil.rmtree(cls.profile, ignore_errors=True)

    def test_01_reads_every_page_at_ten_rows(self):
        self.studio.open_list("channel")
        videos = self.studio.list_videos(page_size=None)  # keep the mock's 10 rows per page
        self.assertEqual(len(videos), COUNT)
        self.assertEqual(len({v.id for v in videos}), COUNT, "every video id should appear once")
        self.assertEqual(videos[0].title, "Generated clip 01")
        self.assertEqual(videos[-1].title, f"Generated clip {COUNT:02d}")
        pages_read = sum(1 for m in self.messages if m.startswith("Read page"))
        self.assertEqual(pages_read, -(-COUNT // 10), self.messages)

    def test_02_switching_to_fifty_rows_reads_fewer_pages(self):
        self.messages.clear()
        self.studio.open_list("channel")
        videos = self.studio.list_videos(page_size=50)
        self.assertEqual(len(videos), COUNT)
        pages_read = sum(1 for m in self.messages if m.startswith("Read page"))
        self.assertEqual(pages_read, -(-COUNT // 50), self.messages)
        self.assertIn("50", self.studio.footer_text())

    def test_03_statuses_survive_paging(self):
        self.studio.open_list("channel")
        videos = self.studio.list_videos(page_size=None)
        counts = {}
        for video in videos:
            counts[video.status] = counts.get(video.status, 0) + 1
        self.assertEqual(sum(counts.values()), COUNT)
        self.assertEqual(set(counts), {"draft", "private", "unlisted", "public"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
