#!/usr/bin/env python3
"""Verify the prompt archive and its editorial annotation audit."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "index.html"
CONTROLS_CSS_PATH = ROOT / "reader-controls.css"
MANIFEST_PATH = ROOT / "data" / "manifest.json"
ANNOTATION_AUDIT_PATH = ROOT / "data" / "annotation-audit.json"
COVERAGE_ANNOTATIONS_PATH = ROOT / "data" / "coverage-annotations.json"
COVERAGE_REPORT_PATH = ROOT / "data" / "annotation-coverage.json"
VALID_CATEGORIES = {"goal", "eng", "persona", "safety", "tool"}


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def normalize(value: str) -> str:
    return re.sub(r"\s+", "", value)


def prompt_canonical(markdown: str, agent_id: str) -> str:
    result: list[str] = []
    code_open = False
    for raw_line in markdown.splitlines():
        stripped = raw_line.lstrip()
        if stripped.startswith("```"):
            code_open = not code_open
            continue
        if code_open:
            result.append(raw_line)
            continue
        if not raw_line.strip():
            continue
        if re.match(r"^#{1,6}\s+", raw_line):
            line = re.sub(r"^#{1,6}\s+", "", raw_line)
        else:
            # The OMP prompt uses literal '+' rows in edit-language examples.
            # Its archive renderer preserves '+' rows as prose while '-' rows
            # become list items, so do not strip '+' for that agent.
            marker = r"(?:[-*]|\d+[.)])" if agent_id == "omp" else r"(?:[-*+]|\d+[.)])"
            line = re.sub(rf"^\s*{marker}\s+", "", raw_line)
        result.append(line)
    return normalize("".join(result))


class ArchiveParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.current_agent: str | None = None
        self.prose_depth = 0
        self.capture_tag: str | None = None
        self.capture_depth = 0
        self.capture_classes: set[str] = set()
        self.capture_chunks: list[str] = []
        self.sources: dict[str, list[str]] = {}
        self.notes: Counter[str] = Counter()
        self.highlights: Counter[str] = Counter()
        self.ids: list[str] = []
        self.nav_targets: list[str] = []
        self.card_targets: list[str] = []
        self.logo_refs: Counter[str] = Counter()
        self.stated_meta: dict[str, dict[str, str]] = {}
        self._metadata_agent: str | None = None
        self._metadata_classes: set[str] = set()
        self._metadata_chunks: list[str] = []

    @staticmethod
    def classes(attrs: dict[str, str | None]) -> set[str]:
        return set((attrs.get("class") or "").split())

    def handle_starttag(self, tag: str, attrs_list) -> None:
        attrs = dict(attrs_list)
        classes = self.classes(attrs)
        if attrs.get("id"):
            self.ids.append(str(attrs["id"]))
        src = attrs.get("src")
        if tag == "img" and src and str(src).startswith("agent-icons/"):
            self.logo_refs[str(src)] += 1
        if tag == "section" and "agentview" in classes:
            self.current_agent = str(attrs.get("data-agent"))
            self.sources.setdefault(self.current_agent, [])
            self.stated_meta.setdefault(self.current_agent, {})
        if self.current_agent and "prose-col" in classes:
            self.prose_depth += 1
        if tag == "button" and "navbtn" in classes:
            self.nav_targets.append(str(attrs.get("data-target")))
        if tag == "button" and "acard" in classes:
            self.card_targets.append(str(attrs.get("data-target")))
        if self.current_agent and "note" in classes:
            self.notes[self.current_agent] += 1
        if self.current_agent and self.prose_depth and "hl" in classes:
            self.highlights[self.current_agent] += 1

        should_capture = (
            self.current_agent
            and self.prose_depth
            and (
                "mdh" in classes
                or (tag == "p" and "src" in classes)
                or (tag == "li" and self.capture_tag is None)
                or (tag == "pre" and "code" in classes)
            )
        )
        if should_capture and self.capture_tag is None:
            self.capture_tag = tag
            self.capture_depth = 1
            self.capture_classes = classes
            self.capture_chunks = []
        elif self.capture_tag is not None:
            self.capture_depth += 1

        if self.current_agent and classes.intersection({"mh-chip", "mh-chip vendor"}):
            self._metadata_agent = self.current_agent
            self._metadata_classes = classes
            self._metadata_chunks = []

    def handle_endtag(self, tag: str) -> None:
        if self.capture_tag is not None:
            self.capture_depth -= 1
            if self.capture_depth == 0:
                text = "".join(self.capture_chunks)
                if self.capture_tag == "li":
                    text = re.sub(r"^\s*\d+[.)]\s+", "", text)
                self.sources[self.current_agent].append(text)
                self.capture_tag = None
                self.capture_classes = set()
                self.capture_chunks = []
        if self._metadata_agent and tag == "span":
            text = "".join(self._metadata_chunks).strip()
            if re.fullmatch(r"v\S+", text):
                self.stated_meta[self._metadata_agent]["version"] = text
            elif text.endswith("字节"):
                self.stated_meta[self._metadata_agent]["bytes"] = text
            self._metadata_agent = None
            self._metadata_classes = set()
            self._metadata_chunks = []
        if tag == "div" and self.prose_depth:
            self.prose_depth -= 1
        if tag == "section" and self.current_agent:
            self.current_agent = None

    def handle_data(self, data: str) -> None:
        if self.capture_tag is not None:
            self.capture_chunks.append(data)
        if self._metadata_agent:
            self._metadata_chunks.append(data)


def main() -> None:
    if not INDEX_PATH.is_file():
        fail("index.html is missing")
    if not CONTROLS_CSS_PATH.is_file():
        fail("reader-controls.css is missing")
    if not MANIFEST_PATH.is_file():
        fail("data/manifest.json is missing")
    if not ANNOTATION_AUDIT_PATH.is_file():
        fail("data/annotation-audit.json is missing")
    if not COVERAGE_ANNOTATIONS_PATH.is_file():
        fail("data/coverage-annotations.json is missing")
    if not COVERAGE_REPORT_PATH.is_file():
        fail("data/annotation-coverage.json is missing")

    html = INDEX_PATH.read_text(encoding="utf-8")
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    audit = json.loads(ANNOTATION_AUDIT_PATH.read_text(encoding="utf-8"))
    coverage_annotations = json.loads(
        COVERAGE_ANNOTATIONS_PATH.read_text(encoding="utf-8")
    )
    coverage_report = json.loads(COVERAGE_REPORT_PATH.read_text(encoding="utf-8"))
    parser = ArchiveParser()
    parser.feed(html)
    parser.close()

    expected_ids = {agent["id"] for agent in manifest["agents"]}
    if set(parser.sources) != expected_ids:
        fail(
            f"archive agents mismatch: missing={sorted(expected_ids - set(parser.sources))}, "
            f"extra={sorted(set(parser.sources) - expected_ids)}"
        )
    if set(parser.nav_targets) != expected_ids or len(parser.nav_targets) != len(expected_ids):
        fail("top navigation does not cover each agent exactly once")
    if set(parser.card_targets) != expected_ids or len(parser.card_targets) != len(expected_ids):
        fail("gallery does not cover each agent exactly once")
    duplicate_ids = [item for item, count in Counter(parser.ids).items() if count > 1]
    if duplicate_ids:
        fail(f"duplicate HTML ids: {duplicate_ids}")

    for agent in manifest["agents"]:
        agent_id = agent["id"]
        source_path = ROOT / agent["promptPath"]
        if not source_path.is_file():
            fail(f"missing prompt evidence for {agent_id}")
        prompt = source_path.read_text(encoding="utf-8")
        payload = source_path.read_bytes()
        if len(payload) != agent["bytes"]:
            fail(f"prompt byte count drift for {agent_id}")
        if hashlib.sha256(payload).hexdigest() != agent["sha256"]:
            fail(f"prompt sha256 drift for {agent_id}")
        expected = prompt_canonical(prompt, agent_id)
        actual = normalize("".join(parser.sources[agent_id]))
        if expected != actual:
            prefix = 0
            while (
                prefix < min(len(expected), len(actual))
                and expected[prefix] == actual[prefix]
            ):
                prefix += 1
            fail(
                f"embedded prompt drift for {agent_id} at canonical char {prefix}: "
                f"source={expected[prefix:prefix+90]!r}, archive={actual[prefix:prefix+90]!r}"
            )
        if parser.notes[agent_id] != parser.highlights[agent_id]:
            fail(
                f"annotation pair mismatch for {agent_id}: "
                f"{parser.highlights[agent_id]} highlights vs {parser.notes[agent_id]} notes"
            )
        stated = parser.stated_meta[agent_id]
        expected_version = agent["version"] if agent["version"].startswith("v") else f"v{agent['version']}"
        if stated.get("version") != expected_version:
            fail(
                f"version metadata mismatch for {agent_id}: "
                f"{stated.get('version')!r} != {expected_version!r}"
            )
        expected_bytes = f"{agent['bytes']:,} 字节"
        if stated.get("bytes") != expected_bytes:
            fail(
                f"byte metadata mismatch for {agent_id}: "
                f"{stated.get('bytes')!r} != {expected_bytes!r}"
            )

    total_notes = sum(parser.notes.values())
    if total_notes != audit["expectedAnnotationCount"]:
        fail(f"unexpected total annotation count: {total_notes}")
    framework = audit.get("philosophyFramework") or {}
    profiles = framework.get("profiles") or {}
    axes = framework.get("axes") or []
    if framework.get("interpretationStatus") != "editorial-inference":
        fail("design-philosophy conclusions must be marked as editorial inference")
    if len(axes) != 7 or len(set(axes)) != 7:
        fail("design-philosophy framework must contain seven unique axes")
    if set(profiles) != expected_ids:
        fail("design-philosophy profiles must cover all 13 agents")
    philosophy_note_ids = [
        note_id
        for profile in profiles.values()
        for note_id in profile.get("evidenceNotes", [])
    ]
    if len(philosophy_note_ids) != 26 or len(set(philosophy_note_ids)) != 26:
        fail("each agent must have two unique design-philosophy evidence notes")
    coverage_records = coverage_annotations.get("annotations") or []
    coverage_note_ids = [record.get("id") for record in coverage_records]
    if coverage_annotations.get("sourceCommit") != manifest["source"]["commit"]:
        fail("coverage annotations were not reviewed against the pinned source commit")
    if coverage_annotations.get("expectedCount") != len(coverage_records):
        fail("coverage annotation expectedCount drift")
    if len(set(coverage_note_ids)) != len(coverage_note_ids) or None in coverage_note_ids:
        fail("coverage annotation ids must be present and unique")
    coverage_agents = Counter(record.get("agent") for record in coverage_records)
    if set(coverage_agents) != expected_ids or any(count == 0 for count in coverage_agents.values()):
        fail("coverage expansion must add at least one annotation for every agent")
    if any(record.get("category") not in VALID_CATEGORIES for record in coverage_records):
        fail("coverage expansion contains an invalid category")
    coverage_audit = audit.get("coverageExpansion") or {}
    if coverage_audit.get("expectedCount") != len(coverage_records):
        fail("annotation audit coverageExpansion count drift")
    if coverage_audit.get("source") != "data/coverage-annotations.json":
        fail("annotation audit coverageExpansion source drift")
    baseline_count = audit.get("baselineAnnotationCount")
    if (
        baseline_count != 381
        or total_notes
        != baseline_count + len(philosophy_note_ids) + len(coverage_note_ids)
    ):
        fail("the 381-note rule-explanation baseline was not preserved")
    philosophy_cards = re.findall(r'data-philosophy-agent="([a-z0-9-]+)"', html)
    if len(philosophy_cards) != len(expected_ids) or set(philosophy_cards) != expected_ids:
        fail("masthead design-philosophy summaries must cover all 13 agents")
    for agent_id, profile in profiles.items():
        thesis = profile.get("thesis")
        if not thesis or thesis not in html:
            fail(f"missing design-philosophy thesis for {agent_id}")
    if f'<b id="s-ann">{total_notes}</b>' not in html:
        fail("static homepage annotation count is stale")
    if audit["sourceCommit"] != manifest["source"]["commit"]:
        fail("annotation audit was not reviewed against the pinned source commit")
    if set(audit["categories"]) != VALID_CATEGORIES:
        fail("annotation audit category taxonomy drift")

    note_ids = re.findall(
        r'<article class="note(?: kw)?" data-note="([a-z0-9-]+)" '
        r'data-cat="([a-z]+)">',
        html,
    )
    highlight_ids = re.findall(
        r'<span class="hl(?: kw)?" data-cat="([a-z]+)" '
        r'data-note="([a-z0-9-]+)">',
        html,
    )
    note_id_counts = Counter(note_id for note_id, _ in note_ids)
    highlight_id_counts = Counter(note_id for _, note_id in highlight_ids)
    duplicate_note_ids = [item for item, count in note_id_counts.items() if count != 1]
    duplicate_highlight_ids = [
        item for item, count in highlight_id_counts.items() if count != 1
    ]
    if duplicate_note_ids or duplicate_highlight_ids:
        fail(
            "annotation ids must be unique: "
            f"notes={duplicate_note_ids}, highlights={duplicate_highlight_ids}"
        )
    if note_id_counts.keys() != highlight_id_counts.keys():
        fail("annotation note/highlight id sets differ")
    missing_coverage_notes = set(coverage_note_ids) - set(note_id_counts)
    if missing_coverage_notes:
        fail(f"coverage notes are missing: {sorted(missing_coverage_notes)}")
    for record in coverage_records:
        source_path = ROOT / next(
            agent["promptPath"]
            for agent in manifest["agents"]
            if agent["id"] == record["agent"]
        )
        source = source_path.read_text(encoding="utf-8")
        expected_occurrences = record.get("expectedOccurrences", 1)
        if source.count(record["anchor"]) != expected_occurrences:
            fail(f"coverage anchor drift: {record['id']}")
        if record["title"] not in html or record["body"] not in html:
            fail(f"coverage note content drift: {record['id']}")
    if any(category not in VALID_CATEGORIES for _, category in note_ids):
        fail("invalid editorial note category")
    if any(category not in VALID_CATEGORIES for category, _ in highlight_ids):
        fail("invalid prompt highlight category")
    note_categories = {note_id: category for note_id, category in note_ids}
    highlight_categories = {note_id: category for category, note_id in highlight_ids}
    static_category_counts = Counter(category for _, category in note_ids)
    for category, count in static_category_counts.items():
        if f'<span id="c-{category}">{count}</span>' not in html:
            fail(f"static category count is stale for {category}: expected {count}")
    category_drift = [
        note_id
        for note_id, category in note_categories.items()
        if highlight_categories[note_id] != category
    ]
    if category_drift:
        fail(f"note/highlight categories differ: {category_drift}")

    structured_notes = re.findall(
        r'<article class="note(?: kw)?" data-note="([a-z0-9-]+)"[^>]*>'
        r'<span class="tag">.+?</span><h3>.+?</h3><div class="q">.+?</div>'
        r'<p>(.*?)</p></article>',
        html,
        flags=re.DOTALL,
    )
    if len(structured_notes) != total_notes:
        fail("every note must contain a tag, title, quote, and interpretation")
    structured_note_bodies = dict(structured_notes)
    missing_philosophy_notes = set(philosophy_note_ids) - set(structured_note_bodies)
    if missing_philosophy_notes:
        fail(
            "design-philosophy evidence notes are missing: "
            f"{sorted(missing_philosophy_notes)}"
        )
    unlabeled_inferences = [
        note_id
        for note_id in philosophy_note_ids
        if "哲学层（推断）" not in structured_note_bodies[note_id]
    ]
    if unlabeled_inferences:
        fail(
            "design-philosophy evidence must label editorial inference: "
            f"{sorted(unlabeled_inferences)}"
        )
    legacy_markdown = [
        note_id
        for note_id, body in structured_notes
        if re.search(
            r"\*\*[^*]+\*\*",
            re.sub(r"<code>.*?</code>", "", body, flags=re.DOTALL),
        )
    ]
    if legacy_markdown:
        fail(f"legacy Markdown emphasis remains in editorial notes: {legacy_markdown}")
    if "renderNoteMarkdown" in html:
        fail("editorial note markup should not require runtime Markdown rewriting")
    expected_logo_names = {
        "antigravity.png",
        "claude-code.png",
        "codex.png",
        "grok.png",
        "hermes.png",
        "kimi-code.png",
        "kimi.png",
        "mimo.png",
        "minimax-code.svg",
        "omp.svg",
        "openclaw.png",
        "opencode.png",
        "pi.png",
    }
    actual_logo_names = {Path(path).name for path in parser.logo_refs}
    if actual_logo_names != expected_logo_names:
        fail(
            f"logo coverage mismatch: missing={sorted(expected_logo_names - actual_logo_names)}, "
            f"extra={sorted(actual_logo_names - expected_logo_names)}"
        )
    for logo_path, count in parser.logo_refs.items():
        if count != 3:
            fail(f"logo {logo_path} should appear in nav, card, and masthead; got {count}")
        if not (ROOT / logo_path).is_file():
            fail(f"logo asset is missing: {logo_path}")
    expected_commit = manifest["source"]["commit"][:12]
    if expected_commit not in html:
        fail(f"pinned Phistory commit is not displayed: {expected_commit}")
    expected_snapshot_total = str(manifest["coverage"]["totalHistoricalSnapshots"])
    if not re.search(
        rf"<b>{re.escape(expected_snapshot_total)}</b>\s*个历史快照索引",
        html,
    ):
        fail(
            "displayed historical snapshot total does not match manifest: "
            f"{expected_snapshot_total}"
        )
    if "data:image/svg+xml" not in html:
        fail("inline favicon is missing")
    if "refreshAnnotationStats()" not in html:
        fail("annotation totals are not derived from the current DOM")
    previous_deep_review_notes = {
        "claude-code-29",
        "antigravity-28",
        "grok-23",
        "kimi-code-28",
        "minimax-code-30",
        "mimo-27",
        "openclaw-28",
        "hermes-27",
        "kimi-26",
        "opencode-27",
        "omp-26",
    }
    audited_notes = (
        set(audit["addedAnnotations"])
        | set(audit["revisedAnnotations"])
        | set(coverage_note_ids)
    )
    required_notes = previous_deep_review_notes | audited_notes
    missing_required = required_notes - set(note_id_counts)
    if missing_required:
        fail(
            "deep-review note coverage mismatch: "
            f"missing={sorted(missing_required)}"
        )
    if not (ROOT / "agent-icons" / "SOURCES.md").is_file():
        fail("logo source documentation is missing")

    if coverage_report.get("sourceCommit") != manifest["source"]["commit"]:
        fail("annotation coverage report source commit drift")
    if coverage_report.get("annotationCount") != total_notes:
        fail("annotation coverage report count drift")
    report_agents = coverage_report.get("agents") or {}
    if set(report_agents) != expected_ids:
        fail("annotation coverage report must classify every agent")
    for agent_id, report in report_agents.items():
        dispositions = report.get("lineDispositions") or {}
        if sum(dispositions.values()) != report.get("nonBlankLines"):
            fail(f"annotation coverage lines are not fully classified for {agent_id}")
        if report.get("coverageExpansionAnnotations") != coverage_agents[agent_id]:
            fail(f"coverage expansion count drift for {agent_id}")

    print(
        "PASS: archive index contains 13 current prompts, "
        f"{total_notes} highlight/note pairs, 13 logos at three identity levels, "
        "accurate versions and byte metadata; "
        f"archive sha256={hashlib.sha256(INDEX_PATH.read_bytes()).hexdigest()}"
    )


if __name__ == "__main__":
    main()
