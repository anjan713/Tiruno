"""Agent runner registry + ``run_skill_agent`` shim.

Ports ``src/lib/core/agent/index.ts`` (selection) and ``worker/lib/sdk.ts``
(the ``runSkillAgent`` convenience used by every agent).
"""

import os
from typing import List, Optional

from ..llm import llm_provider_name
from .base import AgentRunner, OnStep, RunResult
from .claude import ClaudeAgentRunner
from .llm import LLMAgentRunner

__all__ = ["AgentRunner", "RunResult", "get_agent_runner", "run_skill_agent"]

_cached: Optional[AgentRunner] = None


async def get_agent_runner(needs_tools: bool = False) -> AgentRunner:
    """Resolve the active agent runner.

    Prefers the Claude Agent SDK when installed AND Anthropic is the active LLM
    (so skills/tools work), otherwise the portable single-completion LLM runner.
    """
    global _cached
    override = (os.environ.get("AGENT_RUNNER") or "").lower()
    if override == "llm":
        return LLMAgentRunner()
    if override == "claude" and await ClaudeAgentRunner.is_available():
        return ClaudeAgentRunner()

    if _cached is not None and not needs_tools:
        return _cached

    name = llm_provider_name()
    prefer_claude = (
        needs_tools or name in ("anthropic", "claude-agent")
    ) and await ClaudeAgentRunner.is_available()
    runner: AgentRunner = ClaudeAgentRunner() if prefer_claude else LLMAgentRunner()
    if not needs_tools:
        _cached = runner
    return runner


async def run_skill_agent(
    *,
    prompt: str,
    system: Optional[str] = None,
    skills: Optional[List[str]] = None,
    max_turns: int = 40,
    on_step: Optional[OnStep] = None,
) -> RunResult:
    """Run a one-shot agent session. When ``skills`` are requested we ask for a
    tool-capable runner (Claude Agent SDK if installed)."""
    needs_tools = bool(skills)
    runner = await get_agent_runner(needs_tools)
    return await runner.run(
        prompt=prompt, system=system, skills=skills or [], max_turns=max_turns, on_step=on_step
    )
