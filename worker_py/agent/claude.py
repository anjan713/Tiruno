"""Claude Agent SDK runner (skills like ``last30days``). Port of ``agent/claude.ts``.

Skills under ``.claude/skills`` are auto-discovered because ``setting_sources``
includes ``"project"`` and ``cwd`` is the repo root.
"""

import os
import re
from typing import Any, Dict, List, Optional

from ..claude_sdk import (
    block_text,
    block_tool_name,
    build_options,
    is_available,
    iter_assistant_blocks,
    result_of,
    subscription_env,
)
from .base import AgentRunner, OnStep, RunResult


def text_step(text: str) -> str:
    """Turn a long assistant text block into a short progress line."""
    clean = re.sub(r"\s+", " ", text).strip()
    if not clean:
        return ""
    return clean[:137] + "…" if len(clean) > 140 else clean


def tool_step(name: str, inp: Dict[str, Any]) -> str:
    """Turn a tool_use block into a friendly progress line."""
    if name == "Bash":
        cmd = str((inp or {}).get("command", ""))
        if re.search(r"last30days", cmd):
            return "Searching Reddit, X, YouTube, HN, GitHub & the web…"
        if re.search(r"python|uv ", cmd):
            return "Running research scripts…"
        return "Working…"
    if name == "WebSearch":
        return "Searching the web…"
    if name in ("Read", "Glob", "Grep"):
        return "Reading results…"
    if name == "Write":
        return "Saving findings…"
    return f"Using {name}…"


class ClaudeAgentRunner(AgentRunner):
    name = "claude-agent"
    supports_tools = True

    @staticmethod
    async def is_available() -> bool:
        return await is_available()

    async def run(
        self,
        *,
        prompt: str,
        system: Optional[str] = None,
        skills: Optional[List[str]] = None,
        max_turns: int = 40,
        on_step: Optional[OnStep] = None,
    ) -> RunResult:
        final_text = ""
        ok = False
        error: Optional[str] = None

        try:
            from claude_agent_sdk import query  # type: ignore

            options = build_options(
                cwd=os.environ.get("AGENT_CWD") or os.getcwd(),
                setting_sources=["project"],
                skills=skills or [],
                allowed_tools=["Bash", "Read", "Write", "WebSearch", "Glob", "Grep"],
                permission_mode="bypassPermissions",
                model=os.environ.get("CLAUDE_MODEL"),
                system_prompt=system,
                env=subscription_env(),
                max_turns=max_turns,
            )

            async for msg in query(prompt=prompt, options=options):
                for block in iter_assistant_blocks(msg):
                    tool = block_tool_name(block)
                    if tool is not None:
                        if on_step:
                            on_step(tool_step(tool, getattr(block, "input", {}) or {}))
                        continue
                    text = block_text(block)
                    if text:
                        step = text_step(text)
                        if step and on_step:
                            on_step(step)
                res = result_of(msg)
                if res is not None:
                    ok, final_text, subtype = res
                    if not ok:
                        error = subtype or "agent_error"
        except Exception as e:  # noqa: BLE001
            ok = False
            error = str(e)

        return RunResult(text=final_text, ok=ok, error=error)
