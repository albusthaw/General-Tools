"""Bulk rename rules for video titles.

A rename plan is an ordered list of rule dictionaries coming straight from the
user interface. Rules are applied top to bottom to every selected title, and
the numbering rule counts across the whole batch so serial names stay in order.

Supported rule types
--------------------
replace   {"type": "replace", "find": "old", "with": "new", "match_case": false, "whole_word": false}
regex     {"type": "regex", "pattern": "S(\\d+)", "with": "Season \\1", "match_case": false}
prefix    {"type": "prefix", "text": "New - "}
suffix    {"type": "suffix", "text": " (2026)"}
remove    {"type": "remove", "text": "DRAFT", "match_case": false}
number    {"type": "number", "template": "{title} {n}", "start": 1, "step": 1, "padding": 2}
case      {"type": "case", "mode": "title" | "upper" | "lower" | "sentence"}
trim      {"type": "trim"}

Number templates understand these tokens: {title} the title so far, {n} the
serial number, {index} the 1-based position in the batch, {date} today's date
as YYYY-MM-DD, and {original} the title before any rule ran.
"""
from __future__ import annotations

import datetime as _dt
import re
from dataclasses import dataclass, field
from typing import Iterable

TITLE_MAX_LENGTH = 100
FORBIDDEN_CHARACTERS = ("<", ">")


@dataclass
class RenamePreview:
    """One row of the preview table shown before changes are applied."""

    video_id: str
    old_title: str
    new_title: str
    changed: bool
    problems: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.video_id,
            "old": self.old_title,
            "new": self.new_title,
            "changed": self.changed,
            "problems": list(self.problems),
        }


def _flags(match_case: bool) -> int:
    return 0 if match_case else re.IGNORECASE


def _replace_plain(text: str, find: str, replacement: str, match_case: bool, whole_word: bool) -> str:
    if not find:
        return text
    pattern = re.escape(find)
    if whole_word:
        pattern = r"(?<!\w)" + pattern + r"(?!\w)"
    return re.sub(pattern, lambda _m: replacement, text, flags=_flags(match_case))


def _to_title_case(text: str) -> str:
    small_words = {"a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "via"}
    words = text.split(" ")
    out: list[str] = []
    for index, word in enumerate(words):
        if not word:
            out.append(word)
            continue
        lowered = word.lower()
        if index not in (0, len(words) - 1) and lowered in small_words:
            out.append(lowered)
        elif word.isupper() and len(word) > 1:
            out.append(word)  # keep acronyms as they are
        else:
            out.append(word[0].upper() + word[1:])
    return " ".join(out)


def _to_sentence_case(text: str) -> str:
    stripped = text.lstrip()
    if not stripped:
        return text
    leading = text[: len(text) - len(stripped)]
    return leading + stripped[0].upper() + stripped[1:].lower()


def _apply_case(text: str, mode: str) -> str:
    mode = (mode or "").lower()
    if mode == "upper":
        return text.upper()
    if mode == "lower":
        return text.lower()
    if mode == "title":
        return _to_title_case(text)
    if mode == "sentence":
        return _to_sentence_case(text)
    return text


def _format_number(value: int, padding: int) -> str:
    padding = max(0, int(padding or 0))
    return str(value).zfill(padding) if padding else str(value)


def _fill_template(template: str, *, title: str, original: str, number: str, index: int) -> str:
    today = _dt.date.today().isoformat()
    replacements = {
        "{title}": title,
        "{original}": original,
        "{n}": number,
        "{index}": str(index),
        "{date}": today,
    }
    result = template or "{title}"
    for token, value in replacements.items():
        result = result.replace(token, value)
    return result


def _clean_spaces(text: str) -> str:
    return re.sub(r"\s{2,}", " ", text).strip()


def apply_rules(titles: Iterable[str], rules: Iterable[dict]) -> list[str]:
    """Return the renamed titles, in the same order as the input."""
    titles = list(titles)
    rules = [dict(rule) for rule in rules if rule and rule.get("type")]
    working = list(titles)

    for rule in rules:
        kind = str(rule.get("type", "")).lower()

        if kind == "replace":
            working = [
                _replace_plain(
                    text,
                    str(rule.get("find", "")),
                    str(rule.get("with", "")),
                    bool(rule.get("match_case", False)),
                    bool(rule.get("whole_word", False)),
                )
                for text in working
            ]

        elif kind == "regex":
            pattern = str(rule.get("pattern", ""))
            if pattern:
                try:
                    compiled = re.compile(pattern, _flags(bool(rule.get("match_case", False))))
                except re.error:
                    continue  # a broken pattern is reported by validate_rules; skip it here
                replacement = str(rule.get("with", ""))
                working = [compiled.sub(replacement, text) for text in working]

        elif kind == "prefix":
            text_to_add = str(rule.get("text", ""))
            working = [text_to_add + text for text in working]

        elif kind == "suffix":
            text_to_add = str(rule.get("text", ""))
            working = [text + text_to_add for text in working]

        elif kind == "remove":
            working = [
                _replace_plain(text, str(rule.get("text", "")), "", bool(rule.get("match_case", False)), False)
                for text in working
            ]

        elif kind == "number":
            start = int(rule.get("start", 1) or 0)
            step = int(rule.get("step", 1) or 1)
            padding = int(rule.get("padding", 0) or 0)
            template = str(rule.get("template") or "{title} {n}")
            renamed: list[str] = []
            for index, text in enumerate(working):
                number = _format_number(start + index * step, padding)
                renamed.append(
                    _fill_template(template, title=text, original=titles[index], number=number, index=index + 1)
                )
            working = renamed

        elif kind == "case":
            working = [_apply_case(text, str(rule.get("mode", ""))) for text in working]

        elif kind == "trim":
            working = [_clean_spaces(text) for text in working]

    return working


def validate_rules(rules: Iterable[dict]) -> list[str]:
    """Return plain-language problems with the rule list (empty list means fine)."""
    problems: list[str] = []
    for position, rule in enumerate(rules, start=1):
        kind = str((rule or {}).get("type", "")).lower()
        if kind == "replace" and not str(rule.get("find", "")):
            problems.append(f"Step {position}: type the word or phrase to look for.")
        elif kind == "regex":
            pattern = str(rule.get("pattern", ""))
            if not pattern:
                problems.append(f"Step {position}: the pattern is empty.")
            else:
                try:
                    re.compile(pattern)
                except re.error as exc:
                    problems.append(f"Step {position}: the pattern is not valid ({exc.msg}).")
        elif kind in ("prefix", "suffix") and not str(rule.get("text", "")):
            problems.append(f"Step {position}: type the text to add.")
        elif kind == "remove" and not str(rule.get("text", "")):
            problems.append(f"Step {position}: type the text to remove.")
        elif kind == "number":
            template = str(rule.get("template") or "")
            if template and "{n}" not in template and "{index}" not in template:
                problems.append(f"Step {position}: the numbering template needs {{n}} somewhere.")
        elif kind == "case" and str(rule.get("mode", "")).lower() not in ("title", "upper", "lower", "sentence"):
            problems.append(f"Step {position}: choose a letter case style.")
        elif kind not in ("replace", "regex", "prefix", "suffix", "remove", "number", "case", "trim"):
            problems.append(f"Step {position}: unknown rule.")
    return problems


def check_title(title: str) -> list[str]:
    """Return plain-language problems with a single final title."""
    problems: list[str] = []
    if not title.strip():
        problems.append("The title would be empty.")
    if len(title) > TITLE_MAX_LENGTH:
        problems.append(f"Too long ({len(title)} characters, the limit is {TITLE_MAX_LENGTH}).")
    if any(ch in title for ch in FORBIDDEN_CHARACTERS):
        problems.append("YouTube does not allow < or > in titles.")
    return problems


def preview(videos: Iterable[dict], rules: Iterable[dict]) -> list[RenamePreview]:
    """Build the old/new preview for a list of {"id", "title"} dictionaries."""
    videos = list(videos)
    old_titles = [str(video.get("title", "")) for video in videos]
    new_titles = apply_rules(old_titles, rules)
    rows: list[RenamePreview] = []
    for video, old, new in zip(videos, old_titles, new_titles):
        rows.append(
            RenamePreview(
                video_id=str(video.get("id", "")),
                old_title=old,
                new_title=new,
                changed=old != new,
                problems=check_title(new) if old != new else [],
            )
        )
    return rows
