"""Keep unsupported or incomplete upstream imports from partially replacing evidence."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sync_phistory
from rebuild_archive import display_version
from verify_archive import ArchiveParser


class SyncRegressionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "site"
        self.source = Path(self.temp.name) / "source"
        (self.source / "captures").mkdir(parents=True)
        (self.root / "data/prompts").mkdir(parents=True)
        (self.root / "data/prompts/codex.md").write_text("reviewed old prompt")
        captures = []
        agents = []
        for agent in ["codex", "claude-tag"]:
            (self.source / f"{agent}.md").write_text("# System Prompt\nNew source\n")
            meta = {"target": "manually imported trace", "source": {"kind": "user-provided trace"},
                    "redactions": ["private Claude session links"]}
            if agent == "codex":
                meta = {"target": "codex", "package": "@openai/codex"}
            (self.source / f"{agent}.json").write_text(json.dumps(meta))
            captures.append({"agent_id": agent, "version": "2026-09-22", "variant_id": "default",
                             "prompt": f"{agent}.md", "meta": f"{agent}.json", "trace": "trace.jsonl",
                             "trace_redacted": agent == "claude-tag", "published_at": "2026-09-22",
                             "captured_at": "2026-09-22"})
            agents.append({"agent_id": agent, "agent": agent, "latest_version": "2026-09-22",
                           "versions": 1, "snapshots": 1})
        (self.source / "trace.jsonl").write_text("{}\n")
        (self.source / "captures/index.json").write_text(json.dumps({
            "agents": agents, "captures": captures, "updated_at": "2026-09-22T00:00:00Z"}))

    def run_sync(self):
        with patch.object(sync_phistory, "ROOT", self.root), \
                patch.object(sync_phistory, "git_commit", return_value="a" * 40), \
                patch("sys.argv", ["sync_phistory.py", "--source", str(self.source)]):
            sync_phistory.main()

    def site_files(self):
        return {str(path.relative_to(self.root)): path.read_bytes()
                for path in self.root.rglob("*") if path.is_file()}

    def test_manual_import_without_package_preserves_provenance(self):
        self.run_sync()
        manifest = json.loads((self.root / "data/manifest.json").read_text())
        tag = manifest["agents"][1]
        self.assertIsNone(tag["package"])
        self.assertEqual(tag["captureSource"]["kind"], "user-provided trace")
        self.assertEqual(tag["redactions"], ["private Claude session links"])
        self.assertTrue(tag["availableVariants"][0]["traceRedacted"])
        self.assertEqual((self.root / tag["promptPath"]).read_bytes(),
                         (self.source / "claude-tag.md").read_bytes())
        self.assertEqual(display_version(tag["version"]), "2026-09-22")
        self.assertEqual(display_version("2.1.278"), "v2.1.278")
        parser = ArchiveParser()
        parser.feed('<section class="agentview" data-agent="claude-tag">'
                    '<span class="mh-chip">2026-09-22</span></section>')
        self.assertEqual(parser.stated_meta["claude-tag"]["version"], "2026-09-22")

    def test_missing_later_capture_does_not_overwrite_earlier_prompt(self):
        (self.source / "claude-tag.md").unlink()
        with self.assertRaises(FileNotFoundError):
            self.run_sync()
        self.assertEqual((self.root / "data/prompts/codex.md").read_text(), "reviewed old prompt")

    def test_corrupt_later_metadata_does_not_overwrite_earlier_prompt(self):
        for content in ["invalid json", "[]", '{"target": 4}']:
            with self.subTest(content=content):
                (self.source / "claude-tag.json").write_text(content)
                with self.assertRaises(ValueError):
                    self.run_sync()
                self.assertEqual((self.root / "data/prompts/codex.md").read_text(), "reviewed old prompt")

    def test_missing_nondefault_variant_also_blocks_all_writes(self):
        path = self.source / "captures/index.json"
        index = json.loads(path.read_text())
        index["captures"].append(dict(index["captures"][0], variant_id="model", prompt="missing.md"))
        path.write_text(json.dumps(index))
        with self.assertRaises(FileNotFoundError):
            self.run_sync()
        self.assertEqual((self.root / "data/prompts/codex.md").read_text(), "reviewed old prompt")

    def test_invalid_later_index_fields_preserve_all_managed_files(self):
        self.run_sync()
        before = self.site_files()
        path = self.source / "captures/index.json"
        original = json.loads(path.read_text())
        cases = [
            ("capture", "published_at", None),
            ("capture", "captured_at", "not-a-date"),
            ("capture", "variant_dimensions", []),
            ("capture", "trace_redacted", "false"),
            ("agent", "agent", None),
            ("agent", "snapshots", "2"),
            ("agent", "versions", False),
            ("index", "updated_at", "not-a-date"),
        ]
        (self.source / "codex.md").write_text("changed before failing later capture")
        for target, field, value in cases:
            with self.subTest(target=target, field=field):
                index = json.loads(json.dumps(original))
                item = {"capture": index["captures"][-1], "agent": index["agents"][-1],
                        "index": index}[target]
                if value is None:
                    del item[field]
                else:
                    item[field] = value
                path.write_text(json.dumps(index))
                with self.assertRaises(ValueError):
                    self.run_sync()
                self.assertEqual(self.site_files(), before)

    def test_invalid_codex_jsonl_preserves_all_managed_files(self):
        self.run_sync()
        before = self.site_files()
        (self.source / "codex.md").write_text("changed source")
        for payload in [b'{"ok": true}\nnot json\n', b"\xff", b"\n \n"]:
            with self.subTest(payload=payload):
                (self.source / "trace.jsonl").write_bytes(payload)
                with self.assertRaises(ValueError):
                    self.run_sync()
                self.assertEqual(self.site_files(), before)

    def test_unreadable_later_icon_preserves_all_managed_files(self):
        self.run_sync()
        before = self.site_files()
        (self.source / "codex.md").write_text("changed source")
        (self.source / "docs/agent-icons/claude-tag.svg").mkdir(parents=True)
        with self.assertRaises(IsADirectoryError):
            self.run_sync()
        self.assertEqual(self.site_files(), before)

    def test_success_removes_only_previously_indexed_obsolete_variants(self):
        path = self.source / "captures/index.json"
        index = json.loads(path.read_text())
        index["captures"].append(dict(index["captures"][0], variant_id="old-model"))
        path.write_text(json.dumps(index))
        self.run_sync()
        retired = self.root / "data/variants/codex/old-model.md"
        self.assertTrue(retired.is_file())
        unknown = self.root / "data/variants/codex/unindexed.md"
        unknown.write_text("preserve for explicit review")
        index["captures"].pop()
        path.write_text(json.dumps(index))
        self.run_sync()
        self.assertFalse(retired.exists())
        self.assertEqual(unknown.read_text(), "preserve for explicit review")
        self.assertTrue((self.root / "data/variants/codex/default.md").is_file())

    def test_failed_sync_does_not_remove_old_variants(self):
        path = self.source / "captures/index.json"
        index = json.loads(path.read_text())
        index["captures"].append(dict(index["captures"][0], variant_id="old-model"))
        path.write_text(json.dumps(index))
        self.run_sync()
        before = self.site_files()
        index["captures"].pop()
        del index["captures"][-1]["published_at"]
        path.write_text(json.dumps(index))
        with self.assertRaises(ValueError):
            self.run_sync()
        self.assertEqual(self.site_files(), before)

    def test_unsafe_previous_manifest_path_cannot_be_deleted(self):
        self.run_sync()
        path = self.root / "data/manifest.json"
        manifest = json.loads(path.read_text())
        manifest["agents"][0]["availableVariants"][0]["localPromptPath"] = "data/prompts/codex.md"
        path.write_text(json.dumps(manifest))
        before = self.site_files()
        with self.assertRaisesRegex(ValueError, "Invalid managed variant path"):
            self.run_sync()
        self.assertEqual(self.site_files(), before)


if __name__ == "__main__":
    unittest.main()
