"""Keep capture provenance faithful as upstream redaction metadata changes."""

import unittest

from editorial import render_capture_provenance
from rebuild_archive import display_snapshot_date


class CaptureProvenanceTests(unittest.TestCase):
    def test_manual_date_capture_and_current_redaction_list_are_visible(self):
        rendered = render_capture_provenance({
            "version": "2026-09-26", "captureSource": {"kind": "user-provided trace"},
            "redactions": ["captured assistant content", "transport identifiers"],
        })
        self.assertIn("手工导入 · 日期为捕获标签", rendered)
        self.assertIn("captured assistant content；transport identifiers", rendered)
        self.assertNotIn("私有记忆", rendered)

    def test_other_sources_and_package_versions_are_not_mislabeled(self):
        rendered = render_capture_provenance({
            "version": "1.2.3", "captureSource": {"kind": "automated capture"},
        })
        self.assertIn("捕获来源：automated capture", rendered)
        self.assertNotIn("手工导入", rendered)
        self.assertNotIn("日期为捕获标签", rendered)
        manual = render_capture_provenance({
            "version": "1.2.3", "captureSource": {"kind": "user-provided trace"},
        })
        self.assertIn("手工导入", manual)
        self.assertNotIn("日期为捕获标签", manual)

    def test_provenance_is_escaped_and_absent_metadata_makes_no_claim(self):
        rendered = render_capture_provenance({
            "captureSource": {"kind": "<capture>"}, "redactions": ["<private> & user"],
        })
        self.assertIn("&lt;capture&gt;", rendered)
        self.assertIn("&lt;private&gt; &amp; user", rendered)
        self.assertNotIn("<private>", rendered)
        self.assertEqual(render_capture_provenance({}), "")

    def test_manual_capture_date_does_not_use_package_publication_date(self):
        agent = {"publishedAt": "2026-09-20T10:00:00Z", "capturedAt": "2026-09-26T12:00:00Z"}
        self.assertEqual(display_snapshot_date(agent), "发布 2026-09-20")
        agent["captureSource"] = {"kind": "automated capture"}
        self.assertEqual(display_snapshot_date(agent), "发布 2026-09-20")
        agent["captureSource"] = {"kind": "user-provided trace"}
        self.assertEqual(display_snapshot_date(agent), "捕获 2026-09-26")


if __name__ == "__main__":
    unittest.main()
