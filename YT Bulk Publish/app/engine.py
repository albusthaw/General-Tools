"""Runs the chosen changes over many videos, one after another, in the background."""
from __future__ import annotations

import datetime as _dt
import threading
import time
from typing import Callable

from . import rename
from .cdp import DevToolsError
from .settings import ActivityLog
from .studio import Changes, Studio, StudioError, Video


def build_changes(plan_changes: list[dict], titles: list[str]) -> tuple[list[Changes], list[str]]:
    """Turn the interface's change list into one Changes object per video.

    Titles are renamed as a batch so numbering runs in order across all videos.
    Returns the per-video changes and the list of new titles (same order).
    """
    base = Changes()
    new_titles = list(titles)
    schedule_gap = 0
    for change in plan_changes or []:
        kind = change.get("kind")
        if kind == "visibility":
            base.visibility = str(change.get("mode") or "public")
            base.schedule_date = str(change.get("date") or "")
            base.schedule_time = str(change.get("time") or "")
            schedule_gap = int(change.get("gap_minutes") or 0)
        elif kind == "title":
            rules = change.get("rules") or []
            if rules:
                new_titles = rename.apply_rules(titles, rules)
        elif kind == "description":
            base.description_mode = str(change.get("mode") or "replace")
            base.description_text = str(change.get("text") or "")
            base.description_find = str(change.get("find") or "")
            base.description_with = str(change.get("with") or "")
        elif kind == "tags":
            base.tags_mode = str(change.get("mode") or "add")
            base.tags = [t.strip() for t in str(change.get("text") or "").split(",") if t.strip()]
        elif kind == "audience":
            base.audience = str(change.get("value") or "not_for_kids")
        elif kind == "playlist":
            base.playlist_name = str(change.get("name") or "").strip()

    per_video: list[Changes] = []
    for index, (old, new) in enumerate(zip(titles, new_titles)):
        item = Changes(**base.__dict__)
        item.tags = list(base.tags)
        item.new_title = new if new != old else ""
        if item.visibility == "schedule" and schedule_gap and item.schedule_date and item.schedule_time:
            start = _dt.datetime.strptime(f"{item.schedule_date} {item.schedule_time}", "%Y-%m-%d %H:%M")
            when = start + _dt.timedelta(minutes=schedule_gap * index)
            item.schedule_date = when.strftime("%Y-%m-%d")
            item.schedule_time = when.strftime("%H:%M")
        per_video.append(item)
    return per_video, new_titles


class BatchRunner:
    """Applies changes to a list of videos on a background thread."""

    def __init__(self, studio_getter: Callable[[], Studio], log: ActivityLog):
        self._studio_getter = studio_getter
        self.log = log
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self.items: list[dict] = []
        self.running = False
        self.done = 0
        self.current = ""
        self.summary = ""
        self.failed = 0

    # ---- control -----------------------------------------------------------
    def start(self, videos: list[dict], plan_changes: list[dict], dry_run: bool = False, pause: float = 1.5) -> None:
        if self.running:
            raise RuntimeError("Changes are already running.")
        if not videos:
            raise RuntimeError("No videos were selected.")
        titles = [str(v.get("title") or "") for v in videos]
        per_video, _new_titles = build_changes(plan_changes, titles)
        if all(c.is_empty() for c in per_video):
            raise RuntimeError("Nothing to change. Switch on at least one change.")
        with self._lock:
            self.items = [
                {"id": str(v.get("id") or ""), "title": str(v.get("title") or ""), "state": "waiting", "message": ""}
                for v in videos
            ]
            self.done = 0
            self.failed = 0
            self.current = ""
            self.summary = ""
            self.running = True
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            args=(videos, per_video, dry_run, max(0.0, float(pause or 0))),
            name="bulk-runner",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self.log.warning("Stop requested. Finishing the current video first.")

    def progress(self, since: int = 0) -> dict:
        with self._lock:
            return {
                "running": self.running,
                "total": len(self.items),
                "done": self.done,
                "current": self.current,
                "items": [dict(item) for item in self.items],
                "log": self.log.recent(since),
                "log_total": len(self.log.lines),
                "summary": self.summary,
                "failed": self.failed,
            }

    # ---- worker ----------------------------------------------------------------
    def _set_item(self, index: int, state: str, message: str = "") -> None:
        with self._lock:
            self.items[index]["state"] = state
            self.items[index]["message"] = message

    def _run(self, videos: list[dict], per_video: list[Changes], dry_run: bool, pause: float) -> None:
        mode = "Practice run" if dry_run else "Run"
        self.log.info(f"{mode} started for {len(videos)} video(s).")
        stopped = False
        try:
            studio = self._studio_getter()
        except Exception as exc:  # noqa: BLE001
            self.log.error(f"Could not reach the browser: {exc}")
            with self._lock:
                self.running = False
                self.summary = "Could not reach the browser."
            return

        for index, (video_dict, changes) in enumerate(zip(videos, per_video)):
            if self._stop.is_set():
                stopped = True
                for rest in range(index, len(videos)):
                    self._set_item(rest, "skipped", "Stopped before this video")
                break
            video = Video(
                id=str(video_dict.get("id") or ""),
                title=str(video_dict.get("title") or ""),
                status=str(video_dict.get("status") or ""),
                draft=bool(video_dict.get("draft")) or str(video_dict.get("status") or "") == "draft",
            )
            with self._lock:
                self.current = video.title or video.id
            self._set_item(index, "working", "")
            self.log.info(f"[{index + 1}/{len(videos)}] {video.title or video.id}")
            try:
                if changes.is_empty():
                    result = "Nothing to change."
                    self._set_item(index, "skipped", result)
                else:
                    result = studio.apply(video, changes, dry_run=dry_run)
                    self._set_item(index, "done", result)
                self.log.success(f"{video.title or video.id}: {result}")
            except StudioError as exc:
                self._set_item(index, "failed", str(exc))
                self.log.error(f"{video.title or video.id}: {exc}")
                with self._lock:
                    self.failed += 1
                studio.recover()
            except DevToolsError as exc:
                self._set_item(index, "failed", "Lost the link to the browser.")
                self.log.error(f"Lost the link to the browser: {exc}")
                with self._lock:
                    self.failed += 1
                for rest in range(index + 1, len(videos)):
                    self._set_item(rest, "skipped", "Browser link lost")
                break
            except Exception as exc:  # noqa: BLE001
                self._set_item(index, "failed", str(exc)[:200])
                self.log.error(f"{video.title or video.id}: {exc}")
                with self._lock:
                    self.failed += 1
                try:
                    studio.recover()
                except Exception:  # noqa: BLE001
                    pass
            finally:
                with self._lock:
                    self.done = index + 1
            if pause and index < len(videos) - 1 and not self._stop.is_set():
                time.sleep(pause)

        with self._lock:
            ok = sum(1 for i in self.items if i["state"] == "done")
            summary = f"{ok} video(s) updated, {self.failed} problem(s)"
            if dry_run:
                summary = f"Practice run finished: {ok} video(s) checked, {self.failed} problem(s)"
            if stopped:
                summary += ", stopped early"
            self.summary = summary
            self.running = False
            self.current = ""
        self.log.info(self.summary)
