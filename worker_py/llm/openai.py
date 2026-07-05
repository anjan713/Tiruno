"""OpenAI-compatible Chat Completions adapter. Port of ``llm/openai.ts``.

Works with OpenAI and any compatible gateway via ``OPENAI_BASE_URL``.
"""

import os
from typing import Optional

from ..http import request_with_retry
from .base import LLMProvider


class OpenAILLM(LLMProvider):
    name = "openai"

    def __init__(self, api_key: str, model: Optional[str] = None, base_url: Optional[str] = None) -> None:
        self.api_key = api_key
        self.model = model or os.environ.get("OPENAI_MODEL") or "gpt-4o-mini"
        self.base_url = (base_url or os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")

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
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        body = {
            "model": model or self.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": messages,
        }
        if json:
            body["response_format"] = {"type": "json_object"}

        res = await request_with_retry(
            "POST",
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}", "content-type": "application/json"},
            json=body,
            timeout_ms=timeout_ms,
        )
        data = res.json()
        try:
            return str(data["choices"][0]["message"]["content"] or "").strip()
        except (KeyError, IndexError, TypeError):
            return ""
