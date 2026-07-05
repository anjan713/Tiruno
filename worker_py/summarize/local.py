"""Dependency-free extractive summary. Port of ``summarize/local.ts``."""

import re
from typing import Optional

from .types import SummarizeInput

_CODE_RE = re.compile(
    r"[{}]|=>|;\s|\bfunction\s*\(|addEventListener|querySelector|document\.|window\.|@click|x-data|=\s*\("
)


def local_summarize(text: str, title: Optional[str] = None) -> str:
    clean = re.sub(r"\s+", " ", text or "").strip()
    if not clean:
        return "There isn't enough text to summarise yet."

    sentences = []
    for raw in re.split(r"(?<=[.!?])\s+", clean):
        s = raw.strip()
        if len(s) > 20 and not _CODE_RE.search(s):
            sentences.append(s)

    lead = (" ".join(sentences[:3]) or clean)[:600]
    prefix = f'Here\'s what "{title}" is about. ' if title else "Here's what this is about. "
    return (prefix + lead)[:700]


class LocalSummarizer:
    name = "local"

    async def summarize(self, inp: SummarizeInput) -> str:
        return local_summarize(inp.text, inp.title)
