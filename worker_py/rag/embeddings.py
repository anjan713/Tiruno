"""Pluggable text embeddings. Port of ``src/lib/rag/embeddings.ts``.

Provider chosen from env at call time:
  OLLAMA_HOST    -> Ollama (local, free; default model mxbai-embed-large, 1024-dim)
  OPENAI_API_KEY -> OpenAI (text-embedding-3-small, dimensions = EMBED_DIM)
  (neither)      -> deterministic local hashing embedding (offline-safe)

Every provider returns an L2-normalized EMBED_DIM vector so the Redis HNSW index
(COSINE) is consistent regardless of which one is active. The local fallback uses
the SAME FNV-1a hashing as the TS version, so vectors match cross-language.
"""

import math
import os
import re
from typing import List, Optional

from redis.asyncio import Redis

from ..http import request_with_retry

#: Fixed embedding dimension. The vector index is created with this DIM.
EMBED_DIM = 1024


def embedding_provider() -> str:
    override = (os.environ.get("EMBED_PROVIDER") or "").lower()
    if override in ("local", "ollama", "openai"):
        return override
    if os.environ.get("OLLAMA_HOST"):
        return "ollama"
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"
    return "local"


def _l2normalize(v: List[float]) -> List[float]:
    total = sum(x * x for x in v)
    norm = math.sqrt(total)
    if not norm or not math.isfinite(norm):
        return [0.0] * len(v)
    return [x / norm for x in v]


def _fnv1a(s: str) -> int:
    """FNV-1a 32-bit (unsigned), matching the JS implementation bit-for-bit."""
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def _to_base36(n: int) -> str:
    if n == 0:
        return "0"
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while n > 0:
        out = digits[n % 36] + out
        n //= 36
    return out


def local_embed(text: str) -> List[float]:
    """Deterministic hashing embedding (signed bag-of-tokens + bigrams)."""
    vec = [0.0] * EMBED_DIM
    tokens = [t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 1]
    grams = list(tokens)
    for i in range(len(tokens) - 1):
        grams.append(f"{tokens[i]}_{tokens[i + 1]}")
    for g in grams:
        h = _fnv1a(g)
        bucket = h % EMBED_DIM
        sign = -1 if ((h >> 31) & 1) else 1
        vec[bucket] += sign
    return _l2normalize(vec)


def _model_name(provider: str) -> str:
    if provider == "ollama":
        return os.environ.get("OLLAMA_EMBED_MODEL") or "mxbai-embed-large"
    if provider == "openai":
        return os.environ.get("OPENAI_EMBED_MODEL") or "text-embedding-3-small"
    return "local"


# ---- Redis cache (lazy, optional; only when REDIS_URL is set) ---------------
_cache_client: Optional[Redis] = None
_cache_init = False


def _get_cache() -> Optional[Redis]:
    global _cache_client, _cache_init
    if _cache_init:
        return _cache_client
    _cache_init = True
    url = os.environ.get("REDIS_URL")
    try:
        _cache_client = Redis.from_url(url, decode_responses=True) if url else None
    except Exception:  # noqa: BLE001
        _cache_client = None
    return _cache_client


def _cache_key(provider: str, text: str) -> str:
    return f"emb:{provider}:{_model_name(provider)}:{len(text)}:{_to_base36(_fnv1a(text))}"


async def _cache_get(key: str) -> Optional[List[float]]:
    c = _get_cache()
    if not c:
        return None
    try:
        import json

        v = await c.get(key)
        return json.loads(v) if v else None
    except Exception:  # noqa: BLE001
        return None


async def _cache_set(key: str, vec: List[float]) -> None:
    c = _get_cache()
    if not c:
        return
    try:
        import json

        await c.set(key, json.dumps(vec), ex=60 * 60 * 24 * 30)
    except Exception:  # noqa: BLE001
        pass


def _ollama_base() -> str:
    """Base URL of the local Ollama server (no trailing slash)."""
    return (os.environ.get("OLLAMA_HOST") or "http://localhost:11434").rstrip("/")


async def _ollama_embed(texts: List[str]) -> List[List[float]]:
    # Cold model loads can take a while, so allow a longer per-attempt timeout.
    res = await request_with_retry(
        "POST",
        f"{_ollama_base()}/api/embed",
        headers={"content-type": "application/json"},
        json={"model": _model_name("ollama"), "input": texts},
        timeout_ms=60000,
    )
    data = res.json()
    embeddings = data.get("embeddings") or []
    if len(embeddings) != len(texts):
        raise RuntimeError(f"ollama returned {len(embeddings)} embeddings for {len(texts)} inputs")
    out: List[List[float]] = []
    for e in embeddings:
        if not isinstance(e, list) or len(e) != EMBED_DIM:
            dim = len(e) if isinstance(e, list) else None
            raise RuntimeError(
                f"ollama embedding dim {dim} != {EMBED_DIM}; set OLLAMA_EMBED_MODEL to a "
                f"{EMBED_DIM}-dim model (e.g. mxbai-embed-large)"
            )
        out.append(_l2normalize(e))
    return out


async def _openai_embed(texts: List[str]) -> List[List[float]]:
    res = await request_with_retry(
        "POST",
        "https://api.openai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {os.environ.get('OPENAI_API_KEY')}", "content-type": "application/json"},
        json={"model": _model_name("openai"), "input": texts, "dimensions": EMBED_DIM},
        timeout_ms=20000,
    )
    data = res.json()
    return [_l2normalize(d["embedding"]) for d in data["data"]]


async def embed_batch(texts: List[str]) -> List[List[float]]:
    """Embed a batch, resolving cache hits first and embedding only the misses."""
    import asyncio

    clean = [(t or "")[:8000] for t in texts]
    provider = embedding_provider()
    keys = [_cache_key(provider, t) for t in clean]
    out: List[Optional[List[float]]] = list(await asyncio.gather(*[_cache_get(k) for k in keys]))

    miss_idx = [i for i, v in enumerate(out) if v is None]
    if miss_idx:
        miss_texts = [clean[i] for i in miss_idx]
        used_fallback = False
        try:
            if provider == "ollama":
                vecs = await _ollama_embed(miss_texts)
            elif provider == "openai":
                vecs = await _openai_embed(miss_texts)
            else:
                vecs = [local_embed(t) for t in miss_texts]
        except Exception as e:  # noqa: BLE001
            print(f"[embeddings] {provider} failed, using local: {e}")
            vecs = [local_embed(t) for t in miss_texts]
            used_fallback = True
        for j, idx in enumerate(miss_idx):
            out[idx] = vecs[j]
            if not used_fallback:
                await _cache_set(keys[idx], vecs[j])

    return [v if v is not None else local_embed("") for v in out]


async def embed(text: str) -> List[float]:
    """Embed a single text into an EMBED_DIM L2-normalized vector."""
    return (await embed_batch([text]))[0]
