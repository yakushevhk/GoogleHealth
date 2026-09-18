"""Unit tests for pure helpers and validation — parity with go/tools_test.go + go/types_test.go."""

import asyncio
import os
import sys
import unittest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("GOOGLE_REFRESH_TOKEN", "test")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from google_health_mcp.tools import (
    TOOL_HANDLERS,
    _build_filter,
    _check_point_id,
    _check_segment,
    _num,
    _pagination_hint,
    _simplify,
)
from google_health_mcp.types import DATA_TYPES, categories, find_type


class TestRegistry(unittest.TestCase):
    def test_has_39_types(self):
        self.assertEqual(len(DATA_TYPES), 39)

    def test_ids_unique_and_kebab(self):
        ids = [t.id for t in DATA_TYPES]
        self.assertEqual(len(ids), len(set(ids)))
        for i in ids:
            self.assertRegex(i, r"^[a-z0-9-]+$")

    def test_filter_name_matches_id(self):
        for t in DATA_TYPES:
            self.assertEqual(t.filter_name, t.id.replace("-", "_"))

    def test_find_type(self):
        self.assertEqual(find_type("steps").id, "steps")
        self.assertIsNone(find_type("nope"))

    def test_page_caps(self):
        self.assertEqual(find_type("sleep").page_cap, 25)
        self.assertEqual(find_type("exercise").page_cap, 25)
        self.assertEqual(find_type("steps").page_cap, 10000)

    def test_rollup_only_not_listable(self):
        for tid in ("floors", "total-calories", "calories-in-heart-rate-zone"):
            t = find_type(tid)
            self.assertFalse(t.listable)
            self.assertTrue(t.rollup)

    def test_categories_no_dupes(self):
        cats = categories()
        self.assertTrue(cats)
        self.assertEqual(len(cats), len(set(cats)))

    def test_35_handlers(self):
        self.assertEqual(len(TOOL_HANDLERS), 35)


class TestPathSafety(unittest.TestCase):
    def test_segment_ok(self):
        for s in ("steps", "heart-rate", "abc_123", "ABC"):
            self.assertIsNone(_check_segment(s, "data_type"))

    def test_segment_rejects_escapes(self):
        for s in ("", "../profile", "a%2Fb", "a/b", "a b", "a?b", ".", ".."):
            self.assertIsNotNone(_check_segment(s, "data_type"))
            self.assertIn("error", _check_segment(s, "data_type"))

    def test_point_id(self):
        self.assertIsNone(_check_point_id("abc-123"))
        self.assertIsNone(_check_point_id("users/me/dataTypes/steps/dataPoints/abc"))
        self.assertIsNone(_check_point_id("users/123/dataTypes/sleep/dataPoints/x"))
        self.assertIsNotNone(_check_point_id("a/b"))
        self.assertIsNotNone(_check_point_id("users/me/dataTypes/steps"))

    def test_handlers_reject_injection(self):
        async def run():
            r = await TOOL_HANDLERS["list_data_points"](None, {"data_type": "../profile"})
            self.assertIn("error", r)
            r = await TOOL_HANDLERS["get_paired_device"](None, {"device_id": "a%2Fb"})
            self.assertIn("error", r)
            r = await TOOL_HANDLERS["batch_delete_data_points"](
                None, {"data_type": "steps", "names": ["users/me/x"]}
            )
            self.assertIn("error", r)

        asyncio.run(run())


class TestHelpers(unittest.TestCase):
    def test_build_filter(self):
        since = "2026-01-01T00:00:00Z"
        self.assertEqual(_build_filter("sleep", since), f'sleep.interval.end_time >= "{since}"')
        self.assertEqual(
            _build_filter("exercise", since),
            'exercise.interval.civil_start_time >= "2026-01-01"',
        )
        self.assertEqual(
            _build_filter("daily-vo2-max", since),
            'daily_vo2_max.date >= "2026-01-01"',
        )
        self.assertEqual(
            _build_filter("heart-rate", since),
            f'heart_rate.sample_time.physical_time >= "{since}"',
        )
        self.assertEqual(
            _build_filter("electrocardiogram", since),
            f'electrocardiogram.interval.start_time >= "{since}"',
        )
        self.assertEqual(
            _build_filter("steps", since), f'steps.interval.start_time >= "{since}"'
        )

    def test_build_filter_until(self):
        since = "2026-01-01T00:00:00Z"
        until = "2026-01-08T00:00:00Z"
        self.assertEqual(
            _build_filter("sleep", since, until),
            f'sleep.interval.end_time >= "{since}" AND sleep.interval.end_time < "{until}"',
        )
        self.assertEqual(
            _build_filter("heart-rate", since, until),
            f'heart_rate.sample_time.physical_time >= "{since}" AND heart_rate.sample_time.physical_time < "{until}"',
        )
        # ECG supports >= only: no upper bound is added.
        self.assertEqual(
            _build_filter("electrocardiogram", since, until),
            f'electrocardiogram.interval.start_time >= "{since}"',
        )

    def test_num(self):
        self.assertEqual(_num(42), 42.0)
        self.assertEqual(_num("3.5"), 3.5)
        self.assertEqual(_num("abc"), 0.0)
        self.assertEqual(_num(None), 0.0)

    def test_simplify(self):
        v = {
            "dataPoints": [
                {"name": "x", "dataSource": {}, "createTime": "t", "updateTime": "u", "empty": {}, "keep": 1}
            ]
        }
        _simplify(v)
        self.assertEqual(v["dataPoints"][0], {"name": "x", "keep": 1})

    def test_pagination_hint(self):
        v = {"nextPageToken": "tok"}
        _pagination_hint(v)
        self.assertIn("nextPageToken", v["_hint"])
        w = {}
        _pagination_hint(w)
        self.assertNotIn("_hint", w)


if __name__ == "__main__":
    unittest.main()
