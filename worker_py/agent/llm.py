"""LLM-backed agent runner (single completion, no tools). Port of ``agent/llm.ts``."""

from typing import List, Optional

from ..llm import get_llm
from .base import AgentRunner, OnStep, RunResult


class LLMAgentRunner(AgentRunner):
    name = "llm"
    supports_tools = False

    async def run(
        self,
        *,
        prompt: str,
        system: Optional[str] = None,
        skills: Optional[List[str]] = None,
        max_turns: int = 40,
        on_step: Optional[OnStep] = None,
    ) -> RunResult:
        llm = get_llm()
        if not llm:
            return RunResult(text="", ok=False, error="no_llm_configured")
        try:
            if on_step:
                on_step("Thinking…")
            text = await llm.complete(prompt, system=system, max_tokens=2048, temperature=0.4)
            return RunResult(text=text, ok=bool(text), error=None if text else "empty_response")
        except Exception as e:  # noqa: BLE001
            return RunResult(text="", ok=False, error=str(e))
