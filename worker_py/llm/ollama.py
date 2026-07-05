"""Ollama adapter — fully local inference. Port of ``llm/ollama.ts``."""

import os
from typing import Optional

from ..http import request_with_retry
from .base import LLMProvider


class OllamaLLM(LLMProvider):
    name = "ollama"

    def __init__(self, model: Optional[str] = None, host: Optional[str] = None) -> None:
        self.model = model or os.environ.get("OLLAMA_MODEL") or "llama3.1"
        self.host = (host or os.environ.get("OLLAMA_HOST") or "http://localhost:11434").rstrip("/")

    async def complete(
        self,
        prompt,
        *,
        system=None,
        max_tokens=1024,
        temperature=0.3,
        json=False,
        model=None,
        timeout_ms=120000,
    ) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        body = {
            "model": model or self.model,
            "stream": False,
            "options": {"temperature": temperature, "num_predict": max_tokens},
            "messages": messages,
        }
        if json:
            body["format"] = "json"

        res = await request_with_retry(
            "POST",
            f"{self.host}/api/chat",
            headers={"content-type": "application/json"},
            json=body,
            timeout_ms=timeout_ms,
            attempts=2,
        )
        data = res.json()
        try:
            return str((data.get("message") or {}).get("content") or "").strip()
        except AttributeError:
            return ""
