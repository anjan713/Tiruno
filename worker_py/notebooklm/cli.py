"""Low-level runner for the real ``notebooklm-mcp-cli`` (binary ``nlm``).
Port of ``notebooklm/cli.ts``.

Spawns the configured command (e.g. ``nlm source add …``), captures stdout, and
exposes helpers to parse both ``--json`` output (objects/arrays) and the CLI's
human-readable Rich text (e.g. "Source ID: <id>"). Every call is insulated: on
any failure it resolves to a structured error rather than raising.
"""

import asyncio
import json
import re
from typing import Any, Dict, List, Optional

from .config import NotebookLMConfig

_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def strip_ansi(s: str) -> str:
    """Strip ANSI color codes (Rich emits them when a TTY is detected)."""
    return _ANSI.sub("", s or "")


def parse_json(raw: str) -> Any:
    """Best-effort JSON extraction: the CLI prints an object/array with ``--json``."""
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        pass
    spans = []
    a, b = raw.find("["), raw.rfind("]")
    if a != -1 and b > a:
        spans.append((a, b))
    a, b = raw.find("{"), raw.rfind("}")
    if a != -1 and b > a:
        spans.append((a, b))
    for a, b in spans:
        try:
            return json.loads(raw[a : b + 1])
        except Exception:  # noqa: BLE001
            continue
    return None


def extract_field(raw: str, pattern: str) -> Optional[str]:
    """Extract the first capture group of ``pattern`` from the CLI's text output."""
    m = re.search(pattern, raw, re.IGNORECASE)
    return m.group(1).strip() if m and m.group(1) else None


async def run_cli(
    cfg: NotebookLMConfig,
    verb: str,
    args: List[str],
    stdin: Optional[str] = None,
    timeout_ms: Optional[int] = None,
) -> Dict[str, Any]:
    """Run a NotebookLM CLI verb. ``cfg.sub[verb]`` provides command tokens
    (e.g. ["source","add"]); ``args`` are appended. Returns ``{ok, raw, json, error?}``."""
    binary, *base_args = cfg.base_cmd
    profile_args = ["--profile", cfg.profile] if cfg.profile else []
    full_args = [*base_args, *cfg.sub[verb], *args, *profile_args]

    try:
        proc = await asyncio.create_subprocess_exec(
            binary,
            *full_args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdin_data = (stdin[:200000].encode("utf-8")) if stdin is not None else None
        try:
            out, err = await asyncio.wait_for(
                proc.communicate(stdin_data), timeout=(timeout_ms or cfg.timeout_ms) / 1000
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            return {"ok": False, "raw": "", "json": None, "error": "timeout"}

        raw = strip_ansi((out or b"").decode("utf-8", "ignore")).strip()
        js = parse_json(raw)
        if proc.returncode != 0:
            detail = strip_ansi((err or b"").decode("utf-8", "ignore")).strip() or f"exit {proc.returncode}"
            return {"ok": False, "raw": raw, "json": js, "error": detail}
        return {"ok": True, "raw": raw, "json": js, "error": None}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "raw": "", "json": None, "error": str(e)}
