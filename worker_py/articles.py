"""Article storage + fetch helpers. Minimal port of the parts of
``src/lib/articles.ts`` the NotebookLM ingestion pipeline needs.

Redis:
  article:{id}     -> JSON StoredArticle
  articles:index   -> ZSET member=id score=addedAt (newest first)
"""

import json
import random
import re
import string
from typing import Optional
from urllib.parse import urlparse

import httpx
from redis.asyncio import Redis

from .rag import embed, ensure_vector_index, index_material
from .util import now_ms

_INDEX = "articles:index"


def gen_id() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=8))


def host_of(url: str) -> str:
    try:
        host = urlparse(url).hostname or "web"
        return host[4:] if host.startswith("www.") else host
    except Exception:  # noqa: BLE001
        return "web"


async def get_article(redis: Redis, article_id: str) -> Optional[dict]:
    raw = await redis.get(f"article:{article_id}")
    return json.loads(raw) if raw else None


async def save_article(redis: Redis, a: dict) -> None:
    await redis.set(f"article:{a['id']}", json.dumps(a))
    await redis.zadd(_INDEX, {a["id"]: a["addedAt"]})


async def index_article_vector(redis: Redis, a: dict) -> None:
    """Embed + index an article into the vector index (best-effort)."""
    try:
        await ensure_vector_index(redis)
        vec = await embed(f"{a['title']}. {a.get('summary', '')} {a.get('text', '')}")
        await index_material(
            redis,
            {
                "id": f"art-{a['id']}",
                "kind": "article",
                "refId": a["id"],
                "title": a["title"],
                "topic": a.get("topic", ""),
                "text": a.get("summary") or a.get("text", ""),
                "url": a.get("url"),
            },
            vec,
        )
    except Exception:  # noqa: BLE001
        pass


# Mirrors the TS readability extractor in src/lib/articles.ts.
_NAMED_ENTITIES = {
    "amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'", "nbsp": " ",
    "mdash": "—", "ndash": "–", "hellip": "…", "rsquo": "’", "lsquo": "‘",
    "rdquo": "”", "ldquo": "“", "copy": "©", "reg": "®", "trade": "™",
}
_CODE_RE = re.compile(
    r"[{}]|=>|;\s|\bfunction\s*\(|addEventListener|querySelector|document\.|window\.|@click|x-data|=\s*\(",
    re.IGNORECASE,
)
_SYMBOL_RE = re.compile(r"[a-z0-9\s.,'\"’“”():%–—-]", re.IGNORECASE)


def _decode_entities(s: str) -> str:
    s = re.sub(r"&#x([0-9a-f]+);", lambda m: chr(int(m.group(1), 16)), s, flags=re.IGNORECASE)
    s = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), s)
    return re.sub(r"&([a-z]+);", lambda m: _NAMED_ENTITIES.get(m.group(1).lower(), " "), s, flags=re.IGNORECASE)


def _strip_tags(s: str) -> str:
    return re.sub(r"<[^>]*>", " ", s)


def _looks_like_code(s: str) -> bool:
    return bool(_CODE_RE.search(s))


def _is_prose(s: str) -> bool:
    """True for snippets that look like readable prose rather than markup/code."""
    if len(s) < 40 or _looks_like_code(s):
        return False
    if len([w for w in s.split() if w]) < 6:
        return False
    symbol_ratio = len(_SYMBOL_RE.sub("", s)) / len(s)
    return symbol_ratio < 0.12


def _meta_content(html: str, attr: str, key: str) -> Optional[str]:
    a = re.search(rf'<meta[^>]+{attr}=["\']{re.escape(key)}["\'][^>]+content=["\']([^"\']*)["\']', html, re.IGNORECASE)
    b = re.search(rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]+{attr}=["\']{re.escape(key)}["\']', html, re.IGNORECASE)
    return (a.group(1) if a else None) or (b.group(1) if b else None)


def _extract_readable(html: str) -> str:
    """Extract readable article text: prefer real paragraphs, drop scripts/markup."""
    cleaned = re.sub(r"<(script|style|noscript|svg|template|head)[\s\S]*?</\1>", " ", html, flags=re.IGNORECASE)

    paras = []
    for raw in re.findall(r"<p\b[^>]*>([\s\S]*?)</p>", cleaned, flags=re.IGNORECASE):
        t = re.sub(r"\s+", " ", _decode_entities(_strip_tags(raw))).strip()
        if _is_prose(t):
            paras.append(t)

    text = " ".join(paras)
    if len(text) < 200:
        region = cleaned
        for tag in ("article", "main", "body"):
            m = re.search(rf"<{tag}\b[^>]*>([\s\S]*?)</{tag}>", cleaned, flags=re.IGNORECASE)
            if m:
                region = m.group(1)
                break
        flat = re.sub(r"\s+", " ", _decode_entities(_strip_tags(region))).strip()
        sentences = [s for s in re.split(r"(?<=[.!?])\s+", flat) if _is_prose(s)]
        text = (" ".join(sentences) or flat).strip()
    return text[:4000]


async def fetch_article(url: str) -> dict:
    """Fetch + extract readable text + title from a live URL."""
    async with httpx.AsyncClient(follow_redirects=True, timeout=8.0) as client:
        res = await client.get(url, headers={"User-Agent": "TirunoBot/1.0 (+https://tiruno.app)"})
        html = res.text
    raw_title = _meta_content(html, "property", "og:title")
    if not raw_title:
        tm = re.search(r"<title[^>]*>([^<]*)</title>", html, re.IGNORECASE)
        raw_title = tm.group(1) if tm else None
    meta_desc = _meta_content(html, "name", "description") or _meta_content(html, "property", "og:description")
    body = _extract_readable(html)
    text = re.sub(r"\s+", " ", " ".join(p for p in [(_decode_entities(meta_desc).strip() if meta_desc else ""), body] if p))[:4000]
    return {"title": _decode_entities((raw_title or url).strip()), "text": text, "source": host_of(url)}
