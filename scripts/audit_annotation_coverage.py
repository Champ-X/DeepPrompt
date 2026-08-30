#!/usr/bin/env python3
"""Classify every non-blank prompt line by its annotation-review disposition."""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "index.html"
MANIFEST_PATH = ROOT / "data" / "manifest.json"
AUDIT_PATH = ROOT / "data" / "annotation-audit.json"
COVERAGE_PATH = ROOT / "data" / "coverage-annotations.json"
OUTPUT_PATH = ROOT / "data" / "annotation-coverage.json"


class HighlightParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.agent: str | None = None
        self.prose_div_depth = 0
        self.note_id: str | None = None
        self.chunks: list[str] = []
        self.highlights: dict[str, list[tuple[str, str]]] = defaultdict(list)

    @staticmethod
    def classes(attrs: dict[str, str | None]) -> set[str]:
        return set((attrs.get("class") or "").split())

    def handle_starttag(self, tag: str, attrs_list) -> None:
        attrs = dict(attrs_list)
        classes = self.classes(attrs)
        if tag == "section" and "agentview" in classes:
            self.agent = str(attrs.get("data-agent"))
        if tag == "div" and "prose-col" in classes:
            self.prose_div_depth = 1
        elif tag == "div" and self.prose_div_depth:
            self.prose_div_depth += 1
        if self.agent and self.prose_div_depth and tag == "span" and "hl" in classes:
            self.note_id = str(attrs.get("data-note"))
            self.chunks = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "span" and self.note_id and self.agent:
            self.highlights[self.agent].append(
                (self.note_id, "".join(self.chunks))
            )
            self.note_id = None
            self.chunks = []
        if tag == "div" and self.prose_div_depth:
            self.prose_div_depth -= 1
        if tag == "section" and self.agent:
            self.agent = None

    def handle_data(self, data: str) -> None:
        if self.note_id:
            self.chunks.append(data)


def comparable(value: str) -> str:
    value = re.sub(r"[`*_]", "", value)
    value = value.replace("&lt;", "<").replace("&gt;", ">")
    return re.sub(r"\s+", " ", value).strip()


def map_highlights(
    lines: list[str], highlights: list[tuple[str, str]]
) -> tuple[dict[int, list[str]], list[str]]:
    mapped: dict[int, list[str]] = defaultdict(list)
    unmapped: list[str] = []
    for note_id, text in highlights:
        matches = [index for index, line in enumerate(lines) if text and text in line]
        if not matches:
            needle = comparable(text)
            matches = [
                index
                for index, line in enumerate(lines)
                if needle and needle in comparable(line)
            ]
        if not matches:
            unmapped.append(note_id)
            continue
        mapped[matches[0]].append(note_id)
    return mapped, unmapped


def longest_run(dispositions: list[str], target: str) -> dict:
    best_start = best_end = -1
    current_start = -1
    for index, disposition in enumerate(dispositions + ["__END__"]):
        if disposition == target:
            if current_start < 0:
                current_start = index
            continue
        if current_start >= 0 and index - current_start > best_end - best_start + 1:
            best_start, best_end = current_start, index - 1
        current_start = -1
    if best_start < 0:
        return {"lines": 0, "startLine": None, "endLine": None}
    return {
        "lines": best_end - best_start + 1,
        "startLine": best_start + 1,
        "endLine": best_end + 1,
    }


def classify_agent(
    source: str,
    highlights: list[tuple[str, str]],
    coverage_count: int,
) -> dict:
    lines = source.splitlines()
    mapped, unmapped = map_highlights(lines, highlights)
    prose_normalized = Counter(
        comparable(line)
        for line in lines
        if line.strip() and not line.lstrip().startswith("```")
    )
    in_fence = False
    dispositions: list[str] = []
    headings: list[tuple[int, int, str]] = []
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            dispositions.append("blank")
            continue
        heading = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading and not in_fence:
            headings.append((index, len(heading.group(1)), heading.group(2)))
        if line.lstrip().startswith("```"):
            dispositions.append("structuralDelimiter")
            in_fence = not in_fence
        elif index in mapped:
            dispositions.append("annotated")
        elif in_fence:
            dispositions.append("mechanicalSchema")
        elif (
            len(comparable(line)) >= 20
            and prose_normalized[comparable(line)] > 1
        ):
            dispositions.append("repeatedMaterial")
        else:
            dispositions.append("reviewedNoIndependentNote")

    sections: list[dict] = []
    for position, (start, level, title) in enumerate(headings):
        end = len(lines) - 1
        for candidate, candidate_level, _ in headings[position + 1 :]:
            if candidate_level <= level:
                end = candidate - 1
                break
        section_dispositions = dispositions[start : end + 1]
        section_notes = {
            note_id
            for line_index in range(start, end + 1)
            for note_id in mapped.get(line_index, [])
        }
        counts = Counter(
            item for item in section_dispositions if item != "blank"
        )
        if section_notes:
            disposition = "annotated"
        elif counts["mechanicalSchema"] >= max(
            counts["reviewedNoIndependentNote"], 1
        ):
            disposition = "mechanical-schema"
        elif counts["repeatedMaterial"]:
            disposition = "repeated-material"
        else:
            disposition = "reviewed-no-independent-note"
        sections.append(
            {
                "level": level,
                "title": title,
                "startLine": start + 1,
                "endLine": end + 1,
                "annotationCount": len(section_notes),
                "disposition": disposition,
            }
        )

    non_blank_dispositions = [item for item in dispositions if item != "blank"]
    counts = Counter(non_blank_dispositions)
    longest = longest_run(dispositions, "reviewedNoIndependentNote")
    if longest["startLine"]:
        preview = comparable(lines[longest["startLine"] - 1])[:160]
        longest["startPreview"] = preview
    return {
        "totalLines": len(lines),
        "nonBlankLines": len(non_blank_dispositions),
        "annotationCount": len(highlights),
        "coverageExpansionAnnotations": coverage_count,
        "mappedAnnotationCount": sum(len(ids) for ids in mapped.values()),
        "unmappedAnnotations": unmapped,
        "lineDispositions": {
            "annotated": counts["annotated"],
            "mechanicalSchema": counts["mechanicalSchema"],
            "repeatedMaterial": counts["repeatedMaterial"],
            "reviewedNoIndependentNote": counts["reviewedNoIndependentNote"],
            "structuralDelimiter": counts["structuralDelimiter"],
        },
        "longestReviewedNoIndependentNoteRun": longest,
        "sections": sections,
    }


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    audit = json.loads(AUDIT_PATH.read_text(encoding="utf-8"))
    coverage = json.loads(COVERAGE_PATH.read_text(encoding="utf-8"))
    parser = HighlightParser()
    parser.feed(INDEX_PATH.read_text(encoding="utf-8"))
    parser.close()
    retired_coverage_ids = set(coverage.get("retiredAnnotations", []))
    active_coverage = [
        record
        for record in coverage["annotations"]
        if record["id"] not in retired_coverage_ids
    ]
    coverage_counts = Counter(
        record["agent"] for record in active_coverage
    )
    agents: dict[str, dict] = {}
    for agent in manifest["agents"]:
        agent_id = agent["id"]
        source = (ROOT / agent["promptPath"]).read_text(encoding="utf-8")
        agents[agent_id] = classify_agent(
            source,
            parser.highlights[agent_id],
            coverage_counts[agent_id],
        )
        if agents[agent_id]["unmappedAnnotations"]:
            raise ValueError(
                f"unmapped annotations for {agent_id}: "
                f"{agents[agent_id]['unmappedAnnotations']}"
            )
    report = {
        "schemaVersion": 1,
        "reviewedAt": audit["reviewedAt"],
        "sourceCommit": manifest["source"]["commit"],
        "annotationCount": audit["expectedAnnotationCount"],
        "methodology": {
            "unit": "every non-blank source line",
            "dispositions": {
                "annotated": "At least one exact editorial anchor occurs on the line.",
                "mechanicalSchema": "Unannotated line inside a fenced schema or code block.",
                "repeatedMaterial": "Exact repeated prose already reviewed at another occurrence.",
                "reviewedNoIndependentNote": "Reviewed prose with no additional standalone insight beyond adjacent notes.",
                "structuralDelimiter": "Code-fence delimiter retained for verbatim fidelity.",
            },
            "editorialRule": "Add a note only when a sentence contributes an independently explainable rule, failure mode, trade-off, or design-philosophy inference; do not annotate braces, primitive types, or duplicated wording merely to increase density.",
        },
        "agents": agents,
        "totals": {
            "nonBlankLines": sum(item["nonBlankLines"] for item in agents.values()),
            "annotatedLines": sum(
                item["lineDispositions"]["annotated"] for item in agents.values()
            ),
            "coverageExpansionAnnotations": len(active_coverage),
        },
    }
    OUTPUT_PATH.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Classified {report['totals']['nonBlankLines']} non-blank prompt lines "
        f"across {len(agents)} agents; wrote {OUTPUT_PATH.relative_to(ROOT)}."
    )


if __name__ == "__main__":
    main()
