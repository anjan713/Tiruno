"""Claude Agent SDK exposed as a plain LLM provider. Port of ``llm/claudeAgent.ts``.

Routes completions through ``claude-agent-sdk`` (Claude subscription via CLI
login — no API key). Runs a single tool-less turn so it behaves like a normal
text/JSON completion. Select with ``LLM_PROVIDER=claude-agent``.
"""

import asyncio
import os
from typing import Optional

from ..claude_sdk import block_text, build_options, iter_assistant_blocks, result_of, subscription_env
from .base import LLMProvider


class ClaudeAgentLLM(LLMProvider):
    name = "claude-agent"

    def __init__(self, model: Optional[str] = None) -> None:
        self.model = model or os.environ.get("CLAUDE_MODEL") or "claude-agent-subscription"

    async def complete(
        self,
        prompt,
        *,
        system=None,
        max_tokens=1024,
        temperature=0.3,
        json=False,
        model=None,
        timeout_ms=60000,
    ) -> str:
        from claude_agent_sdk import query  # type: ignore

        sys = (system or "") + (
            "\nRespond with ONLY a single valid JSON object — no prose, no markdown fences."
            if json
            else ""
        )
        options = build_options(
            cwd=os.environ.get("AGENT_CWD") or os.getcwd(),
            setting_sources=[],
            allowed_tools=[],
            permission_mode="bypassPermissions",
            model=model or os.environ.get("CLAUDE_MODEL"),
            system_prompt=(sys.strip() or None),
            env=subscription_env(),
            max_turns=1,
        )

        acc = ""
        result = ""

        async def run() -> None:
            nonlocal acc, result
            async for msg in query(prompt=prompt, options=options):
                for block in iter_assistant_blocks(msg):
                    text = block_text(block)
                    if text:
                        acc += text
                res = result_of(msg)
                if res is not None and res[1]:
                    result = res[1]

        # Soft timeout: return whatever we have if the SDK runs long.
        try:
            await asyncio.wait_for(run(), timeout=timeout_ms / 1000)
        except asyncio.TimeoutError:
            pass
        except Exception:  # noqa: BLE001
            pass

        return (result or acc).strip()
