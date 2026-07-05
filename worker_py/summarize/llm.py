"""LLM-based summarizer — the smart default. Port of ``summarize/llm.ts``."""

import re

from ..llm import get_llm
from .types import SummarizeInput


class LLMSummarizer:
    name = "llm"

    async def summarize(self, inp: SummarizeInput) -> str:
        llm = get_llm()
        if not llm:
            return ""

        clean = re.sub(r"\s+", " ", inp.text or "").strip()
        if not clean:
            return ""

        subject = f'the article titled "{inp.title}"' if inp.title else "the following text"
        prompt = (
            f"Summarise {subject} for a curious learner. Write 3 to 5 clear sentences in plain, "
            "spoken English — it will be read aloud. Lead with what it's about, then the key "
            "takeaways and why they matter. Do not use markdown, bullet points, headings, or "
            "lists. Ground every statement in the text; do not invent details.\n\n"
            f"---\n{clean[:8000]}\n---"
        )

        out = await llm.complete(
            prompt,
            system="You are a concise, accurate explainer. Output only the summary prose.",
            max_tokens=400,
            temperature=0.3,
        )
        return out.strip()
