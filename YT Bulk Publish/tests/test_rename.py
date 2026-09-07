"""Tests for the bulk rename rules."""
import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import rename  # noqa: E402


class ReplaceRuleTests(unittest.TestCase):
    def test_plain_replace_ignores_case_by_default(self):
        out = rename.apply_rules(["Episode 1 - DRAFT", "draft notes"], [{"type": "replace", "find": "draft", "with": "Final"}])
        self.assertEqual(out, ["Episode 1 - Final", "Final notes"])

    def test_match_case(self):
        out = rename.apply_rules(["Draft draft"], [{"type": "replace", "find": "draft", "with": "X", "match_case": True}])
        self.assertEqual(out, ["Draft X"])

    def test_whole_word(self):
        out = rename.apply_rules(["cat category"], [{"type": "replace", "find": "cat", "with": "dog", "whole_word": True}])
        self.assertEqual(out, ["dog category"])

    def test_phrase_replace(self):
        out = rename.apply_rules(["My Trip to Paris 2019"], [{"type": "replace", "find": "Trip to Paris", "with": "Weekend in Rome"}])
        self.assertEqual(out, ["My Weekend in Rome 2019"])

    def test_empty_find_changes_nothing(self):
        out = rename.apply_rules(["Keep me"], [{"type": "replace", "find": "", "with": "x"}])
        self.assertEqual(out, ["Keep me"])


class OtherRuleTests(unittest.TestCase):
    def test_prefix_suffix_remove(self):
        rules = [
            {"type": "remove", "text": "[raw]"},
            {"type": "trim"},
            {"type": "prefix", "text": "Vlog: "},
            {"type": "suffix", "text": " | 4K"},
        ]
        out = rename.apply_rules(["[raw] Beach day"], rules)
        self.assertEqual(out, ["Vlog: Beach day | 4K"])

    def test_regex_with_groups(self):
        out = rename.apply_rules(["S1E3 Pilot"], [{"type": "regex", "pattern": r"S(\d+)E(\d+)", "with": r"Season \1 Episode \2"}])
        self.assertEqual(out, ["Season 1 Episode 3 Pilot"])

    def test_broken_regex_is_skipped(self):
        out = rename.apply_rules(["Safe"], [{"type": "regex", "pattern": "(", "with": "x"}])
        self.assertEqual(out, ["Safe"])
        self.assertTrue(rename.validate_rules([{"type": "regex", "pattern": "("}]))

    def test_numbering_counts_across_batch(self):
        rules = [{"type": "number", "template": "Lesson {n} - {title}", "start": 1, "step": 1, "padding": 2}]
        out = rename.apply_rules(["Intro", "Setup", "Recap"], rules)
        self.assertEqual(out, ["Lesson 01 - Intro", "Lesson 02 - Setup", "Lesson 03 - Recap"])

    def test_numbering_tokens(self):
        today = dt.date.today().isoformat()
        rules = [
            {"type": "replace", "find": "old", "with": "new"},
            {"type": "number", "template": "{index}. {title} ({original}) {date}", "start": 10, "step": 5},
        ]
        out = rename.apply_rules(["old clip"], rules)
        self.assertEqual(out, [f"1. new clip (old clip) {today}"])

    def test_case_modes(self):
        self.assertEqual(rename.apply_rules(["the art of the deal"], [{"type": "case", "mode": "title"}]), ["The Art of the Deal"])
        self.assertEqual(rename.apply_rules(["NASA launch"], [{"type": "case", "mode": "title"}]), ["NASA Launch"])
        self.assertEqual(rename.apply_rules(["hello WORLD"], [{"type": "case", "mode": "sentence"}]), ["Hello world"])
        self.assertEqual(rename.apply_rules(["abc"], [{"type": "case", "mode": "upper"}]), ["ABC"])
        self.assertEqual(rename.apply_rules(["ABC"], [{"type": "case", "mode": "lower"}]), ["abc"])

    def test_trim_collapses_spaces(self):
        self.assertEqual(rename.apply_rules(["  a   b  "], [{"type": "trim"}]), ["a b"])


class PreviewTests(unittest.TestCase):
    def test_preview_flags_changes_and_problems(self):
        videos = [{"id": "a", "title": "Fine title"}, {"id": "b", "title": "x" * 99}]
        rows = rename.preview(videos, [{"type": "suffix", "text": " !!"}])
        self.assertTrue(rows[0].changed)
        self.assertEqual(rows[0].problems, [])
        self.assertTrue(rows[1].problems)  # too long after the suffix

    def test_preview_unchanged_rows_have_no_problems(self):
        rows = rename.preview([{"id": "a", "title": "Same"}], [{"type": "replace", "find": "zzz", "with": "y"}])
        self.assertFalse(rows[0].changed)
        self.assertEqual(rows[0].to_dict()["problems"], [])

    def test_angle_brackets_are_reported(self):
        self.assertTrue(rename.check_title("a <b>"))


class ValidateTests(unittest.TestCase):
    def test_messages(self):
        problems = rename.validate_rules([
            {"type": "replace", "find": ""},
            {"type": "prefix", "text": ""},
            {"type": "number", "template": "{title}"},
            {"type": "case", "mode": ""},
            {"type": "mystery"},
        ])
        self.assertEqual(len(problems), 5)
        self.assertEqual(rename.validate_rules([{"type": "trim"}]), [])


if __name__ == "__main__":
    unittest.main()
