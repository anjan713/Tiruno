"""Summarizer registry + convenience helper. Port of ``summarize/index.ts`` and
the ``notebooklm`` back-compat shim (``src/lib/notebooklm.ts``).
"""

import os
from typing import Dict, List, Optional

from ..llm import get_llm
from .llm import LLMSummarizer
from .local import LocalSummarizer, local_summarize
from .notebooklm import NotebookLMSummarizer
from .types import SummarizeInput

__all__ = [
    "SummarizeInput",
    "summarizer_chain",
    "summarize",
    "notebooklm_summarize",
    "local_summarize",
]


def summarizer_chain() -> List[object]:
    override = (os.environ.get("SUMMARIZER") or "").lower()
    if override == "local":
        return [LocalSummarizer()]

    chain: List[object] = []
    if override == "notebooklm" or os.environ.get("NOTEBOOKLM_ENABLED") == "1":
        chain.append(NotebookLMSummarizer())
    if get_llm():
        chain.append(LLMSummarizer())
    chain.append(LocalSummarizer())
    return chain


async def summarize(inp: SummarizeInput) -> Dict[str, str]:
    """Summarise text using the best available backend, with graceful fallback."""
    for s in summarizer_chain():
        try:
            out = await s.summarize(inp)  # type: ignore[attr-defined]
            if out and out.strip():
                return {"summary": out.strip(), "via": s.name}  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            continue
    return {"summary": local_summarize(inp.text, inp.title), "via": "local"}


async def notebooklm_summarize(text: str, title: Optional[str] = None, url: Optional[str] = None) -> Optional[str]:
    """Deprecated shim: returns the NotebookLM/LLM summary, or ``None`` to let
    callers apply their own fallback. Mirrors ``notebooklmSummarize``."""
    res = await summarize(SummarizeInput(text=text, title=title, url=url))
    return None if res["via"] == "local" else res["summary"]
