"""Async HTTP with retry/backoff on 429 + 5xx (honoring Retry-After).

Port of ``src/lib/core/http.ts`` (``fetchWithRetry``). Kept dependency-light so
every provider adapter can use it.
"""

import asyncio
from typing import Optional

import httpx

DEFAULT_BACKOFF = [1.0, 4.0, 10.0, 20.0]

_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient()
    return _client


async def request_with_retry(
    method: str,
    url: str,
    *,
    headers: Optional[dict] = None,
    json: Optional[dict] = None,
    attempts: int = 4,
    timeout_ms: int = 20000,
    backoff=None,
) -> httpx.Response:
    """Issue a request, retrying transient failures. Raises on final failure."""
    backoff = backoff or DEFAULT_BACKOFF
    timeout = httpx.Timeout(timeout_ms / 1000)
    client = _get_client()
    last_err = ""

    for i in range(attempts):
        try:
            res = await client.request(method, url, headers=headers, json=json, timeout=timeout)
            if res.is_success:
                return res
            last_err = f"{res.status_code} {res.reason_phrase}"
            if res.status_code == 429 or res.status_code >= 500:
                retry_after = 0.0
                try:
                    retry_after = float(res.headers.get("retry-after", "0"))
                except ValueError:
                    retry_after = 0.0
                if i < attempts - 1:
                    await asyncio.sleep(retry_after if retry_after > 0 else backoff[min(i, len(backoff) - 1)])
                continue
            detail = ""
            try:
                detail = res.text
            except Exception:
                detail = ""
            raise RuntimeError(f"{last_err}{(' — ' + detail[:300]) if detail else ''}")
        except Exception as e:  # noqa: BLE001 — mirror the JS catch-all retry
            last_err = str(e)
            if i < attempts - 1:
                await asyncio.sleep(backoff[min(i, len(backoff) - 1)])

    raise RuntimeError(last_err or "request failed")
