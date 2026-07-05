"""Summarizer contract. Port of ``src/lib/core/summarize/types.ts``."""

from dataclasses import dataclass
from typing import Optional


@dataclass
class SummarizeInput:
    text: str
    title: Optional[str] = None
    url: Optional[str] = None
