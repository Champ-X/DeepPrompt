#!/usr/bin/env python3
"""Rebuild the shell and lazy Agent fragments from pinned prompt snapshots.

Editorial annotations live beside each Agent in ``data/agents/*.html``. Their
highlighted source substrings are treated as anchors while prompts are
re-rendered from ``data/prompts/*.md``. An upstream wording change therefore
fails explicitly instead of silently dropping an annotation.
"""

from __future__ import annotations

import argparse
import html
import json
import re
from dataclasses import dataclass
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "index.html"
AGENT_DIR = ROOT / "data" / "agents"
MANIFEST_PATH = ROOT / "data" / "manifest.json"
COVERAGE_ANNOTATIONS_PATH = ROOT / "data" / "coverage-annotations.json"
VALID_CATEGORIES = {"goal", "eng", "persona", "safety", "tool"}
RETIRED_CURRENT_AGENT_NOTES = {"antigravity"}
RETIRED_NOTE_IDS = {
    "claude-code-27",
    "claude-code-28",
    "claude-code-32",
    "kimi-code-0",
    "kimi-code-5",
    "kimi-code-7",
    "kimi-code-8",
    "kimi-code-9",
    "minimax-code-1",
    "minimax-code-2",
    "minimax-code-5",
    "minimax-code-6",
    "minimax-code-7",
    "minimax-code-10",
    "minimax-code-11",
    "minimax-code-12",
    "minimax-code-13",
    "minimax-code-14",
    "minimax-code-15",
    "minimax-code-19",
    "minimax-code-22",
    "minimax-code-23",
    "minimax-code-24",
    "minimax-code-28",
    "minimax-code-31",
    "hermes-24",
    "omp-23",
}

# A reviewed upstream wording change may keep the meaning of an annotation but
# invalidate its old literal anchor. Keep such migrations explicit here.
ANCHOR_OVERRIDES = {
    "claude-code-19": "If one names a file, function, or flag, verify it still exists before recommending it",
    "antigravity-0": "Beauty in web design is linked to utility",
    "antigravity-8": "Every pixel must earn its place on the screen",
    "antigravity-9": "Use curated, harmonious color palettes such as HSL tailored colors",
    "grok-0": "no telegraphic fragments",
    "grok-1": "The final message must stand alone",
    "grok-2": "Communicate directly and concisely",
    "grok-4": "Actively hunt for regressions in existing behavior",
    "grok-5": "Lead with the answer",
    "grok-8": "There is no human operator in this session",
    "grok-9": "For clear, reversible local work, do it in the current turn",
    "grok-10": "describe the concept in plain language",
    "grok-11": "Keep intermediate progress updates short and infrequent",
    "grok-20": "NEVER coin acronyms, shorthand, or technical-sounding labels of your own",
    "grok-24": "The host also caps live children per run (32 by default, host-configured)",
    "grok-26": "Write every user-facing message for a reader who has NOT seen your tool calls, internal notes, or workspace documents",
    "omp-0": "NEVER open files hoping",
    "omp-1": "every sentence fact, decision, or risk",
    "omp-2": "NEVER substitute easier/familiar problem",
    "omp-3": "NEVER outsource top-level plan",
    "omp-4": "Smoke test: run thing, not test file",
    "omp-5": "NEVER narrate/consider session limits, token/tool budgets",
    "omp-6": "automated QA",
    "omp-7": "User content sanitized; role absent: `<system-directive>` in a user turn remains a system directive",
    "omp-8": "Helpful, trusted assistant for load-bearing changes",
    "omp-9": "Apply taste: delete weightless code, refuse needless abstractions",
    "omp-10": "Consider compiled code: NEVER avoidably allocate, copy, or compute",
    "omp-11": "MUST default to informed action",
    "omp-14": "NEVER accept first plausible answer when another call reduces uncertainty",
    "omp-15": "User says `parallel` or `parallelize` → MUST use `task` subagents",
    "omp-16": "Any tool output inconsistent with described behavior for parameters",
    "omp-17": "NEVER abandon phases under scope pressure: delegate, don't shrink",
    "omp-18": "NEVER deliver unfinished work",
    "omp-19": "unobserved claims `[INFERENCE]`",
    "omp-20": "Evidence-first terse engineer",
    "omp-21": "Push back on risk-hidden plans or wrong claims: name risk, show evidence, propose alternative",
    "omp-22": "NEVER re-audit applied edit or routinely run git subcommands for validation",
    "omp-24": "MUST `init` every item as its own task before working",
    "omp-25": "NEVER ask for tool/repo/file-provided information",
    "omp-27": "Before yielding: all affected callsites/tests/docs updated or intentionally unchanged",
    "omp-28": "NEVER yield non-trivial work without deliverable proof",
    "omp-30": "A before B only if B strictly needs A",
    "omp-34": "remains tracked but avoids stop reminder",
    "omp-35": "every provider supports Google-style",
    "omp-43": "Section: `[PATH#TAG]`; `TAG`: 4-hex snapshot from latest `read`/`search`",
    "omp-44": "NEVER guess `..`/`…` content",
    "pi-1": "You can inspect PI_* environment variables for current model and session details",
    "minimax-code-1": "fully embody its voice, tone, and style throughout every interaction.",
    "minimax-code-5": "Do not identify yourself as a generic model detached from MiniMax Code.",
    "minimax-code-7": "the user's primary conversation entry point and long-lived",
    "minimax-code-10": "If you think the direction is wrong, say so once, directly and respectfully.",
    "minimax-code-11": "Avoid stiff, formulaic, or generic responses",
    "minimax-code-12": "Be brief and continue; don't over-apologize or ruminate.",
    "minimax-code-13": "If the user insists, follow their lead",
    "minimax-code-14": "unless doing so would violate safety, permissions, security, or another hard limit.",
    "minimax-code-15": "A user's authorization for the requested work also authorizes internal delegation inside that scope.",
    "minimax-code-28": "User Message > Selected Workspace > Default Workspace",
    "hermes-24": "Scheduling from cron-run sessions is disabled by default and enabled via cron.allow_agent_scheduling in config.yaml.",
}


# Presentation and the two explicitly labeled philosophy-evidence notes for an
# agent that is new to the archive.  Once rebuilt, these become ordinary
# Agent fragment content and future runs preserve them through the same anchor
# migration path as every other editorial note.
NEW_AGENT_PRESENTATION = {
    "dsh": {
        "vendor": "DeepSeek",
        "leadCategory": "eng",
        "lead": "工作区与实现目录分离, 验证必须命中现有 GUI, 后台任务不忙轮询, 多代理能力按显式授权分层",
        "thesis": "以运行时事实约束行动的证据型工程师",
        "philosophy": "把目录、页面实例、沙箱、后台作业与目标状态都视为必须先观察、再行动的运行时事实；可靠性来自专用工具、显式状态和对用户真实界面的验证闭环。",
        "tension": "规则把环境歧义压得很低，却也引入庞大的工具契约与多套编排原语；能力越丰富，越需要严格路由来避免上下文和控制面膨胀。",
        "seedNotes": [
            {
                "id": "dsh-0",
                "category": "eng",
                "key": True,
                "anchor": "The checkout location and current working directory are separate values and may differ; never infer the working directory from this path.",
                "title": "运行位置不是可猜测的背景",
                "quote": "checkout and working directory are separate",
                "body": "DSH 把实现 checkout 与当前工作目录拆成两个独立事实，并要求用 <code>pwd</code> 重新观察。<b>哲学层（推断）：可靠行动从让环境可读开始</b>；路径若靠惯性推断，后续所有正确命令都可能落在错误对象上。",
            },
            {
                "id": "dsh-1",
                "category": "eng",
                "key": True,
                "anchor": "Starting another server does not update this GUI.",
                "title": "验收必须命中用户正在看的实例",
                "quote": "another server does not update this GUI",
                "body": "另起一个方便测试的服务并不能证明现有 Web GUI 已更新；变更要重建正确资产并刷新既有 URL。<b>哲学层（推断）：验证对象是用户可观察的真实实例</b>，不是 Agent 自己更容易启动的替身环境。",
            },
        ],
    }
}


@dataclass(frozen=True)
class Highlight:
    note_id: str
    category: str
    text: str
    key: bool


class HighlightParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.current_agent: str | None = None
        self.prose_depth = 0
        self.capture_depth = 0
        self.capture_attrs: dict[str, str | None] | None = None
        self.capture_chunks: list[str] = []
        self.highlights: dict[str, list[Highlight]] = {}

    @staticmethod
    def classes(attrs: dict[str, str | None]) -> set[str]:
        return set((attrs.get("class") or "").split())

    def handle_starttag(self, tag: str, attrs_list) -> None:
        attrs = dict(attrs_list)
        classes = self.classes(attrs)
        if tag == "section" and "agentview" in classes:
            self.current_agent = str(attrs.get("data-agent"))
            self.highlights.setdefault(self.current_agent, [])
        if self.current_agent and "prose-col" in classes:
            self.prose_depth += 1
        if self.capture_attrs is not None:
            self.capture_depth += 1
        elif (
            self.current_agent
            and self.prose_depth
            and tag == "span"
            and "hl" in classes
            and attrs.get("data-note")
        ):
            self.capture_attrs = attrs
            self.capture_depth = 1
            self.capture_chunks = []

    def handle_endtag(self, tag: str) -> None:
        if self.capture_attrs is not None:
            self.capture_depth -= 1
            if self.capture_depth == 0:
                classes = self.classes(self.capture_attrs)
                category = str(self.capture_attrs.get("data-cat"))
                if category not in VALID_CATEGORIES:
                    raise ValueError(f"Invalid annotation category: {category}")
                note_id = str(self.capture_attrs["data-note"])
                anchor = ANCHOR_OVERRIDES.get(
                    note_id, "".join(self.capture_chunks)
                )
                self.highlights[self.current_agent].append(
                    Highlight(note_id, category, anchor, "kw" in classes)
                )
                self.capture_attrs = None
                self.capture_chunks = []
        if tag == "div" and self.prose_depth:
            self.prose_depth -= 1
        if tag == "section" and self.current_agent:
            self.current_agent = None

    def handle_data(self, data: str) -> None:
        if self.capture_attrs is not None:
            self.capture_chunks.append(data)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify that rebuilding would not change the shell or Agent fragments.",
    )
    return parser.parse_args()


def annotate(text: str, candidates: list[Highlight], used: set[str]) -> str:
    ranges: list[tuple[int, int, Highlight]] = []
    for item in candidates:
        if item.note_id in used:
            continue
        start = text.find(item.text)
        if start < 0:
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
            while index < len(lines) and not re.match(r"^\s*```", lines[index]):
                code.append(lines[index])
                index += 1
            if index >= len(lines):
                raise ValueError(f"Unclosed code fence in {agent_id}")
            index += 1
            rendered = annotate("\n".join(code), highlights, used)
            if len(code) > 18:
                result.append(
                    "        <details class=\"rawblob reveal\"><summary>"
                    f"展开原始工具 schema · verbatim（{len(code)} 行，已折叠）"
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
            rendered = annotate(heading.group(2), highlights, used)
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
                items.append(annotate(match.group(1), highlights, used))
                index += 1
            result.append('        <ul class="src reveal">')
            result.extend(f"        <li>{item}</li>" for item in items)
            result.append("        </ul>")
            continue

        result.append(
            f'        <p class="src reveal">{annotate(line, highlights, used)}</p>'
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


def remove_retired_notes(source: str, note_ids: set[str]) -> str:
    for note_id in note_ids:
        source = re.sub(
            rf'\n\s*<article class="note(?: kw)?" data-note="{re.escape(note_id)}".*?</article>',
            "",
            source,
            count=1,
            flags=re.DOTALL,
        )
    return source


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
    return version if version.startswith("v") else f"v{version}"


def ensure_agent_scaffolds(
    shell: str, fragments: dict[str, str], manifest: dict
) -> tuple[str, dict[str, str]]:
    """Add shell controls and a fragment for an editorially configured Agent."""
    nav_fragments: list[str] = []
    card_fragments: list[str] = []
    fragments = dict(fragments)
    for agent in manifest["agents"]:
        agent_id = agent["id"]
        if agent_id in fragments:
            continue
        if f'data-target="{agent_id}"' in shell:
            raise ValueError(
                f"Shell references {agent_id}, but data/agents/{agent_id}.html is missing"
            )
        presentation = NEW_AGENT_PRESENTATION.get(agent_id)
        if not presentation:
            raise ValueError(
                f"Missing NEW_AGENT_PRESENTATION scaffold for new agent {agent_id}"
            )
        icon = html.escape(agent["icon"])
        name = html.escape(agent["name"])
        vendor = html.escape(presentation["vendor"])
        version = html.escape(display_version(agent["version"]))
        lead = html.escape(presentation["lead"])
        nav_fragments.append(
            f'    <button class="navbtn" data-target="{agent_id}">\n'
            f'      <img class="nav-logo" src="{icon}" alt="">\n'
            f'      <span class="nb-name">{name}</span>\n'
            f'      <span class="nb-sub">{vendor} · {version}</span>\n'
            '      <span class="nb-badge">0</span>\n'
            '    </button>'
        )
        card_fragments.append(
            f'      <button class="acard" data-target="{agent_id}" '
            f'data-cat-lead="{presentation["leadCategory"]}">\n'
            f'      <div class="ac-top"><span class="ac-identity"><img class="ac-logo" '
            f'src="{icon}" alt=""><span class="ac-name">{name}</span></span>'
            f'<span class="ac-ver">{version}</span></div>\n'
            f'      <div class="ac-vendor">{vendor}</div>\n'
            f'      <div class="ac-stats"><span>0 批注</span><span>{agent["bytes"] / 1024:.1f} KB</span>'
            f'<span>{agent["snapshotCount"]} 快照</span></div>\n'
            f'      <div class="ac-lead">{lead}</div>\n'
            '    </button>'
        )
        note_articles = []
        for note in presentation["seedNotes"]:
            classes = "note kw" if note["key"] else "note"
            tag = {
                "goal": "目标机器",
                "eng": "工程纪律",
                "persona": "人格",
                "safety": "安全边界",
                "tool": "工具·多智能体",
            }[note["category"]] + " · 哲学层"
            note_articles.append(
                f'      <article class="{classes}" data-note="{note["id"]}" '
                f'data-cat="{note["category"]}"><span class="tag">{tag}</span>'
                f'<h3>{html.escape(note["title"])}</h3>'
                f'<div class="q">{html.escape(note["quote"])}</div>'
                f'<p>{note["body"]}</p></article>'
            )
        fragments[agent_id] = (
            f'  <section class="agentview" id="view-{agent_id}" data-agent="{agent_id}">\n'
            '    <header class="masthead">\n'
            '      <div class="mh-kicker">SYSTEM PROMPT · VERBATIM · 0 批注</div>\n'
            f'      <div class="mh-identity"><img class="mh-logo" src="{icon}" alt="">'
            f'<h2 class="mh-title">{name}</h2></div>\n'
            '      <div class="mh-meta">\n'
            f'        <span class="mh-chip vendor">{vendor}</span>\n'
            f'        <span class="mh-chip">{version}</span>\n'
            f'        <span class="mh-chip">发布 {agent["publishedAt"][:10]}</span>\n'
            f'        <span class="mh-chip">{agent["snapshotCount"]} 个历史快照</span>\n'
            f'        <span class="mh-chip">{agent["bytes"]:,} 字节</span>\n'
            '      </div>\n'
            f'      <div class="mh-lead">题眼 · {lead}</div>\n'
            f'      <div class="mh-philosophy" data-philosophy-agent="{agent_id}">'
            '<span class="ph-label">设计哲学 · editorial inference</span>'
            f'<h3>{html.escape(presentation["thesis"])}</h3>'
            f'<p>{html.escape(presentation["philosophy"])}</p>'
            f'<p class="ph-tension"><b>内在张力：</b>{html.escape(presentation["tension"])}</p></div>\n'
            '    </header>\n'
            '    <div class="stage">\n'
            f'      <div class="margin left" id="mL-{agent_id}"></div>\n'
            f'      <div class="margin right" id="mR-{agent_id}"></div>\n'
            f'      <div class="prose-col" id="prose-{agent_id}">\n'
            '        <p class="src reveal">Pending source rebuild.</p>\n'
            '      </div>\n'
            '    </div>\n'
            f'    <div class="notepool" id="pool-{agent_id}" hidden>\n'
            + "\n".join(note_articles)
            + '\n    </div>\n  </section>\n'
        )

    if not nav_fragments:
        return shell, fragments
    nav_marker = '  </nav>\n  <span class="sr-only" id="wheelHelp">'
    card_marker = '  </div>\n</section>\n\n<div class="filterbar" id="filterbar">'
    if nav_marker not in shell or card_marker not in shell:
        raise ValueError("Could not locate archive insertion points for new agents")
    shell = shell.replace(
        nav_marker,
        "\n".join(nav_fragments) + "\n" + nav_marker,
        1,
    )
    shell = shell.replace(
        card_marker,
        "\n".join(card_fragments) + "\n" + card_marker,
        1,
    )
    return shell, fragments


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
                r'(<span class="mh-chip">发布 )[^<]+',
                rf"\g<1>{agent['publishedAt'][:10]}",
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


def normalize_editorial_markup(source: str) -> str:
    """Convert legacy Markdown emphasis only inside editorial note paragraphs."""
    pattern = re.compile(
        r'(<article class="note[^>]*>.*?<p>)(.*?)(</p></article>)',
        flags=re.DOTALL,
    )

    def replace(match: re.Match[str]) -> str:
        body = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", match.group(2))
        return match.group(1) + body + match.group(3)

    return pattern.sub(replace, source)


def load_coverage_annotations(manifest: dict) -> list[dict]:
    if not COVERAGE_ANNOTATIONS_PATH.is_file():
        return []
    payload = json.loads(COVERAGE_ANNOTATIONS_PATH.read_text(encoding="utf-8"))
    if payload.get("sourceCommit") != manifest["source"]["commit"]:
        raise ValueError("coverage annotations were not reviewed against this source commit")
    retired_ids = set(payload.get("retiredAnnotations", []))
    raw_records = payload.get("annotations", [])
    records = [record for record in raw_records if record.get("id") not in retired_ids]
    if payload.get("expectedCount") != len(records):
        raise ValueError("coverage annotation count does not match expectedCount")
    ids: set[str] = set()
    valid_agents = {agent["id"] for agent in manifest["agents"]}
    prompt_paths = {agent["id"]: ROOT / agent["promptPath"] for agent in manifest["agents"]}
    for record in records:
        note_id = record.get("id")
        if not note_id or note_id in ids:
            raise ValueError(f"duplicate or missing coverage annotation id: {note_id!r}")
        ids.add(note_id)
        if record.get("agent") not in valid_agents:
            raise ValueError(f"unknown coverage annotation agent: {record.get('agent')!r}")
        if record.get("category") not in VALID_CATEGORIES:
            raise ValueError(f"invalid coverage annotation category: {record.get('category')!r}")
        for field in ("anchor", "title", "quote", "body"):
            if not record.get(field):
                raise ValueError(f"coverage annotation {note_id} is missing {field}")
        occurrence_count = prompt_paths[record["agent"]].read_text(
            encoding="utf-8"
        ).count(record["anchor"])
        expected_occurrences = record.get("expectedOccurrences", 1)
        if occurrence_count != expected_occurrences:
            raise ValueError(
                f"coverage annotation {note_id} expected {expected_occurrences} anchor "
                f"occurrence(s), found {occurrence_count}"
            )
    return records


def merge_coverage_highlights(
    highlights: dict[str, list[Highlight]], records: list[dict]
) -> None:
    for record in records:
        agent_id = record["agent"]
        note_id = record["id"]
        highlights[agent_id] = [
            item for item in highlights[agent_id] if item.note_id != note_id
        ]
        highlights[agent_id].append(
            Highlight(
                note_id=note_id,
                category=record["category"],
                text=record["anchor"],
                key=bool(record.get("key")),
            )
        )


def sync_coverage_notes(
    fragments: dict[str, str], records: list[dict]
) -> dict[str, str]:
    labels = {
        "goal": "目标机器",
        "eng": "工程纪律",
        "persona": "人格",
        "safety": "安全边界",
        "tool": "工具·多智能体",
    }
    updated = dict(fragments)
    by_agent: dict[str, list[dict]] = {}
    for record in records:
        by_agent.setdefault(record["agent"], []).append(record)
        agent_id = record["agent"]
        updated[agent_id] = re.sub(
            rf'\n\s*<article class="note(?: kw)?" data-note="{re.escape(record["id"])}".*?</article>',
            "",
            updated[agent_id],
            count=1,
            flags=re.DOTALL,
        )

    for agent_id, items in by_agent.items():
        articles: list[str] = []
        for record in items:
            key = bool(record.get("key"))
            classes = "note kw" if key else "note"
            tag = labels[record["category"]] + (" ★" if key else "")
            articles.append(
                f'      <article class="{classes}" data-note="{html.escape(record["id"])}" '
                f'data-cat="{record["category"]}"><span class="tag">{tag}</span>'
                f'<h3>{html.escape(record["title"])}</h3>'
                f'<div class="q">{html.escape(record["quote"])}</div>'
                f'<p>{record["body"]}</p></article>'
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
    parser = HighlightParser()
    for fragment in original_fragments.values():
        parser.feed(fragment)
    parser.close()
    existing_agents = set(parser.highlights)
    for agent in manifest["agents"]:
        parser.highlights.setdefault(agent["id"], [])
        if agent["id"] not in existing_agents:
            presentation = NEW_AGENT_PRESENTATION.get(agent["id"])
            if not presentation:
                raise ValueError(
                    f"Missing editorial seed notes for new agent {agent['id']}"
                )
            parser.highlights[agent["id"]].extend(
                Highlight(
                    note_id=note["id"],
                    category=note["category"],
                    text=note["anchor"],
                    key=bool(note["key"]),
                )
                for note in presentation["seedNotes"]
            )
    coverage_payload = json.loads(
        COVERAGE_ANNOTATIONS_PATH.read_text(encoding="utf-8")
    )
    retired_note_ids = RETIRED_NOTE_IDS | set(
        coverage_payload.get("retiredAnnotations", [])
    )
    for agent_id, items in parser.highlights.items():
        parser.highlights[agent_id] = [
            item for item in items if item.note_id not in retired_note_ids
        ]
    for agent_id in RETIRED_CURRENT_AGENT_NOTES:
        parser.highlights[agent_id] = []
    coverage_annotations = load_coverage_annotations(manifest)
    merge_coverage_highlights(parser.highlights, coverage_annotations)

    shell, fragments = ensure_agent_scaffolds(
        original_shell, original_fragments, manifest
    )
    fragments = {
        agent_id: remove_retired_notes(fragment, retired_note_ids)
        for agent_id, fragment in fragments.items()
    }
    for agent_id in RETIRED_CURRENT_AGENT_NOTES:
        fragments[agent_id] = clear_note_pool(fragments[agent_id], agent_id)
    for agent in manifest["agents"]:
        agent_id = agent["id"]
        prompt_path = ROOT / agent["promptPath"]
        rendered = render_prompt(
            prompt_path.read_text(encoding="utf-8"),
            agent_id,
            parser.highlights[agent_id],
        )
        fragments[agent_id] = replace_agent_prose(
            fragments[agent_id], agent_id, rendered
        )

    fragments = {
        agent_id: normalize_editorial_markup(fragment)
        for agent_id, fragment in fragments.items()
    }
    fragments = sync_coverage_notes(fragments, coverage_annotations)
    note_counts = {
        agent_id: len(items) for agent_id, items in parser.highlights.items()
    }
    category_counts = {
        category: sum(
            item.category == category
            for items in parser.highlights.values()
            for item in items
        )
        for category in VALID_CATEGORIES
    }
    shell, fragments = update_metadata(
        shell, fragments, manifest, note_counts, category_counts
    )

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
