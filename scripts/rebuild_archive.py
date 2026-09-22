#!/usr/bin/env python3
"""Rebuild the shell and lazy Agent fragments from pinned prompt snapshots.

Editorial annotations and their reviewed source positions live in
``data/annotations.json``. Agent fragments are generated output, including
quotes and source links; an upstream change requires a new source review.
"""

from __future__ import annotations

import argparse
import html
import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from annotations import load_annotations
from editorial import render_editorial


ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "index.html"
AGENT_DIR = ROOT / "data" / "agents"
MANIFEST_PATH = ROOT / "data" / "manifest.json"
VALID_CATEGORIES = {"goal", "eng", "persona", "safety", "tool"}


@dataclass(frozen=True)
class Highlight:
    note_id: str
    category: str
    text: str
    key: bool
    start: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify that rebuilding would not change the shell or Agent fragments.",
    )
    return parser.parse_args()


def annotate(text: str, candidates: list[Highlight], used: set[str], source_offset: int) -> str:
    ranges: list[tuple[int, int, Highlight]] = []
    for item in candidates:
        if item.note_id in used:
            continue
        start = item.start - source_offset
        if start < 0 or text[start : start + len(item.text)] != item.text:
            continue
        ranges.append((start, start + len(item.text), item))

    ranges.sort(key=lambda row: (row[0], -(row[1] - row[0])))
    for previous, current in zip(ranges, ranges[1:]):
        if previous[1] > current[0]:
            raise ValueError(
                f"Overlapping anchors: {previous[2].note_id}, {current[2].note_id}"
            )

    output: list[str] = []
    cursor = 0
    for start, end, item in ranges:
        output.append(html.escape(text[cursor:start], quote=False))
        classes = "hl kw" if item.key else "hl"
        output.append(
            f'<span class="{classes}" data-cat="{item.category}" '
            f'data-note="{item.note_id}">'
            f"{html.escape(text[start:end], quote=False)}</span>"
        )
        used.add(item.note_id)
        cursor = end
    output.append(html.escape(text[cursor:], quote=False))
    return "".join(output)


def render_prompt(markdown: str, agent_id: str, highlights: list[Highlight]) -> str:
    lines = markdown.splitlines()
    offsets = []
    cursor = 0
    for raw_line in markdown.splitlines(keepends=True):
        offsets.append(cursor)
        cursor += len(raw_line)
    result: list[str] = []
    used: set[str] = set()
    index = 0

    while index < len(lines):
        line = lines[index]
        if not line.strip():
            index += 1
            continue

        fence = re.match(r"^\s*```", line)
        if fence:
            code: list[str] = []
            index += 1
            code_offset = offsets[index] if index < len(offsets) else len(markdown)
            while index < len(lines) and not re.match(r"^\s*```", lines[index]):
                code.append(lines[index])
                index += 1
            if index >= len(lines):
                raise ValueError(f"Unclosed code fence in {agent_id}")
            index += 1
            rendered = annotate("\n".join(code), highlights, used, code_offset)
            if len(code) > 18:
                result.append(
                    "        <details class=\"rawblob reveal\"><summary>"
                    f"展开原始代码 / schema · verbatim（{len(code)} 行，已折叠）"
                    f"</summary><pre class=\"code reveal\"><code>{rendered}"
                    "</code></pre></details>"
                )
            else:
                result.append(
                    f'        <pre class="code reveal"><code>{rendered}</code></pre>'
                )
            continue

        heading = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading:
            level = len(heading.group(1))
            rendered = annotate(heading.group(2), highlights, used, offsets[index] + heading.start(2))
            result.append(
                f'        <h{level} class="mdh h{level} reveal">'
                f"{rendered}</h{level}>"
            )
            index += 1
            continue

        marker = r"(?:[-*]|\d+[.)])" if agent_id == "omp" else r"(?:[-*+]|\d+[.)])"
        list_match = re.match(rf"^\s*{marker}\s+(.+)$", line)
        if list_match:
            items: list[str] = []
            while index < len(lines):
                match = re.match(rf"^\s*{marker}\s+(.+)$", lines[index])
                if not match:
                    break
                items.append(annotate(match.group(1), highlights, used, offsets[index] + match.start(1)))
                index += 1
            result.append('        <ul class="src reveal">')
            result.extend(f"        <li>{item}</li>" for item in items)
            result.append("        </ul>")
            continue

        result.append(
            f'        <p class="src reveal">{annotate(line, highlights, used, offsets[index])}</p>'
        )
        index += 1

    missing = [item.note_id for item in highlights if item.note_id not in used]
    if missing:
        raise ValueError(
            f"Annotation anchors missing from updated {agent_id} prompt: {missing}"
        )
    return "\n".join(result)


def replace_agent_prose(source: str, agent_id: str, rendered: str) -> str:
    pattern = re.compile(
        rf'(<div class="prose-col" id="prose-{re.escape(agent_id)}">\n)'
        r'.*?'
        rf'(\n\s*</div>\n\s*</div>\n\s*<div class="notepool" id="pool-{re.escape(agent_id)}")',
        flags=re.DOTALL,
    )
    updated, count = pattern.subn(
        lambda match: match.group(1) + rendered + match.group(2),
        source,
        count=1,
    )
    if count != 1:
        raise ValueError(f"Could not locate prose column for {agent_id}")
    return updated


def clear_note_pool(source: str, agent_id: str) -> str:
    """Retire notes whose source surface no longer exists in the latest snapshot."""
    pattern = re.compile(
        rf'(<div class="notepool" id="pool-{re.escape(agent_id)}" hidden>).*?'
        r'(\n    </div>\n  </section>)',
        flags=re.DOTALL,
    )
    updated, count = pattern.subn(r"\1\2", source, count=1)
    if count != 1:
        raise ValueError(f"Could not locate note pool for {agent_id}")
    return updated


def update_fragment(
    source: str,
    pattern: re.Pattern[str],
    transform,
    label: str,
) -> str:
    match = pattern.search(source)
    if not match:
        raise ValueError(f"Could not locate {label}")
    fragment = transform(match.group(0))
    return source[: match.start()] + fragment + source[match.end() :]


def display_version(version: str) -> str:
    return version if version.startswith("v") or re.fullmatch(r"\d{4}-\d{2}-\d{2}", version) else f"v{version}"


def update_metadata(
    shell: str,
    fragments: dict[str, str],
    manifest: dict,
    note_counts: dict[str, int],
    category_counts: dict[str, int],
) -> tuple[str, dict[str, str]]:
    source = shell
    fragments = dict(fragments)
    total_bytes = sum(agent["bytes"] for agent in manifest["agents"])
    total_notes = sum(note_counts.values())
    agent_count = len(manifest["agents"])
    source = re.sub(r'(\d+)( / archive nodes)', rf'{agent_count}\g<2>', source)
    source = re.sub(r'(<button class="acard"[^>]*?)(?: data-agent-count="\d+")?>',
                    lambda match: match[1] + f' data-agent-count="{agent_count}">', source)
    source = re.sub(
        r'(name="description" content=")\d+( 款)',
        rf"\g<1>{agent_count}\g<2>",
        source,
        count=1,
    )
    source = re.sub(
        r'(<span class="brand-copy"><span class="brand-title">Deep Prompt</span><small><b>)\d+',
        rf"\g<1>{agent_count}",
        source,
        count=1,
    )
    source = re.sub(
        r'(收录 phistory\.cc 归档的全部 )\d+( 款)',
        rf"\g<1>{agent_count}\g<2>",
        source,
        count=1,
    )
    source = re.sub(
        r'(<b id="s-agents">)\d+',
        rf"\g<1>{agent_count}",
        source,
        count=1,
    )
    source = re.sub(
        r'(把 )\d+( 份提示词拆进同一坐标系)',
        rf"\g<1>{agent_count}\g<2>",
        source,
        count=1,
    )
    source = re.sub(
        r'(<b id="s-ann">)\d+',
        rf"\g<1>{total_notes}",
        source,
        count=1,
    )
    source = re.sub(
        r'(<b id="s-kb">)[^<]+',
        rf"\g<1>{total_bytes / 1024:.1f}",
        source,
        count=1,
    )
    for category, count in category_counts.items():
        source = re.sub(
            rf'(<span id="c-{re.escape(category)}">)\d+',
            rf"\g<1>{count}",
            source,
            count=1,
        )
    source = re.sub(
        r"Phistory commit [0-9a-f]{12}",
        f"Phistory commit {manifest['source']['commit'][:12]}",
        source,
        count=1,
    )
    updated_at = datetime.fromisoformat(
        manifest["source"]["upstreamUpdatedAt"].replace("Z", "+00:00")
    )
    source = re.sub(
        r"更新于 <b>[^<]+ UTC</b>",
        f"更新于 <b>{updated_at:%Y-%m-%d %H:%M} UTC</b>",
        source,
        count=1,
    )
    source = re.sub(
        r"<b>\d+</b> 个历史快照索引",
        f"<b>{manifest['coverage']['totalHistoricalSnapshots']}</b> 个历史快照索引",
        source,
        count=1,
    )

    for agent in manifest["agents"]:
        agent_id = agent["id"]
        version = display_version(agent["version"])
        count = note_counts[agent_id]

        nav_pattern = re.compile(
            rf'<button class="navbtn(?: active)?" data-target="{re.escape(agent_id)}">.*?</button>',
            flags=re.DOTALL,
        )
        source = update_fragment(
            source,
            nav_pattern,
            lambda fragment, version=version, count=count: re.sub(
                r'(<span class="nb-sub">.*? · )v?[^<]+(</span>)',
                rf"\g<1>{version}\g<2>",
                re.sub(
                    r'(<span class="nb-badge">)\d+',
                    rf"\g<1>{count}",
                    fragment,
                    count=1,
                ),
                count=1,
            ),
            f"navigation item for {agent_id}",
        )

        card_pattern = re.compile(
            rf'<button class="acard" data-target="{re.escape(agent_id)}".*?</button>',
            flags=re.DOTALL,
        )
        source = update_fragment(
            source,
            card_pattern,
            lambda fragment, version=version, count=count, agent=agent: re.sub(
                r'(<div class="ac-stats"><span>)\d+ 批注</span><span>[^<]+</span><span>\d+ 快照',
                rf"\g<1>{count} 批注</span><span>{agent['bytes'] / 1024:.1f} KB</span>"
                rf"<span>{agent['snapshotCount']} 快照",
                re.sub(
                    r'(<span class="ac-ver">)v?[^<]+',
                    rf"\g<1>{version}",
                    fragment,
                    count=1,
                ),
                count=1,
            ),
            f"gallery card for {agent_id}",
        )

        def transform_section(
            fragment: str,
            *,
            version: str = version,
            count: int = count,
            agent: dict = agent,
        ) -> str:
            fragment = re.sub(
                r'(SYSTEM PROMPT · VERBATIM · )\d+ 批注',
                rf"\g<1>{count} 批注",
                fragment,
                count=1,
            )
            fragment = re.sub(
                r'(<span class="mh-chip">)v?[^<]+(</span>)',
                rf"\g<1>{version}\g<2>",
                fragment,
                count=1,
            )
            fragment = re.sub(
                r'<span class="mh-chip">(?:发布|捕获) [^<]+',
                '<span class="mh-chip">' + ('捕获 ' if agent.get('captureSource') else '发布 ') + agent['publishedAt'][:10],
                fragment,
                count=1,
            )
            fragment = re.sub(
                r'(<span class="mh-chip">)\d+ 个历史快照',
                rf"\g<1>{agent['snapshotCount']} 个历史快照",
                fragment,
                count=1,
            )
            return re.sub(
                r'(<span class="mh-chip">)[\d,]+ 字节',
                rf"\g<1>{agent['bytes']:,} 字节",
                fragment,
                count=1,
            )

        fragment = fragments.get(agent_id)
        if fragment is None:
            raise ValueError(f"Missing Agent fragment for {agent_id}")
        fragments[agent_id] = transform_section(fragment)

    return source, fragments


def sync_annotations(
    fragments: dict[str, str], records: list[dict], manifest: dict
) -> dict[str, str]:
    labels = {
        "goal": "目标机器",
        "eng": "工程纪律",
        "persona": "人格",
        "safety": "安全边界",
        "tool": "工具·多智能体",
    }
    source_urls = {agent["id"]: agent["sourceUrl"] for agent in manifest["agents"]}
    updated = dict(fragments)
    by_agent: dict[str, list[dict]] = {}
    for record in records:
        by_agent.setdefault(record["agent"], []).append(record)

    for agent_id, items in by_agent.items():
        articles: list[str] = []
        for record in items:
            key = bool(record.get("key"))
            classes = "note kw" if key else "note"
            tag = labels[record["category"]] + (" · 哲学层" if record["layer"] == "philosophy" else "") + (" ★" if key else "")
            articles.append(
                f'      <article class="{classes}" data-note="{html.escape(record["id"])}" '
                f'data-cat="{record["category"]}"><span class="tag">{tag}</span>'
                f'<h3>{html.escape(record["title"])}</h3>'
                f'<div class="q">{html.escape(record["anchor"])}</div>'
                f'<p>{record["body"]} <a class="source-ref" '
                f'href="{source_urls[agent_id]}#L{record["startLine"]}-L{record["endLine"]}" '
                f'target="_blank" rel="noopener noreferrer">原文 L{record["startLine"]}</a></p></article>'
            )
        pattern = re.compile(
            rf'(<div class="notepool" id="pool-{re.escape(agent_id)}" hidden>)(.*?)'
            r'(\n    </div>\n  </section>)',
            flags=re.DOTALL,
        )
        updated[agent_id], count = pattern.subn(
            lambda match, articles=articles: (
                match.group(1)
                + match.group(2).rstrip()
                + "\n"
                + "\n".join(articles)
                + match.group(3)
            ),
            updated[agent_id],
            count=1,
        )
        if count != 1:
            raise ValueError(f"Could not locate note pool for {agent_id}")
    return updated


def main() -> None:
    args = parse_args()
    original_shell = INDEX_PATH.read_text(encoding="utf-8")
    original_fragments = {
        path.stem: path.read_text(encoding="utf-8")
        for path in sorted(AGENT_DIR.glob("*.html"))
    }
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    expected_agents = {agent["id"] for agent in manifest["agents"]}
    extra_fragments = set(original_fragments) - expected_agents
    if extra_fragments:
        raise ValueError(f"Unexpected Agent fragments: {sorted(extra_fragments)}")
    records = load_annotations(manifest)
    highlights = {agent_id: [] for agent_id in expected_agents}
    for record in records:
        highlights[record["agent"]].append(Highlight(
            record["id"], record["category"], record["anchor"],
            bool(record.get("key")), record["start"],
        ))
    missing_agents = expected_agents - set(original_fragments)
    if missing_agents:
        raise ValueError(f"New agents need a reviewed presentation and fragment: {sorted(missing_agents)}")
    shell, fragments = original_shell, original_fragments
    fragments = {agent_id: clear_note_pool(fragment, agent_id)
                 for agent_id, fragment in fragments.items()}
    for agent in manifest["agents"]:
        agent_id = agent["id"]
        prompt_path = ROOT / agent["promptPath"]
        rendered = render_prompt(
            prompt_path.read_text(encoding="utf-8"),
            agent_id,
            highlights[agent_id],
        )
        fragments[agent_id] = replace_agent_prose(
            fragments[agent_id], agent_id, rendered
        )

    fragments = sync_annotations(fragments, records, manifest)
    note_counts = {
        agent_id: len(items) for agent_id, items in highlights.items()
    }
    category_counts = {
        category: sum(
            item.category == category
            for items in highlights.values()
            for item in items
        )
        for category in VALID_CATEGORIES
    }
    shell, fragments = update_metadata(
        shell, fragments, manifest, note_counts, category_counts
    )
    shell, fragments = render_editorial(shell, fragments, manifest, records)

    if args.check:
        stale = []
        if shell != original_shell:
            stale.append("index.html")
        stale.extend(
            f"data/agents/{agent_id}.html"
            for agent_id in sorted(expected_agents)
            if fragments[agent_id] != original_fragments.get(agent_id)
        )
        if stale:
            raise SystemExit(
                "Archive is stale; run scripts/rebuild_archive.py: " + ", ".join(stale)
            )
        print("PASS: shell and Agent fragments match the pinned prompt snapshots.")
        return

    AGENT_DIR.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(shell, encoding="utf-8")
    for agent_id, fragment in fragments.items():
        (AGENT_DIR / f"{agent_id}.html").write_text(fragment, encoding="utf-8")
    print(
        f"Rebuilt {len(manifest['agents'])} prompt columns with "
        f"{sum(note_counts.values())} preserved annotation anchors."
    )


if __name__ == "__main__":
    main()
