#!/usr/bin/env python3
"""Classify every non-blank prompt line by its annotation-review disposition."""

from __future__ import annotations

import argparse

from annotations import load_annotations
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "data" / "manifest.json"
AUDIT_PATH = ROOT / "data" / "annotation-audit.json"
OUTPUT_PATH = ROOT / "data" / "annotation-coverage.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify the committed coverage report without rewriting it.",
    )
    return parser.parse_args()


def comparable(value: str) -> str:
    value = re.sub(r"[`*_]", "", value)
    value = value.replace("&lt;", "<").replace("&gt;", ">")
    return re.sub(r"\s+", " ", value).strip()


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
    highlights: list[dict],
    coverage_count: int,
) -> dict:
    lines = source.splitlines()
    mapped = defaultdict(list)
    for record in highlights:
        for line in range(record["startLine"] - 1, record["endLine"]):
            mapped[line].append(record["id"])
    unmapped = []
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
            dispositions.append("unannotatedCode")
        elif (
            len(comparable(line)) >= 20
            and prose_normalized[comparable(line)] > 1
        ):
            dispositions.append("repeatedMaterial")
        else:
            dispositions.append("unannotatedProse")

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
        elif counts["unannotatedCode"] >= max(
            counts["unannotatedProse"], 1
        ):
            disposition = "unannotated-code"
        elif counts["repeatedMaterial"]:
            disposition = "repeated-material"
        else:
            disposition = "unannotated-prose"
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
    longest = longest_run(dispositions, "unannotatedProse")
    if longest["startLine"]:
        preview = comparable(lines[longest["startLine"] - 1])[:160]
        longest["startPreview"] = preview
    return {
        "totalLines": len(lines),
        "nonBlankLines": len(non_blank_dispositions),
        "annotationCount": len(highlights),
        "coverageExpansionAnnotations": coverage_count,
        "mappedAnnotationCount": len({note_id for ids in mapped.values() for note_id in ids}),
        "unmappedAnnotations": unmapped,
        "lineDispositions": {
            "annotated": counts["annotated"],
            "unannotatedCode": counts["unannotatedCode"],
            "repeatedMaterial": counts["repeatedMaterial"],
            "unannotatedProse": counts["unannotatedProse"],
            "structuralDelimiter": counts["structuralDelimiter"],
        },
        "longestUnannotatedProseRun": longest,
        "sections": sections,
    }


def main() -> None:
    args = parse_args()
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    audit = json.loads(AUDIT_PATH.read_text(encoding="utf-8"))
    records = load_annotations(manifest)
    active_coverage = [record for record in records if record["layer"] == "extension"]
    coverage_counts = Counter(record["agent"] for record in active_coverage)
    agents: dict[str, dict] = {}
    for agent in manifest["agents"]:
        agent_id = agent["id"]
        source = (ROOT / agent["promptPath"]).read_text(encoding="utf-8")
        agents[agent_id] = classify_agent(
            source,
            [record for record in records if record["agent"] == agent_id],
            coverage_counts[agent_id],
        )
        if agents[agent_id]["unmappedAnnotations"]:
            raise ValueError(
                f"unmapped annotations for {agent_id}: "
                f"{agents[agent_id]['unmappedAnnotations']}"
            )
    report = {
        "schemaVersion": 2,
        "reviewedAt": audit["reviewedAt"],
        "sourceCommit": manifest["source"]["commit"],
        "annotationCount": len(records),
        "methodology": {
            "unit": "every non-blank source line",
            "dispositions": {
                "annotated": "An explicitly selected source range for a reviewed annotation covers this line.",
                "unannotatedCode": "Unannotated fenced content; may be code, examples or schema. This does not assert low editorial value.",
                "repeatedMaterial": "Exact repeated text; repetition is detected mechanically, not proof that another occurrence was reviewed.",
                "unannotatedProse": "No annotation selected here. This is NOT a claim of human review or absence of useful insights.",
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
    serialized = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not OUTPUT_PATH.is_file() or OUTPUT_PATH.read_text(encoding="utf-8") != serialized:
            raise SystemExit(
                "data/annotation-coverage.json is stale; "
                "run scripts/audit_annotation_coverage.py"
            )
        print(
            f"PASS: coverage report classifies {report['totals']['nonBlankLines']} "
            f"non-blank lines across {len(agents)} agents."
        )
        return
    OUTPUT_PATH.write_text(serialized, encoding="utf-8")
    print(
        f"Classified {report['totals']['nonBlankLines']} non-blank prompt lines "
        f"across {len(agents)} agents; wrote {OUTPUT_PATH.relative_to(ROOT)}."
    )


if __name__ == "__main__":
    main()
