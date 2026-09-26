#!/usr/bin/env python3
"""Sync the latest Phistory prompt snapshots into the static site."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
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
    if subprocess.check_output(
        ["git", "-C", str(source), "status", "--porcelain", "--untracked-files=no"],
        text=True,
    ).strip():
        raise ValueError("Phistory checkout has tracked changes; pinned evidence must come from a clean commit")
    return subprocess.check_output(
        ["git", "-C", str(source), "rev-parse", "HEAD"],
        text=True,
    ).strip()


def select_default(captures: list[dict]) -> dict:
    variants = [item.get("variant_id", "default") for item in captures]
    if len(set(variants)) != len(variants) or variants.count("default") != 1:
        raise ValueError("Latest capture set needs one explicit default and unique variant IDs")
    return captures[variants.index("default")]


def prepare_icon(source: Path, agent_id: str, files: dict[Path, bytes]) -> str | None:
    candidates = sorted((source / "docs" / "agent-icons").glob(f"{agent_id}.*"))
    if not candidates:
        return None
    icon = candidates[0]
    files[ROOT / "agent-icons" / icon.name] = icon.read_bytes()
    return f"agent-icons/{icon.name}"


def required_string(item: dict, field: str) -> str:
    value = item.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Missing or invalid {field}")
    return value


def validate_identity(value: str) -> None:
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]*", value):
        raise ValueError(f"Invalid archive identity: {value!r}")


def validate_date(item: dict, field: str) -> None:
    datetime.fromisoformat(required_string(item, field).replace("Z", "+00:00"))


def preflight_captures(source: Path, captures: list[dict]) -> dict[str, tuple[bytes, dict]]:
    """Check all selected evidence before replacing any local snapshot."""
    prepared = {}
    for capture in captures:
        prompt_path = required_string(capture, "prompt")
        meta_path = required_string(capture, "meta")
        payload = (source / prompt_path).read_bytes()
        payload.decode("utf-8")
        validate_date(capture, "published_at")
        validate_date(capture, "captured_at")
        validate_identity(capture.get("variant_id", "default"))
        if "variant_label" in capture:
            required_string(capture, "variant_label")
        for field in ("variant_dimensions", "observed"):
            if not isinstance(capture.get(field, {}), dict):
                raise ValueError(f"Invalid {field}: {prompt_path}")
        if type(capture.get("trace_redacted", False)) is not bool:
            raise ValueError(f"Invalid trace_redacted: {prompt_path}")
        if capture.get("trace") is not None:
            required_string(capture, "trace")
        meta = json.loads((source / meta_path).read_text(encoding="utf-8"))
        if not isinstance(meta, dict):
            raise ValueError(f"Missing capture target: {capture['meta']}")
        required_string(meta, "target")
        # Manually imported captures have provenance but no package identity.
        if meta.get("package") is not None and not isinstance(meta["package"], str):
            raise ValueError(f"Invalid package identity: {capture['meta']}")
        if meta.get("source") is not None and not isinstance(meta["source"], dict):
            raise ValueError(f"Invalid capture source: {meta_path}")
        if not isinstance(meta.get("redactions", []), list) or any(
            not isinstance(item, str) for item in meta.get("redactions", [])
        ):
            raise ValueError(f"Invalid redactions: {meta_path}")
        prepared[prompt_path] = (payload, meta)
    return prepared


def indexed_variant_paths(manifest: dict) -> set[Path]:
    """Only files explicitly managed by the old manifest may be retired."""
    paths = set()
    for agent in manifest["agents"]:
        for variant in agent.get("availableVariants", []):
            validate_identity(agent["id"])
            validate_identity(variant["id"])
            expected = Path("data/variants") / agent["id"] / f"{variant['id']}.md"
            if variant["localPromptPath"] != str(expected):
                raise ValueError(f"Invalid managed variant path: {variant['localPromptPath']}")
            paths.add(ROOT / expected)
    return paths


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
    manifest_path = ROOT / "data" / "manifest.json"
    previous_variants = indexed_variant_paths(json.loads(manifest_path.read_text(encoding="utf-8"))) if manifest_path.exists() else set()
    validate_date(upstream, "updated_at")
    if not isinstance(upstream.get("agents"), list) or not upstream["agents"]:
        raise ValueError("Phistory index needs agent summaries")
    if not isinstance(upstream.get("captures"), list):
        raise ValueError("Phistory index needs captures")
    seen_agents = set()
    for summary in upstream["agents"]:
        agent_id = required_string(summary, "agent_id")
        validate_identity(agent_id)
        if agent_id in seen_agents:
            raise ValueError(f"Duplicate agent summary: {agent_id}")
        seen_agents.add(agent_id)
        required_string(summary, "agent")
        required_string(summary, "latest_version")
        for field, value in (
            ("versions", summary.get("versions", 1)),
            ("snapshots", summary.get("snapshots", summary.get("captures"))),
        ):
            if type(value) is not int or value < 1:
                raise ValueError(f"Invalid {field}: {agent_id}")
    files: dict[Path, bytes] = {}

    # Phistory may publish several variants for one agent/version.  The site
    # labels ``default`` as the canonical latest prompt, so keep this archive
    # aligned with that view instead of accidentally selecting whichever
    # variant happens to appear last in captures/index.json.
    captures_by_key: dict[tuple[str, str], list[dict]] = {}
    for item in upstream["captures"]:
        key = (item["agent_id"], item["version"])
        captures_by_key.setdefault(key, []).append(item)
    # Reject ambiguous defaults before replacing any prompt evidence.
    defaults = {
        summary["agent_id"]: select_default(captures_by_key[(summary["agent_id"], summary["latest_version"])])
        for summary in upstream["agents"]
    }
    prepared = preflight_captures(source, [
        capture
        for summary in upstream["agents"]
        for capture in captures_by_key[(summary["agent_id"], summary["latest_version"])]
    ])
    codex_trace_source = source / defaults["codex"]["trace"]
    trace_payload = codex_trace_source.read_bytes()
    trace_lines = [line for line in trace_payload.decode("utf-8").splitlines() if line.strip()]
    if not trace_lines:
        raise ValueError("Codex trace is empty")
    for line in trace_lines:
        json.loads(line)
    agents = []
    for position, summary in enumerate(upstream["agents"], start=1):
        agent_id = summary["agent_id"]
        version = summary["latest_version"]
        captures = captures_by_key[(agent_id, version)]
        capture = defaults[agent_id]
        relative_prompt = Path(capture["prompt"])
        payload, meta = prepared[capture["prompt"]]
        text = payload.decode("utf-8")
        destination = prompts_dir / f"{agent_id}.md"
        files[destination] = payload

        available_variants = []
        for item in captures:
            variant_id = item.get("variant_id", "default")
            variant_payload, _ = prepared[item["prompt"]]
            variant_text = variant_payload.decode("utf-8")
            variant_target = variants_dir / agent_id / f"{variant_id}.md"
            files[variant_target] = variant_payload
            available_variants.append(
                {
                    "id": variant_id,
                    "label": item.get("variant_label", "Default"),
                    "dimensions": item.get("variant_dimensions", {}),
                    "observed": item.get("observed", {}),
                    "prompt": item["prompt"],
                    "trace": item.get("trace"),
                    "traceRedacted": item.get("trace_redacted", False),
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
                "package": meta.get("package"),
                "publishedAt": capture["published_at"],
                "capturedAt": capture["captured_at"],
                "versionCount": summary.get("versions", 1),
                # ``snapshots`` replaced ``captures`` in Phistory's index
                # schema when multi-variant capture support was introduced.
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
                "icon": prepare_icon(source, agent_id, files),
                "sha256": sha256(payload),
                "bytes": len(payload),
                "characters": len(text),
                "lines": len(text.splitlines()),
                "headings": headings,
                "keywordCounts": keyword_counts,
                "promptRole": headings[0]["text"] if headings else "Prompt",
                "captureTarget": meta["target"],
                "captureSource": meta.get("source"),
                "redactions": meta.get("redactions", []),
                "normalization": "Phistory readable snapshot; volatile runtime values are normalized.",
            }
        )

    codex_summary = next(agent for agent in agents if agent["id"] == "codex")
    codex_trace_target = prompts_dir / "codex.trace.jsonl"
    files[codex_trace_target] = trace_payload

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
                "byte-for-byte from the pinned Phistory commit, including normalized "
                "tool captures and manually imported, redacted traces."
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
    serialized = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    obsolete_variants = previous_variants - indexed_variant_paths(manifest)
    # All source reads and validation finish above. Publish only prepared bytes,
    # so an invalid later capture cannot leave earlier evidence overwritten.
    for destination, payload in files.items():
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
    manifest_path.write_text(serialized, encoding="utf-8")
    for path in obsolete_variants:
        path.unlink(missing_ok=True)

    print(
        f"Synced {len(agents)} agents from Phistory {commit[:12]} "
        f"({manifest['coverage']['totalHistoricalSnapshots']} indexed snapshots)."
    )


if __name__ == "__main__":
    main()
