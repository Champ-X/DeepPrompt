"""Render source-linked profiles and comparisons from a reviewed registry."""

from __future__ import annotations

import html
import json
import re
from pathlib import Path

EDITORIAL_PATH = Path(__file__).resolve().parents[1] / "data" / "editorial.json"


def render_editorial(shell: str, fragments: dict[str, str], manifest: dict, records: list[dict]):
    data = json.loads(EDITORIAL_PATH.read_text(encoding="utf-8"))
    agents = {agent["id"]: agent for agent in manifest["agents"]}
    notes = {record["id"]: record for record in records}
    if data["sourceCommit"] != manifest["source"]["commit"] or set(data["agents"]) != set(agents):
        raise ValueError("Editorial summaries were not reviewed against this snapshot")
    if len(data["axes"]) != 7 or set(data["themes"]) != {"goal", "eng", "persona", "safety", "tool"}:
        raise ValueError("Editorial comparison axes/themes are incomplete")

    def evidence(item):
        if not item.get("evidenceNotes"):
            raise ValueError("An editorial summary needs explicit evidence notes")
        links = []
        for note_id in item["evidenceNotes"]:
            if note_id not in notes:
                raise ValueError(f"Summary references a retired or missing annotation: {note_id}")
            note = notes[note_id]
            agent = agents[note["agent"]]
            links.append(
                f'<a href="{agent["sourceUrl"]}#L{note["startLine"]}-L{note["endLine"]}" '
                f'target="_blank" rel="noopener noreferrer" title="{html.escape(note["title"], quote=True)}">'
                f'{html.escape(agent["name"])} L{note["startLine"]}</a>'
            )
        return '<span class="editorial-evidence">依据：' + ' · '.join(links) + '</span>'

    def replace_once(text, pattern, replacement):
        updated, count = re.subn(pattern, replacement, text, count=1, flags=re.DOTALL)
        if count != 1:
            raise ValueError(f"Missing editorial surface: {pattern}")
        return updated

    updated = dict(fragments)
    for agent_id, item in data["agents"].items():
        for note_id in item["evidenceNotes"]:
            if note_id not in notes or notes[note_id]["agent"] != agent_id or notes[note_id]["layer"] != "philosophy":
                raise ValueError(f"Invalid philosophy evidence: {agent_id}/{note_id}")
        lead = html.escape(item["lead"])
        shell = replace_once(
            shell, rf'(<button class="acard" data-target="{agent_id}".*?<div class="ac-lead">).*?(</div>)',
            lambda match: match[1] + lead + match[2],
        )
        fragment = replace_once(updated[agent_id], r'(<div class="mh-lead">).*?(</div>)',
                                lambda match: match[1] + '题眼 · ' + lead + match[2])
        profile = (
            f'<div class="mh-philosophy" data-philosophy-agent="{agent_id}">'
            '<span class="ph-label">设计哲学 · editorial inference</span>'
            f'<h3>{html.escape(item["thesis"])}</h3><p>{html.escape(item["body"])}</p>'
            f'<p class="ph-tension"><b>内在张力：</b>{html.escape(item["tension"])}</p>'
            f'{evidence(item)}</div>'
        )
        fragment = replace_once(fragment, r'<div class="mh-philosophy".*?</div>', lambda _: profile)
        agent = agents[agent_id]
        variants = [v for v in agent["availableVariants"] if v["id"] != agent["variant"]["id"]]
        source_links = (
            '<div class="mh-evidence">'
            f'<span>批注对应 {html.escape(agent["variant"]["id"])} 捕获</span> · '
            f'<a href="{agent["promptPath"]}" target="_blank" rel="noopener">完整原文</a> · '
            f'<a href="{agent["sourceUrl"]}" target="_blank" rel="noopener">固定上游快照</a>'
        )
        for variant in variants:
            source_links += (f' · <a href="{variant["localPromptPath"]}" target="_blank" rel="noopener">'
                             f'{html.escape(variant["label"])} 原文</a>')
        if agent.get("captureSource"):
            source_links += ' · <span>手工导入 · 日期为捕获标签</span>'
        if agent.get("redactions"):
            source_links += ' · <span title="' + html.escape(', '.join(agent['redactions']), quote=True) + '">上游已脱敏：身份、凭据、用户消息、私有记忆与会话链接</span>'
        source_links += '</div>'
        fragment = re.sub(r'\n\s*<div class="mh-evidence">.*?</div>', '', fragment, flags=re.DOTALL)
        fragment = replace_once(fragment, r'\n    </header>', lambda _: '\n      ' + source_links + '\n    </header>')
        updated[agent_id] = fragment

    axes = []
    for index, item in enumerate(data["axes"], 1):
        axes.append(f'<article class="axiscard"><span class="axis-no">AXIS {index:02}</span>'
                    f'<h3>{html.escape(item["title"])}</h3><p>{html.escape(item["body"])}</p>{evidence(item)}</article>')
    shell = replace_once(shell, r'(<div class="axisgrid">).*?(\n  </div>)',
                         lambda match: match[1] + '\n    ' + '\n    '.join(axes) + match[2])
    for category, item in data["themes"].items():
        shell = replace_once(
            shell, rf'(<div class="scard {category}">.*?<p>).*?(</p>)(?:<span class="editorial-evidence">.*?</span>)?(</div>)',
            lambda match, item=item: match[1] + html.escape(item["body"]) + match[2] + evidence(item) + match[3],
        )
    return shell, updated
