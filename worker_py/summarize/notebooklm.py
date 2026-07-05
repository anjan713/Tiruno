"""NotebookLM summarizer (optional). Port of ``summarize/notebooklm.ts``.

Shells out to ``notebooklm-mcp-cli`` (enable with NOTEBOOKLM_ENABLED=1 or
SUMMARIZER=notebooklm). Degrades to "" on any error so the registry falls back.
"""

import asyncio
import os

from .types import SummarizeInput


class NotebookLMSummarizer:
    name = "notebooklm"

    async def summarize(self, inp: SummarizeInput) -> str:
        if os.environ.get("NOTEBOOKLM_ENABLED") != "1" and (os.environ.get("SUMMARIZER") or "").lower() != "notebooklm":
            return ""

        cmd = (os.environ.get("NOTEBOOKLM_CMD") or "notebooklm-mcp-cli summarize").strip()
        parts = cmd.split()
        if not parts:
            return ""
        binary, base_args = parts[0], parts[1:]
        args = list(base_args)
        if inp.title:
            args += ["--title", inp.title]
        if inp.url:
            args.append(inp.url)

        timeout_ms = int(os.environ.get("NOTEBOOKLM_TIMEOUT_MS", "120000"))

        try:
            proc = await asyncio.create_subprocess_exec(
                binary,
                *args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdin_data = ((inp.text or "")[:200000]).encode("utf-8")
            try:
                stdout, _stderr = await asyncio.wait_for(proc.communicate(stdin_data), timeout=timeout_ms / 1000)
            except asyncio.TimeoutError:
                try:
                    proc.kill()
                except ProcessLookupError:
                    pass
                return ""
            if proc.returncode != 0:
                return ""
            return (stdout or b"").decode("utf-8", "ignore").strip()
        except Exception:  # noqa: BLE001
            return ""
