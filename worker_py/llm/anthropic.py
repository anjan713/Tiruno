"""Anthropic (Claude) Messages API adapter. Port of ``llm/anthropic.ts``."""

import os
from typing import Optional

from ..http import request_with_retry
from .base import LLMProvider

URL = "https://api.anthropic.com/v1/messages"


class AnthropicLLM(LLMProvider):
    name = "anthropic"

    def __init__(self, api_key: str, model: Optional[str] = None) -> None:
        self.api_key = api_key
        self.model = model or os.environ.get("ANTHROPIC_MODEL") or "claude-haiku-4-5-20251001"

    async def complete(
        self,
        prompt,
        *,
        system=None,
        max_tokens=1024,
        temperature=0.3,
        json=False,
        model=None,
        timeout_ms=30000,
    ) -> str:
        sys = (system or "") + (
            "\nRespond with ONLY a single valid JSON object — no prose, no markdown fences."
            if json
            else ""
        )
        body = {
            "model": model or self.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [{"role": "user", "content": prompt}],
        }
        if sys.strip():
            body["system"] = sys.strip()

        res = await request_with_retry(
            "POST",
            URL,
            headers={
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
            timeout_ms=timeout_ms,
        )
        data = res.json()
        blocks = data.get("content") if isinstance(data, dict) else None
        if not isinstance(blocks, list):
            return ""
        return "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
