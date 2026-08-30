#!/usr/bin/env python3
"""Sync the latest Phistory prompt snapshots into the static site."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path("/tmp/phistory-source")
PHISTORY_REPO = "https://github.com/WEIFENG2333/phistory"

KEYWORD_GROUPS = {
    "tools": r"\btool(?:s|ing)?\b",
    "safety": r"\b(?:safety|permission|sandbox|dangerous|destructive)\b",
    "planning": r"\b(?:plan|planning|todo)\b",
    "memory": r"\b(?:memory|memories|context)\b",
    "autonomy": r"\b(?:autonomy|autonomous|persist|continue)\b",
    "git": r"\bgit\b",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help="Checked-out Phistory repository.",
    )
    return parser.parse_args()


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def git_commit(source: Path) -> str:
    return subprocess.check_output(
        ["git", "-C", str(source), "rev-parse", "HEAD"],
        text=True,
    ).strip()


def copy_icon(source: Path, agent_id: str, destination: Path) -> str | None:
    candidates = sorted((source / "docs" / "agent-icons").glob(f"{agent_id}.*"))
    if not candidates:
        return None
    icon = candidates[0]
    target = destination / icon.name
    shutil.copyfile(icon, target)
    return f"agent-icons/{icon.name}"


def main() -> None:
    args = parse_args()
    source = args.source.resolve()
    index_path = source / "captures" / "index.json"
    if not index_path.is_file():
        raise SystemExit(f"Missing Phistory manifest: {index_path}")

    upstream = json.loads(index_path.read_text(encoding="utf-8"))
    commit = git_commit(source)
    prompts_dir = ROOT / "data" / "prompts"
    variants_dir = ROOT / "data" / "variants"
    icons_dir = ROOT / "agent-icons"
    prompts_dir.mkdir(parents=True, exist_ok=True)
    variants_dir.mkdir(parents=True, exist_ok=True)
    icons_dir.mkdir(parents=True, exist_ok=True)

    captures_by_key: dict[tuple[str, str], list[dict]] = {}
    for item in upstream["captures"]:
        captures_by_key.setdefault((item["agent_id"], item["version"]), []).append(item)
    agents = []
    for position, summary in enumerate(upstream["agents"], start=1):
        agent_id = summary["agent_id"]
        version = summary["latest_version"]
        captures = captures_by_key[(agent_id, version)]
        capture = next(
            (item for item in captures if item.get("variant_id", "default") == "default"),
            captures[0],
        )
        relative_prompt = Path(capture["prompt"])
        source_prompt = source / relative_prompt
        payload = source_prompt.read_bytes()
        text = payload.decode("utf-8")
        destination = prompts_dir / f"{agent_id}.md"
        shutil.copyfile(source_prompt, destination)

        meta = json.loads((source / capture["meta"]).read_text(encoding="utf-8"))
        available_variants = []
        for item in captures:
            variant_id = item.get("variant_id", "default")
            variant_source = source / item["prompt"]
            variant_payload = variant_source.read_bytes()
            variant_text = variant_payload.decode("utf-8")
            variant_target = variants_dir / agent_id / f"{variant_id}.md"
            variant_target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(variant_source, variant_target)
            available_variants.append(
                {
                    "id": variant_id,
                    "label": item.get("variant_label", "Default"),
                    "dimensions": item.get("variant_dimensions", {}),
                    "observed": item.get("observed", {}),
                    "prompt": item["prompt"],
                    "trace": item.get("trace"),
                    "localPromptPath": str(variant_target.relative_to(ROOT)),
                    "sha256": sha256(variant_payload),
                    "bytes": len(variant_payload),
                    "characters": len(variant_text),
                }
            )
        headings = [
            {"level": len(match.group(1)), "text": match.group(2).strip()}
            for match in re.finditer(r"^(#{1,6})\s+(.+)$", text, flags=re.MULTILINE)
        ]
        keyword_counts = {
            name: len(re.findall(pattern, text, flags=re.IGNORECASE))
            for name, pattern in KEYWORD_GROUPS.items()
        }
        agents.append(
            {
                "order": position,
                "id": agent_id,
                "name": summary["agent"],
                "version": version,
                "package": meta["package"],
                "publishedAt": summary["latest_published_at"],
                "capturedAt": summary["latest_captured_at"],
                "versionCount": summary.get("versions", summary.get("captures")),
                "snapshotCount": summary.get("snapshots", summary.get("captures")),
                "variant": {
                    "id": capture.get("variant_id", "default"),
                    "label": capture.get("variant_label", "Default"),
                    "dimensions": capture.get("variant_dimensions", {}),
                    "observed": capture.get("observed", {}),
                },
                "availableVariants": available_variants,
                "promptPath": f"data/prompts/{agent_id}.md",
                "sourcePromptPath": str(relative_prompt),
                "sourceUrl": f"{PHISTORY_REPO}/blob/{commit}/{relative_prompt}",
                "phistoryUrl": "https://phistory.cc/",
                "icon": copy_icon(source, agent_id, icons_dir),
                "sha256": sha256(payload),
                "bytes": len(payload),
                "characters": len(text),
                "lines": text.count("\n"),
                "headings": headings,
                "keywordCounts": keyword_counts,
                "promptRole": headings[0]["text"] if headings else "Prompt",
                "captureTarget": meta["target"],
                "normalization": "Phistory readable snapshot; volatile runtime values are normalized.",
            }
        )

    codex_summary = next(agent for agent in agents if agent["id"] == "codex")
    codex_default_capture = next(
        item
        for item in captures_by_key[("codex", codex_summary["version"])]
        if item.get("variant_id", "default") == "default"
    )
    codex_trace_source = source / codex_default_capture.get(
        "trace", f"captures/codex/{codex_summary['version']}/trace.jsonl"
    )
    codex_trace_target = prompts_dir / "codex.trace.jsonl"
    shutil.copyfile(codex_trace_source, codex_trace_target)
    trace_payload = codex_trace_target.read_bytes()

    manifest = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "name": "Phistory",
            "url": "https://phistory.cc/",
            "repository": PHISTORY_REPO,
            "commit": commit,
            "upstreamUpdatedAt": upstream["updated_at"],
            "method": (
                "Latest default prompt.md snapshots and all latest variants copied "
                "byte-for-byte from the pinned Phistory commit. Phistory captures "
                "requests through claude-tap."
            ),
        },
        "coverage": {
            "agentCount": len(agents),
            "latestSnapshots": len(agents),
            "totalHistoricalVersions": sum(agent["versionCount"] for agent in agents),
            "totalHistoricalSnapshots": sum(agent["snapshotCount"] for agent in agents),
        },
        "codexEvidence": {
            "version": codex_summary["version"],
            "promptPath": codex_summary["promptPath"],
            "promptSha256": codex_summary["sha256"],
            "tracePath": "data/prompts/codex.trace.jsonl",
            "traceSha256": sha256(trace_payload),
            "traceBytes": len(trace_payload),
            "claim": (
                "The displayed Codex raw view is an exact byte copy of Phistory's "
                "latest normalized prompt.md snapshot. The archived trace preserves "
                "the captured wire request before presentation normalization."
            ),
        },
        "agents": agents,
    }
    (ROOT / "data" / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(
        f"Synced {len(agents)} agents from Phistory {commit[:12]} "
        f"({manifest['coverage']['totalHistoricalSnapshots']} indexed snapshots)."
    )


if __name__ == "__main__":
    main()
