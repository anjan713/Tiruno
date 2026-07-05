"""LLM provider registry — env-driven selection. Port of ``llm/index.ts``.

Priority (override with ``LLM_PROVIDER=claude-agent|anthropic|openai|ollama``):
  ANTHROPIC_API_KEY -> anthropic
  OPENAI_API_KEY    -> openai
  OLLAMA_HOST set    -> ollama
  (none)             -> None  (callers fall back to built-in heuristics)
"""

import json as _json
import os
import re
from typing import Optional, TypeVar

from .anthropic import AnthropicLLM
from .base import LLMProvider, NoLLMConfiguredError
from .claude_agent import ClaudeAgentLLM
from .ollama import OllamaLLM
from .openai import OpenAILLM

__all__ = [
    "LLMProvider",
    "NoLLMConfiguredError",
    "llm_provider_name",
    "get_llm",
    "require_llm",
    "parse_json_from_text",
]

T = TypeVar("T")


def llm_provider_name() -> str:
    override = (os.environ.get("LLM_PROVIDER") or "").lower()
    if override in ("claude-agent", "anthropic", "openai", "ollama"):
        return override
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"
    if os.environ.get("OLLAMA_HOST"):
        return "ollama"
    return "none"


_cache: dict = {}


def get_llm() -> Optional[LLMProvider]:
    """The active LLM provider, or ``None`` when none is configured."""
    name = llm_provider_name()
    if _cache.get("key") == name:
        return _cache.get("provider")

    provider: Optional[LLMProvider]
    if name == "claude-agent":
        provider = ClaudeAgentLLM()
    elif name == "anthropic":
        provider = AnthropicLLM(os.environ["ANTHROPIC_API_KEY"])
    elif name == "openai":
        provider = OpenAILLM(os.environ["OPENAI_API_KEY"])
    elif name == "ollama":
        provider = OllamaLLM()
    else:
        provider = None

    _cache["key"] = name
    _cache["provider"] = provider
    return provider


def require_llm() -> LLMProvider:
    llm = get_llm()
    if not llm:
        raise NoLLMConfiguredError()
    return llm


def parse_json_from_text(text: str, fallback: T) -> T:
    """Extract a single JSON object/array from an LLM response that may include
    prose or ```json fences. Returns ``fallback`` when nothing parses."""
    if not text:
        return fallback
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    candidate = m.group(1) if m else text
    obj_start = candidate.find("{")
    arr_start = candidate.find("[")
    if obj_start == -1:
        start = arr_start
    elif arr_start == -1:
        start = obj_start
    else:
        start = min(obj_start, arr_start)
    if start == -1:
        return fallback
    open_ch = candidate[start]
    end = candidate.rfind("]") if open_ch == "[" else candidate.rfind("}")
    if end == -1 or end <= start:
        return fallback
    try:
        return _json.loads(candidate[start : end + 1])
    except Exception:  # noqa: BLE001
        return fallback
