"""Shared helpers for the optional ``claude-agent-sdk`` (used by both the agent
runner and the claude-agent LLM provider).

The SDK is imported lazily everywhere so it stays an OPTIONAL dependency: if it
isn't installed, callers fall back to the plain LLM runner / provider.
"""

import dataclasses
import os
from typing import Any, List, Optional, Tuple


def subscription_env() -> dict:
    """Env handed to the SDK with API keys removed so it authenticates via the
    Claude **subscription** (CLI login). The Agent SDK bills the paid API whenever
    ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN is present, so we drop them here."""
    env = dict(os.environ)
    env.pop("ANTHROPIC_API_KEY", None)
    env.pop("ANTHROPIC_AUTH_TOKEN", None)
    return env


async def is_available() -> bool:
    try:
        import claude_agent_sdk  # noqa: F401
        return True
    except Exception:
        return False


def build_options(**kwargs):
    """Construct ``ClaudeAgentOptions`` with only the kwargs this SDK version
    actually supports (filters out e.g. ``skills`` on older builds), dropping
    ``None`` values."""
    from claude_agent_sdk import ClaudeAgentOptions  # type: ignore

    field_names = {f.name for f in dataclasses.fields(ClaudeAgentOptions)}
    filtered = {k: v for k, v in kwargs.items() if k in field_names and v is not None}
    return ClaudeAgentOptions(**filtered)


def iter_assistant_blocks(msg) -> List[Any]:
    """Return the content blocks of an assistant message, or [] otherwise."""
    if type(msg).__name__ == "AssistantMessage" or hasattr(msg, "content"):
        content = getattr(msg, "content", None)
        if isinstance(content, list):
            return content
    return []


def block_text(block) -> Optional[str]:
    """Text of a TextBlock (a tool_use block has ``name``/``input`` instead)."""
    if getattr(block, "name", None) is not None:
        return None
    text = getattr(block, "text", None)
    return text if isinstance(text, str) and text else None


def block_tool_name(block) -> Optional[str]:
    if getattr(block, "name", None) is not None and hasattr(block, "input"):
        return str(block.name)
    return None


def result_of(msg) -> Optional[Tuple[bool, str, str]]:
    """If ``msg`` is a result message, return (ok, text, subtype)."""
    if type(msg).__name__ == "ResultMessage" or (hasattr(msg, "subtype") and hasattr(msg, "result")):
        subtype = str(getattr(msg, "subtype", "") or "")
        result = getattr(msg, "result", "")
        text = result if isinstance(result, str) else ""
        return subtype == "success", text, subtype
    return None
