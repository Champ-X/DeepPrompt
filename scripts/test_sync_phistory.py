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


if __name__ == "__main__":
    unittest.main()
