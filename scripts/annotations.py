"""Load reviewed annotations and resolve their exact positions in a snapshot."""

from __future__ import annotations

import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ANNOTATIONS_PATH = ROOT / "data" / "annotations.json"
VALID_CATEGORIES = {"goal", "eng", "persona", "safety", "tool"}
VALID_LAYERS = {"rule", "philosophy", "extension"}


class InlineBodyParser(HTMLParser):
    """Keep note bodies inside their paragraph and preserve literal prompt tags."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag not in {"b", "strong", "em", "i", "code"} or attrs:
            raise ValueError(f"Unsupported annotation markup: {tag}; escape literal prompt tags")
        self.stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        if not self.stack or self.stack.pop() != tag:
            raise ValueError(f"Unbalanced annotation markup: {tag}")

    def handle_comment(self, data: str) -> None:
        raise ValueError("Escape literal HTML comments in annotation bodies")

    def handle_decl(self, decl: str) -> None:
        raise ValueError("Escape literal HTML declarations in annotation bodies")


def load_annotations(manifest: dict, path: Path = ANNOTATIONS_PATH) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != 1:
        raise ValueError("Unsupported annotation registry schema")
    if payload.get("sourceCommit") != manifest["source"]["commit"]:
        raise ValueError("Annotations have not been reviewed against this source commit")
    agents = {agent["id"]: agent for agent in manifest["agents"]}
    sources = {
        agent_id: (ROOT / agent["promptPath"]).read_text(encoding="utf-8")
        for agent_id, agent in agents.items()
    }
    expected_sources = {agent_id: agent["sha256"] for agent_id, agent in agents.items()}
    if payload.get("sourceHashes") != expected_sources:
        raise ValueError("Annotation review source hashes are stale")
    for agent_id, agent in agents.items():
        actual = hashlib.sha256((ROOT / agent["promptPath"]).read_bytes()).hexdigest()
        if actual != agent["sha256"]:
            raise ValueError(f"Prompt hash drift: {agent_id}")
    records = payload.get("annotations", [])
    if len(records) != payload.get("expectedCount"):
        raise ValueError("Annotation count drift")
    seen: set[str] = set()
    ranges: dict[str, list[tuple[int, int, str]]] = {key: [] for key in agents}
    resolved = []
    for record in records:
        note_id = record.get("id")
        agent_id = record.get("agent")
        if not isinstance(note_id, str) or not re.fullmatch(r"[a-z0-9-]+", note_id):
            raise ValueError(f"Invalid annotation id: {note_id}")
        if note_id in seen or agent_id not in agents:
            raise ValueError(f"Duplicate id or unknown annotation agent: {note_id}")
        seen.add(note_id)
        if not note_id.startswith(agent_id + "-"):
            raise ValueError(f"Annotation id belongs to another agent: {note_id}")
        if record.get("category") not in VALID_CATEGORIES or record.get("layer") not in VALID_LAYERS:
            raise ValueError(f"Invalid annotation category/layer: {note_id}")
        for field in ("anchor", "title", "body"):
            if not isinstance(record.get(field), str) or not record[field].strip():
                raise ValueError(f"Missing {field}: {note_id}")
        if type(record.get("key")) is not bool:
            raise ValueError(f"Annotation key must be a boolean: {note_id}")
        for field in ("occurrence", "expectedOccurrences", "startLine", "endLine"):
            if type(record.get(field)) is not int or record[field] < 1:
                raise ValueError(f"Invalid {field}: {note_id}")
        body_parser = InlineBodyParser()
        try:
            body_parser.feed(record["body"])
            body_parser.close()
            if body_parser.stack:
                raise ValueError("Unclosed annotation markup")
        except ValueError as error:
            raise ValueError(f"{note_id}: {error}") from error
        if record["layer"] == "philosophy" and "哲学层（推断）" not in record["body"]:
            raise ValueError(f"Unlabeled philosophy inference: {note_id}")
        source = sources[agent_id]
        anchor = record["anchor"]
        starts = []
        cursor = 0
        while (start := source.find(anchor, cursor)) >= 0:
            starts.append(start)
            cursor = start + 1
        occurrence = record.get("occurrence")
        if len(starts) != record.get("expectedOccurrences"):
            raise ValueError(f"Anchor occurrence count drift: {note_id}")
        if type(occurrence) is not int or not 1 <= occurrence <= len(starts):
            raise ValueError(f"Invalid anchor occurrence: {note_id}")
        start = starts[occurrence - 1]
        end = start + len(anchor)
        start_line = source.count("\n", 0, start) + 1
        end_line = source.count("\n", 0, end - 1) + 1
        if record.get("startLine") != start_line or record.get("endLine") != end_line:
            raise ValueError(f"Anchor moved to an unreviewed source position: {note_id}")
        ranges[agent_id].append((start, end, note_id))
        resolved.append(record | {"start": start, "end": end})
    for agent_id, items in ranges.items():
        items.sort()
        for previous, current in zip(items, items[1:]):
            if previous[1] > current[0]:
                raise ValueError(f"Overlapping anchors in {agent_id}: {previous[2]}, {current[2]}")
    return resolved
