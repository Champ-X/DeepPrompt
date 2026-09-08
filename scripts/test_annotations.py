#!/usr/bin/env python3
"""Regression checks for reviewed source identity and exact highlight placement."""

from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import annotations
from audit_annotation_coverage import classify_agent
from rebuild_archive import Highlight, render_prompt
from sync_phistory import select_default


class AnnotationRegressionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        root_patch = patch.object(annotations, "ROOT", self.root)
        root_patch.start()
        self.addCleanup(root_patch.stop)
        self.path = self.root / "annotations.json"

    def fixture(self, source: str, anchor: str, occurrence=1) -> tuple[dict, dict]:
        (self.root / "sample.md").write_text(source, encoding="utf-8")
        digest = hashlib.sha256(source.encode()).hexdigest()
        manifest = {
            "source": {"commit": "a" * 40},
            "agents": [{"id": "sample", "promptPath": "sample.md", "sha256": digest}],
        }
        positions = [index for index in range(len(source)) if source.startswith(anchor, index)]
        start = positions[occurrence - 1]
        record = {
            "id": "sample-1", "agent": "sample", "category": "eng", "layer": "rule",
            "key": False, "anchor": anchor, "title": "证据", "body": "<b>解读</b> &lt;user_query&gt;",
            "occurrence": occurrence, "expectedOccurrences": len(positions),
            "startLine": source[:start].count("\n") + 1,
            "endLine": source[:start + len(anchor) - 1].count("\n") + 1,
        }
        payload = {
            "schemaVersion": 1, "sourceCommit": "a" * 40,
            "sourceHashes": {"sample": digest}, "expectedCount": 1, "annotations": [record],
        }
        return manifest, payload

    def load(self, manifest, payload):
        self.path.write_text(json.dumps(payload), encoding="utf-8")
        return annotations.load_annotations(manifest, self.path)

    def render(self, source, records):
        return render_prompt(source, "sample", [
            Highlight(r["id"], r["category"], r["anchor"], r["key"], r["start"])
            for r in records
        ])

    def test_second_identical_paragraph_is_selected(self):
        source = "Repeat\n\nRepeat\n"
        manifest, payload = self.fixture(source, "Repeat", 2)
        records = self.load(manifest, payload)
        rendered = self.render(source, records)
        self.assertEqual(rendered.splitlines()[0], '        <p class="src reveal">Repeat</p>')
        self.assertIn('data-note="sample-1">Repeat</span>', rendered.splitlines()[1])
        report = classify_agent(source, records, 0)
        self.assertEqual(report["mappedAnnotationCount"], 1)
        self.assertEqual(report["lineDispositions"]["annotated"], 1)

    def test_same_line_repeat_does_not_attach_to_heading_or_first_item(self):
        source = "# Repeat\n\n- Repeat then Repeat\n"
        manifest, payload = self.fixture(source, "Repeat", 3)
        rendered = self.render(source, self.load(manifest, payload))
        self.assertIn('<h1 class="mdh h1 reveal">Repeat</h1>', rendered)
        self.assertIn('<li>Repeat then <span class="hl" data-cat="eng" data-note="sample-1">Repeat</span></li>', rendered)

    def test_multiline_code_anchor_is_escaped_and_maps_every_line(self):
        source = "Before\n\n```text\nalpha <user_query>\nbeta\n```\n"
        manifest, payload = self.fixture(source, "alpha <user_query>\nbeta")
        records = self.load(manifest, payload)
        rendered = self.render(source, records)
        self.assertIn('alpha &lt;user_query&gt;\nbeta</span>', rendered)
        self.assertNotIn('<user_query>', rendered)
        self.assertEqual(classify_agent(source, records, 0)["lineDispositions"]["annotated"], 2)

    def test_overlapping_occurrences_are_counted(self):
        source = "ababa\n"
        manifest, payload = self.fixture(source, "aba", 2)
        rendered = self.render(source, self.load(manifest, payload))
        self.assertIn('<p class="src reveal">ab<span', rendered)

    def test_stale_review_metadata_is_rejected(self):
        manifest, original = self.fixture("Repeat\n", "Repeat")
        mutations = [
            ("sourceCommit", "b" * 40, "source commit"),
            ("sourceHashes", {"sample": "wrong"}, "hashes are stale"),
            ("expectedCount", 2, "count drift"),
            ("schemaVersion", 99, "schema"),
        ]
        for field, value, message in mutations:
            with self.subTest(field=field):
                payload = copy.deepcopy(original)
                payload[field] = value
                with self.assertRaisesRegex(ValueError, message):
                    self.load(manifest, payload)

    def test_source_byte_drift_is_rejected(self):
        manifest, payload = self.fixture("Repeat\n", "Repeat")
        (self.root / "sample.md").write_text("Repeat\nExtra\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Prompt hash drift"):
            self.load(manifest, payload)

    def test_unreviewed_occurrence_lines_and_agent_are_rejected(self):
        manifest, original = self.fixture("Repeat\nRepeat\n", "Repeat", 2)
        mutations = [
            ("expectedOccurrences", 1, "occurrence count drift"),
            ("occurrence", 3, "Invalid anchor occurrence"),
            ("occurrence", True, "Invalid occurrence"),
            ("startLine", 1, "unreviewed source position"),
            ("endLine", 3, "unreviewed source position"),
            ("agent", "other", "unknown annotation agent"),
            ("id", "other-1", "another agent"),
        ]
        for field, value, message in mutations:
            with self.subTest(field=field):
                payload = copy.deepcopy(original)
                payload["annotations"][0][field] = value
                with self.assertRaisesRegex(ValueError, message):
                    self.load(manifest, payload)

    def test_duplicate_ids_and_overlapping_notes_fail(self):
        manifest, payload = self.fixture("Repeat\n", "Repeat")
        payload["annotations"].append(copy.deepcopy(payload["annotations"][0]))
        payload["expectedCount"] = 2
        with self.assertRaisesRegex(ValueError, "Duplicate id"):
            self.load(manifest, payload)
        payload["annotations"][1]["id"] = "sample-2"
        with self.assertRaisesRegex(ValueError, "Overlapping anchors"):
            self.load(manifest, payload)

    def test_literal_prompt_tags_and_broken_markup_cannot_disappear_in_html(self):
        manifest, payload = self.fixture("Repeat\n", "Repeat")
        for body in ["<user_query>data</user_query>", "<b>unclosed", "<b><code>x</b></code>",
                     '<b onclick="alert(1)">x</b>', '<p>nested paragraph</p>', '<!-- hidden -->']:
            with self.subTest(body=body):
                payload["annotations"][0]["body"] = body
                with self.assertRaises(ValueError):
                    self.load(manifest, payload)

    def test_philosophy_requires_an_explicit_inference_label(self):
        manifest, payload = self.fixture("Repeat\n", "Repeat")
        payload["annotations"][0]["layer"] = "philosophy"
        with self.assertRaisesRegex(ValueError, "Unlabeled philosophy"):
            self.load(manifest, payload)

    def test_anchor_across_unrenderable_blocks_fails_instead_of_moving(self):
        source = "Repeat\n\nAnother paragraph\n"
        manifest, payload = self.fixture(source, "Repeat\n\nAnother")
        with self.assertRaisesRegex(ValueError, "Annotation anchors missing"):
            self.render(source, self.load(manifest, payload))

    def test_sync_never_substitutes_a_model_variant_for_default(self):
        default = {"variant_id": "default", "prompt": "default.md"}
        model = {"variant_id": "model", "prompt": "model.md"}
        self.assertEqual(select_default([model, default]), default)
        for captures in [[model], [default, default], [default, model, model]]:
            with self.subTest(captures=captures), self.assertRaisesRegex(ValueError, "explicit default"):
                select_default(captures)


if __name__ == "__main__":
    unittest.main()
