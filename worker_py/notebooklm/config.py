"""NotebookLM configuration. Port of ``src/lib/core/notebooklm/config.ts``.

Resolved entirely from the environment so the client works against the real
``notebooklm-mcp-cli`` (binary ``nlm``, https://github.com/jacob-bd/notebooklm-mcp-cli)
and can run in a hermetic MOCK mode for dev/tests.

The real CLI uses ``nlm <group> <verb>`` commands (e.g. ``nlm source add``,
``nlm audio create``, ``nlm studio status --json``, ``nlm download audio``).
Each command is a token list so individual commands can be overridden.
"""

import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional

# verb -> default command tokens
_DEFAULT_SUB: Dict[str, List[str]] = {
    "addSource": ["source", "add"],
    "listSources": ["source", "list"],
    "deleteSource": ["source", "delete"],
    "audioCreate": ["audio", "create"],
    "studioStatus": ["studio", "status"],
    "downloadAudio": ["download", "audio"],
}


def _env(name: str):
    v = os.environ.get(name)
    return v.strip() if v and v.strip() else None


@dataclass
class NotebookLMConfig:
    enabled: bool
    mock: bool
    base_cmd: List[str]
    sub: Dict[str, List[str]]
    notebooks: Dict[str, str]
    timeout_ms: int
    retention_days: int
    source_cap: int
    audio_poll_ms: int = 5000
    audio_timeout_ms: int = 600000
    audio_format: str = "deep_dive"
    audio_length: str = "default"
    profile: Optional[str] = None
    data_dir: str = field(default="data/materials")


def notebooklm_config() -> NotebookLMConfig:
    mock = _env("NOTEBOOKLM_MOCK") == "1"
    enabled = mock or _env("NOTEBOOKLM_ENABLED") == "1" or (_env("SUMMARIZER") or "").lower() == "notebooklm"

    # The real ingestion CLI binary is `nlm`. NOTE: distinct from the summarizer's
    # NOTEBOOKLM_CMD (which embeds a "summarize" verb). The ingestion client
    # appends its own command tokens, so it needs a *base* command only.
    base_cmd = (_env("NOTEBOOKLM_CLI") or "nlm").split()

    sub = {k: list(v) for k, v in _DEFAULT_SUB.items()}
    for verb in _DEFAULT_SUB:
        override = _env(f"NOTEBOOKLM_SUB_{verb.upper()}")
        if override:
            sub[verb] = override.split()

    return NotebookLMConfig(
        enabled=enabled,
        mock=mock,
        base_cmd=base_cmd,
        sub=sub,
        notebooks={
            "courses": _env("NOTEBOOKLM_NOTEBOOK_COURSES") or "courses",
            "articles": _env("NOTEBOOKLM_NOTEBOOK_ARTICLES") or "articles",
        },
        timeout_ms=int(_env("NOTEBOOKLM_TIMEOUT_MS") or "120000"),
        retention_days=int(_env("NOTEBOOKLM_RETENTION_DAYS") or "7"),
        source_cap=int(_env("NOTEBOOKLM_SOURCE_CAP") or "50"),
        audio_poll_ms=int(_env("NOTEBOOKLM_AUDIO_POLL_MS") or "5000"),
        audio_timeout_ms=int(_env("NOTEBOOKLM_AUDIO_TIMEOUT_MS") or "600000"),
        audio_format=_env("NOTEBOOKLM_AUDIO_FORMAT") or "deep_dive",
        audio_length=_env("NOTEBOOKLM_AUDIO_LENGTH") or "default",
        profile=_env("NOTEBOOKLM_PROFILE"),
        data_dir=_env("NOTEBOOKLM_DATA_DIR") or "data/materials",
    )


def notebooklm_enabled() -> bool:
    return notebooklm_config().enabled
