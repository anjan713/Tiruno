"""LLM provider contract. Port of ``src/lib/core/llm/types.ts``.

Any provider implements ``complete()``; the rest of the worker never imports a
vendor SDK directly. Select the active provider via ``get_llm()``.
"""

from abc import ABC, abstractmethod
from typing import Optional


class LLMProvider(ABC):
    #: Stable identifier, e.g. "anthropic" | "openai" | "ollama".
    name: str = "llm"
    #: The default model this provider will use.
    model: str = ""

    @abstractmethod
    async def complete(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        max_tokens: int = 1024,
        temperature: float = 0.3,
        json: bool = False,
        model: Optional[str] = None,
        timeout_ms: int = 30000,
    ) -> str:
        """Run a single completion and return the assistant's text."""
        raise NotImplementedError


class NoLLMConfiguredError(RuntimeError):
    def __init__(self) -> None:
        super().__init__(
            "No LLM provider configured. Use your Claude subscription "
            "(LLM_PROVIDER=claude-agent), or set ANTHROPIC_API_KEY / OPENAI_API_KEY, "
            "or run Ollama (OLLAMA_HOST). See PROVIDERS.md."
        )
