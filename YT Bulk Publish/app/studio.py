"""Working inside YouTube Studio through a controlled browser tab.

This module reads the video list and edits one video at a time by using the
same buttons and boxes a person would use. Every step waits for the page to
be ready and reports a plain-language error when something cannot be found.
"""
from __future__ import annotations

import datetime as _dt
import json
import re
import time
from dataclasses import dataclass, field
from typing import Callable
from urllib.parse import urlparse

from . import selectors as S
from .cdp import BrowserEndpoint, DevToolsError, Page


class StudioError(RuntimeError):
    """Something on the YouTube Studio page did not go as expected."""


@dataclass
class Video:
    id: str
    title: str
    status: str = ""
    date: str = ""
    duration: str = ""
    thumbnail: str = ""
    draft: bool = False

    def to_dict(self) -> dict:
        labels = {"draft": "Draft", "private": "Private", "unlisted": "Unlisted", "public": "Public", "scheduled": "Scheduled", "members": "Members only"}
        return {
            "id": self.id,
            "title": self.title,
            "status": self.status or "unknown",
            "status_label": labels.get(self.status, self.status.title() if self.status else "Unknown"),
            "date": self.date,
            "duration": self.duration,
            "thumbnail": self.thumbnail,
            "draft": self.draft,
        }


@dataclass
class Changes:
    """What to do to each video. Empty fields mean "leave as it is"."""

    visibility: str = ""  # public | unlisted | private | schedule
    schedule_date: str = ""  # YYYY-MM-DD
    schedule_time: str = ""  # HH:MM (24h)
    new_title: str = ""
    description_mode: str = ""  # replace | prepend | append | find
    description_text: str = ""
    description_find: str = ""
    description_with: str = ""
    tags_mode: str = ""  # add | replace
    tags: list[str] = field(default_factory=list)
    audience: str = ""  # for_kids | not_for_kids
    playlist_name: str = ""

    def touches_details(self) -> bool:
        return bool(self.new_title or self.description_mode or self.tags_mode or self.audience or self.playlist_name)

    def is_empty(self) -> bool:
        return not (self.visibility or self.touches_details())


class Elem:
    """A handle to an element that the helper script keeps for us."""

    def __init__(self, studio: "Studio", ref: int):
        self.studio = studio
        self.ref = int(ref or 0)

    def __bool__(self) -> bool:
        return self.ref > 0


class Studio:
    """One connected YouTube Studio tab."""

    def __init__(
        self,
        page: Page,
        log: Callable[[str, str], None] | None = None,
        slow: float = 0.35,
        base_url: str = S.STUDIO_URL,
    ):
        self.page = page
        self._log = log or (lambda message, level="info": None)
        self.slow = slow
        self.base_url = base_url.rstrip("/") + "/"
        self.host = urlparse(self.base_url).netloc
        self.ensure_helpers()

    # ---- basics -------------------------------------------------------------
    def log(self, message: str, level: str = "info") -> None:
        self._log(message, level)

    def ensure_helpers(self) -> None:
        self.page.evaluate(S.HELPER_JS)
        self.page.evaluate(f"window.__ytbp.studioHost = {json.dumps(self.host)}; true")

    def h(self, expression: str, *args, timeout: float = 30.0):
        """Call a helper function on the page, re-injecting the script if needed."""
        encoded = ", ".join(json.dumps(a) for a in args)
        code = f"(window.__ytbp && window.__ytbp.version === 3) ? window.__ytbp.{expression}({encoded}) : '__no_helper__'"
        result = self.page.evaluate(code, timeout=timeout)
        if result == "__no_helper__":
            self.ensure_helpers()
            result = self.page.evaluate(f"window.__ytbp.{expression}({encoded})", timeout=timeout)
        return result

    def url(self) -> str:
        return self.page.url()

    def pause(self, seconds: float | None = None) -> None:
        time.sleep(self.slow if seconds is None else seconds)

    def goto(self, url: str, wait_for: list[str] | None = None, timeout: float = 45.0) -> None:
        self.log(f"Opening {url}")
        self.page.navigate(url, timeout=timeout)
        self.page.wait_ready(timeout=timeout)
        self.ensure_helpers()
        if wait_for:
            self.wait_for(wait_for, timeout=timeout, message="The page did not finish loading.")

    def is_signed_in(self) -> bool:
        try:
            return bool(self.h("signedIn"))
        except DevToolsError:
            return False

    def channel_id(self) -> str:
        cid = self.h("channelId") or ""
        if not cid:
            self.goto(self.base_url)
            deadline = time.time() + 20
            while time.time() < deadline and not cid:
                time.sleep(0.5)
                cid = self.h("channelId") or ""
        return cid

    # ---- finding and acting on elements ------------------------------------
    def find(self, selectors: list[str], visible: bool = True) -> Elem:
        return Elem(self, self.h("find", selectors, visible))

    def find_in(self, parent: Elem, selectors: list[str], visible: bool = True) -> Elem:
        return Elem(self, self.h("findIn", parent.ref, selectors, visible))

    def find_text(self, selectors: list[str], pattern: str, parent: Elem | None = None) -> Elem:
        return Elem(self, self.h("findText", selectors, pattern, parent.ref if parent else 0))

    def exists(self, selectors: list[str], visible: bool = True) -> bool:
        return bool(self.h("exists", selectors, visible))

    def wait_for(self, selectors: list[str], timeout: float = 20.0, message: str = "", text: str | None = None, parent: Elem | None = None) -> Elem:
        deadline = time.time() + timeout
        while time.time() < deadline:
            elem = self.find_text(selectors, text, parent) if text else self.find(selectors)
            if elem:
                return elem
            time.sleep(0.3)
        raise StudioError(message or f"Could not find the expected part of the page ({selectors[0]}).")

    def wait_gone(self, selectors: list[str], timeout: float = 20.0) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if not self.exists(selectors):
                return True
            time.sleep(0.3)
        return False

    def click(self, elem: Elem, what: str = "button") -> None:
        if not elem:
            raise StudioError(f"Could not find the {what}.")
        rect = self.h("rect", elem.ref)
        self.pause(0.15)
        if rect and rect.get("visible") and rect["w"] > 0:
            try:
                self.page.mouse_click(rect["x"], rect["y"])
                return
            except DevToolsError:
                pass
        if not self.h("jsClick", elem.ref):
            raise StudioError(f"Could not press the {what}.")

    def type_into(self, elem: Elem, text: str, what: str = "box") -> str:
        if not elem:
            raise StudioError(f"Could not find the {what}.")
        self.h("rect", elem.ref)
        focused = self.h("focus", elem.ref)
        if focused:
            try:
                self.page.select_all()
                self.page.press("Backspace")
                if text:
                    self.page.insert_text(text)
                self.pause(0.2)
                value = self.h("value", elem.ref) or ""
                if value.strip() == text.strip():
                    return value
            except DevToolsError:
                pass
        value = self.h("setText", elem.ref, text)
        self.pause(0.2)
        return value or ""

    def read(self, elem: Elem) -> str:
        return (self.h("value", elem.ref) if elem else "") or ""

    def is_disabled(self, elem: Elem) -> bool:
        return bool(self.h("isDisabled", elem.ref)) if elem else True

    def is_checked(self, elem: Elem) -> bool:
        return bool(self.h("isChecked", elem.ref)) if elem else False

    def dismiss_confirmation(self, timeout: float = 2.0) -> bool:
        """Press the confirming button on a small pop-up, if one appeared."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            btn = self.find_text(S.CONFIRM_BUTTON, S.CONFIRM_TEXT)
            if btn:
                self.click(btn, "confirmation button")
                self.pause(0.5)
                return True
            time.sleep(0.25)
        return False

    # ---- video list -----------------------------------------------------------
    def content_url(self, kind: str = "channel", value: str = "") -> str:
        if kind == "playlist":
            match = re.search(r"(PL[\w-]{10,}|UU[\w-]{10,}|LL[\w-]{10,}|OL[\w-]{10,})", value or "")
            if not match:
                raise StudioError("That does not look like a playlist link or ID.")
            return f"{self.base_url}playlist/{match.group(1)}/videos"
        if kind == "current":
            return self.url()
        cid = self.channel_id()
        if not cid:
            raise StudioError("Could not work out which channel is open. Open YouTube Studio in the browser first.")
        return f"{self.base_url}channel/{cid}/videos/upload"

    def open_list(self, kind: str = "channel", value: str = "") -> str:
        url = self.content_url(kind, value)
        current = self.url()
        if kind == "current":
            if self.host not in current:
                raise StudioError("The open page is not YouTube Studio. Open your channel content or a playlist first.")
            if not self.exists(S.ROW, visible=True):
                raise StudioError("The open page does not show a video list. Open Content or a playlist in YouTube Studio first.")
            return current
        if current.split("?")[0].rstrip("/") != url.rstrip("/"):
            self.goto(url)
        self.wait_for_rows()
        return url

    def wait_for_rows(self, timeout: float = 30.0) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.exists(S.ROW, visible=True):
                self.pause(0.8)  # let the row contents settle
                return
            body = ""
            try:
                body = self.page.evaluate("document.body ? document.body.innerText.slice(0, 4000) : ''") or ""
            except DevToolsError:
                pass
            if re.search(r"no content available|no videos|nothing here", body, re.I):
                return
            time.sleep(0.4)
        raise StudioError("The video list did not appear. Make sure you are signed in to YouTube Studio.")

    def set_page_size(self, size: int = 50) -> bool:
        trigger = self.find(S.PAGE_SIZE_TRIGGER)
        if not trigger:
            return False
        try:
            self.click(trigger, "page size menu")
            self.pause(0.6)
            item = self.find_text(S.PAGE_SIZE_ITEM, rf"^\s*{size}\s*$")
            if not item:
                self.page.press("Escape")
                return False
            self.click(item, "page size option")
            self.pause(1.2)
            return True
        except StudioError:
            return False

    def list_videos(self, max_pages: int = 60) -> list[Video]:
        self.wait_for_rows()
        self.set_page_size(50)
        videos: list[Video] = []
        seen: set[str] = set()
        for page_number in range(max_pages):
            rows = self.h("parseRows") or []
            new_rows = 0
            for row in rows:
                key = row.get("id") or f"title:{row.get('title')}"
                if key in seen:
                    continue
                seen.add(key)
                new_rows += 1
                videos.append(
                    Video(
                        id=row.get("id") or "",
                        title=row.get("title") or "",
                        status=row.get("status") or "",
                        date=row.get("date") or "",
                        duration=row.get("duration") or "",
                        thumbnail=row.get("thumbnail") or "",
                        draft=bool(row.get("draft")),
                    )
                )
            self.log(f"Read page {page_number + 1}: {len(rows)} rows, {len(videos)} videos so far.")
            next_button = self.find(S.NEXT_PAGE, visible=True)
            if not next_button or self.is_disabled(next_button) or new_rows == 0:
                break
            self.click(next_button, "next page button")
            self.pause(1.5)
            self.wait_for_rows()
        return videos

    # ---- editing one video ---------------------------------------------------------
    def apply(self, video: Video, changes: Changes, dry_run: bool = False) -> str:
        """Make the changes to one video and return a short result message."""
        if changes.is_empty():
            return "Nothing to change."
        if not video.id:
            return self._apply_from_list(video, changes, dry_run)
        edit_url = f"{self.base_url}video/{video.id}/edit"
        self.goto(edit_url)
        kind = self._wait_for_editor_or_wizard()
        if kind == "wizard":
            return self._apply_in_wizard(video, changes, dry_run)
        if kind == "editor":
            return self._apply_in_editor(video, changes, dry_run)
        # Fall back to the content list and the "Edit draft" button.
        return self._apply_from_list(video, changes, dry_run)

    def _wait_for_editor_or_wizard(self, timeout: float = 25.0) -> str:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.exists(S.WIZARD):
                return "wizard"
            if self.exists(S.TITLE_BOX) and self.exists(S.SAVE_BUTTON + ["ytcp-button"]):
                return "editor"
            time.sleep(0.4)
        return ""

    def _apply_from_list(self, video: Video, changes: Changes, dry_run: bool) -> str:
        if not self.exists(S.ROW):
            self.open_list("channel")
        row = Elem(self, self.h("rowFor", video.id, video.title))
        if not row:
            raise StudioError("Could not find this video in the list any more.")
        button = self.find_text(S.EDIT_DRAFT_BUTTON, S.EDIT_DRAFT_TEXT, row)
        if not button:
            title_link = self.find_in(row, S.ROW_TITLE)
            self.click(title_link, "video title")
        else:
            self.click(button, "Edit draft button")
        kind = self._wait_for_editor_or_wizard()
        if kind == "wizard":
            return self._apply_in_wizard(video, changes, dry_run)
        if kind == "editor":
            return self._apply_in_editor(video, changes, dry_run)
        raise StudioError("The editing window did not open for this video.")

    # ---- shared detail fields ------------------------------------------------------
    def _set_details(self, changes: Changes, dry_run: bool, notes: list[str]) -> None:
        if changes.new_title:
            box = self.wait_for(S.TITLE_BOX, message="Could not find the title box.")
            current = self.read(box)
            if current.strip() != changes.new_title.strip():
                if dry_run:
                    notes.append(f"title would change to “{changes.new_title}”")
                else:
                    self.type_into(box, changes.new_title, "title box")
                    notes.append("title changed")
        if changes.description_mode:
            box = self.wait_for(S.DESCRIPTION_BOX, message="Could not find the description box.")
            current = self.read(box)
            new_text = self._new_description(current, changes)
            if new_text != current:
                if dry_run:
                    notes.append("description would change")
                else:
                    self.type_into(box, new_text, "description box")
                    notes.append("description changed")
        if changes.audience:
            target = S.AUDIENCE_KIDS if changes.audience == "for_kids" else S.AUDIENCE_NOT_KIDS
            radio = self.find(target)
            if radio and not self.is_checked(radio):
                if dry_run:
                    notes.append("audience would be set")
                else:
                    self.click(radio, "audience choice")
                    notes.append("audience set")
            elif not radio:
                notes.append("audience choice not found on this page")
        if changes.tags_mode:
            self._set_tags(changes, dry_run, notes)
        if changes.playlist_name:
            self._add_to_playlist(changes.playlist_name, dry_run, notes)

    @staticmethod
    def _new_description(current: str, changes: Changes) -> str:
        mode = changes.description_mode
        if mode == "replace":
            return changes.description_text
        if mode == "prepend":
            return (changes.description_text + ("\n" if current else "") + current) if changes.description_text else current
        if mode == "append":
            return (current + ("\n" if current else "") + changes.description_text) if changes.description_text else current
        if mode == "find" and changes.description_find:
            return re.sub(re.escape(changes.description_find), lambda _m: changes.description_with, current, flags=re.I)
        return current

    def _reveal_more(self) -> None:
        more = self.find_text(S.SHOW_MORE, S.SHOW_MORE_TEXT)
        if more:
            self.click(more, "Show more button")
            self.pause(0.8)

    def _set_tags(self, changes: Changes, dry_run: bool, notes: list[str]) -> None:
        tags = [t.strip() for t in changes.tags if t.strip()]
        if not tags:
            return
        box = self.find(S.TAGS_INPUT)
        if not box:
            self._reveal_more()
            box = self.find(S.TAGS_INPUT)
        if not box:
            notes.append("tags box not found")
            return
        if dry_run:
            notes.append(f"{len(tags)} tags would be {'added' if changes.tags_mode == 'add' else 'set'}")
            return
        if changes.tags_mode == "replace":
            for _ in range(200):
                remover = self.find(S.TAG_CHIP_REMOVE)
                if not remover:
                    break
                self.click(remover, "tag remove button")
                self.pause(0.1)
        self.h("rect", box.ref)
        self.h("focus", box.ref)
        for tag in tags:
            self.page.insert_text(tag + ",")
            self.pause(0.15)
        notes.append("tags updated")

    def _add_to_playlist(self, name: str, dry_run: bool, notes: list[str]) -> None:
        opener = self.find(S.PLAYLIST_OPENER)
        if not opener:
            notes.append("playlist box not found")
            return
        if dry_run:
            notes.append(f"would be added to “{name}”")
            return
        self.click(opener, "playlist box")
        self.wait_for(S.PLAYLIST_DIALOG, timeout=10, message="The playlist list did not open.")
        self.pause(0.6)
        item = self.find_text(S.PLAYLIST_ITEM, r"^\s*" + re.escape(name) + r"\s*$")
        if not item:
            item = self.find_text(S.PLAYLIST_ITEM, re.escape(name))
        if not item:
            self.page.press("Escape")
            notes.append(f"playlist “{name}” not found")
            return
        if not self.is_checked(item):
            self.click(item, "playlist entry")
        done = self.find_text(S.PLAYLIST_DONE, S.PLAYLIST_DONE_TEXT)
        self.click(done, "Done button")
        self.pause(0.5)
        notes.append(f"added to “{name}”")

    # ---- the normal editor -----------------------------------------------------------
    def _apply_in_editor(self, video: Video, changes: Changes, dry_run: bool) -> str:
        notes: list[str] = []
        self._set_details(changes, dry_run, notes)
        if changes.visibility:
            self._set_visibility_editor(changes, dry_run, notes)
        if dry_run:
            return "Practice run: " + (", ".join(notes) if notes else "no changes needed")
        if not notes:
            return "Already up to date."
        self._save_editor()
        return ", ".join(notes).capitalize()

    def _set_visibility_editor(self, changes: Changes, dry_run: bool, notes: list[str]) -> None:
        opener = self.find(S.VISIBILITY_OPENER)
        if not opener:
            raise StudioError("Could not find the visibility box on the video page.")
        current = self.read(opener).lower()
        want = changes.visibility
        if want != "schedule" and want in current and "schedule" not in current:
            notes.append(f"already {want}")
            return
        if dry_run:
            notes.append(f"visibility would become {want}")
            return
        self.click(opener, "visibility box")
        self.wait_for(S.VISIBILITY_RADIOS, timeout=10, message="The visibility choices did not open.")
        self._choose_visibility(changes)
        done = self.find_text(S.VISIBILITY_DONE + ["ytcp-button", "button"], S.VISIBILITY_DONE_TEXT)
        if done:
            self.click(done, "Done button")
            self.pause(0.5)
        notes.append(f"visibility set to {want}")

    def _choose_visibility(self, changes: Changes) -> None:
        want = changes.visibility
        if want == "schedule":
            self._choose_schedule(changes)
            return
        radio = self.find(S.VISIBILITY_RADIO[want])
        if not radio:
            raise StudioError(f"Could not find the “{want}” choice.")
        self.click(radio, f"{want} choice")
        self.pause(0.4)

    def _choose_schedule(self, changes: Changes) -> None:
        if not changes.schedule_date:
            raise StudioError("Pick a date for the schedule first.")
        radio = self.find(S.SCHEDULE_RADIO)
        if not radio:
            raise StudioError("Could not find the Schedule choice.")
        self.click(radio, "Schedule choice")
        self.pause(0.6)
        when = _dt.datetime.strptime(changes.schedule_date, "%Y-%m-%d")
        date_trigger = self.find(S.SCHEDULE_DATE_TRIGGER)
        if not date_trigger:
            raise StudioError("Could not find the date box for scheduling.")
        self.click(date_trigger, "date box")
        self.pause(0.6)
        date_input = self.wait_for(S.SCHEDULE_DATE_INPUT, timeout=8, message="The date box did not open.")
        # YouTube accepts the same wording it shows, for example "Sep 8, 2026".
        self.type_into(date_input, f"{when.strftime('%b')} {when.day}, {when.year}", "date box")
        self.page.press("Enter")
        self.pause(0.6)
        if changes.schedule_time:
            hour, minute = [int(x) for x in changes.schedule_time.split(":")[:2]]
            minute = (minute // 15) * 15
            hour12 = hour % 12 or 12
            time_label = f"{hour12}:{minute:02d} {'AM' if hour < 12 else 'PM'}"
            time_trigger = self.find(S.SCHEDULE_TIME_TRIGGER)
            if time_trigger:
                self.click(time_trigger, "time box")
                self.pause(0.6)
                item = self.find_text(S.SCHEDULE_TIME_ITEM, r"^\s*" + re.escape(time_label).replace("\\ ", r"\s*") + r"\s*$")
                if not item:
                    self.page.press("Escape")
                    raise StudioError(f"Could not pick the time {time_label}.")
                self.click(item, "time option")
                self.pause(0.4)

    def _save_editor(self) -> None:
        save = self.find(S.SAVE_BUTTON) or self.find_text(["ytcp-button", "button"], S.SAVE_TEXT)
        if not save:
            raise StudioError("Could not find the Save button.")
        if self.is_disabled(save):
            return
        self.click(save, "Save button")
        self.pause(0.8)
        self.dismiss_confirmation(timeout=2.5)
        deadline = time.time() + 30
        while time.time() < deadline:
            save = self.find(S.SAVE_BUTTON) or self.find_text(["ytcp-button", "button"], S.SAVE_TEXT)
            if not save or self.is_disabled(save):
                return
            time.sleep(0.4)
        raise StudioError("YouTube did not confirm that the changes were saved.")

    # ---- the draft / upload wizard ------------------------------------------------------
    def _apply_in_wizard(self, video: Video, changes: Changes, dry_run: bool) -> str:
        notes: list[str] = []
        wizard = self.wait_for(S.WIZARD, timeout=15, message="The draft window did not open.")
        self.pause(1.0)
        step = self.find(S.WIZARD_STEP_DETAILS)
        if step:
            self.click(step, "Details step")
            self.pause(0.6)
        self._set_details(changes, dry_run, notes)
        if not changes.visibility:
            if dry_run:
                self._close_wizard()
                return "Practice run: " + (", ".join(notes) if notes else "no changes needed")
            # A draft has no Save button; going to the last step and back keeps the edits.
            self._close_wizard()
            return (", ".join(notes).capitalize() if notes else "Already up to date.") + " (still a draft)"
        self._go_to_visibility_step()
        if dry_run:
            notes.append(f"would be published as {changes.visibility}")
            self._close_wizard()
            return "Practice run: " + ", ".join(notes)
        self._choose_visibility(changes)
        done = self.find(S.WIZARD_DONE)
        if not done:
            done = self.find_text(["ytcp-button", "button"], r"^\s*(done|publish|schedule|save)\s*$", wizard)
        if not done:
            raise StudioError("Could not find the Done button in the draft window.")
        if self.is_disabled(done):
            raise StudioError("YouTube is not letting this draft be published yet (usually the audience choice is missing).")
        self.click(done, "Done button")
        self.pause(1.0)
        self._close_after_publish()
        notes.append(f"published as {changes.visibility}")
        return ", ".join(notes).capitalize()

    def _go_to_visibility_step(self) -> None:
        badge = self.find(S.WIZARD_STEP_VISIBILITY)
        if badge:
            self.click(badge, "Visibility step")
            self.pause(0.8)
        for _ in range(4):
            if self.exists(S.VISIBILITY_RADIOS) or self.exists(S.VISIBILITY_RADIO["public"]):
                return
            nxt = self.find(S.WIZARD_NEXT)
            if not nxt:
                break
            if self.is_disabled(nxt):
                raise StudioError("YouTube will not go to the next step. Fill in the audience choice for this draft first.")
            self.click(nxt, "Next button")
            self.pause(0.9)
        if not (self.exists(S.VISIBILITY_RADIOS) or self.exists(S.VISIBILITY_RADIO["public"])):
            raise StudioError("Could not reach the Visibility step of the draft window.")

    def _close_after_publish(self) -> None:
        deadline = time.time() + 30
        while time.time() < deadline:
            close = self.find(S.SHARE_DIALOG_CLOSE) or self.find_text(["ytcp-button", "button"], S.SHARE_DIALOG_CLOSE_TEXT)
            if close and not self.exists(S.WIZARD_DONE):
                self.click(close, "Close button")
                self.pause(0.6)
            if not self.exists(S.WIZARD):
                return
            time.sleep(0.5)
        # The wizard is still open; try the X button so the next video can start.
        self._close_wizard()

    def _close_wizard(self) -> None:
        close = self.find(S.WIZARD_CLOSE)
        if close:
            self.click(close, "Close button")
            self.pause(0.6)
            self.dismiss_confirmation(timeout=1.5)
        self.wait_gone(S.WIZARD, timeout=8)


def connect_studio(
    endpoint: BrowserEndpoint,
    log: Callable[[str, str], None] | None = None,
    base_url: str = S.STUDIO_URL,
) -> tuple[Page, dict]:
    """Attach to the YouTube Studio tab of a controlled browser (opening one if needed)."""
    host = urlparse(base_url).netloc
    target = endpoint.find_page(host)
    if not target and host == S.STUDIO_HOST:
        target = endpoint.find_page("youtube.com") or endpoint.find_page("accounts.google.com")
    if not target:
        target = endpoint.new_page(base_url)
    try:
        endpoint.activate(target.get("id", ""))
    except DevToolsError:
        pass
    page = endpoint.connect(target)
    page.bring_to_front()
    return page, target
