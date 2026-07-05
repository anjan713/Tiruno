"""Redis 8 / RediSearch vector index (HNSW + COSINE). Port of ``src/lib/rag/vector.ts``.

Uses ``execute_command`` for the raw FT.* commands so the schema and wire format
match exactly what the Node worker writes/reads (same ``idx:materials`` index).
"""

import struct
from typing import Dict, List, Optional

from redis.asyncio import Redis
from redis.exceptions import ResponseError

from .embeddings import EMBED_DIM

INDEX = "idx:materials"
PREFIX = "vec:"

# Ensure the index exists at most once per process.
_ensured = False


def float_buffer(vec: List[float]) -> bytes:
    """Pack a float vector into a little-endian FLOAT32 buffer for Redis."""
    return struct.pack(f"<{len(vec)}f", *vec)


async def ensure_vector_index(redis: Redis) -> None:
    """Create the HNSW vector index if it doesn't already exist. Idempotent."""
    global _ensured
    if _ensured:
        return
    try:
        await redis.execute_command(
            "FT.CREATE", INDEX,
            "ON", "HASH",
            "PREFIX", "1", PREFIX,
            "SCHEMA",
            "title", "TEXT",
            "topic", "TEXT",
            "kind", "TAG",
            "refId", "TEXT", "NOSTEM",
            "url", "TEXT", "NOSTEM",
            "text", "TEXT",
            "embedding", "VECTOR", "HNSW", "6",
            "TYPE", "FLOAT32",
            "DIM", str(EMBED_DIM),
            "DISTANCE_METRIC", "COSINE",
        )
        _ensured = True
    except ResponseError as e:
        if "Index already exists" in str(e):
            _ensured = True
            return
        raise


async def index_material(redis: Redis, m: Dict[str, str], vector: List[float]) -> None:
    """Upsert a material + its embedding into the vector index.

    ``m`` keys: id, kind, refId, title, topic, text, url(optional).
    """
    key = f"{PREFIX}{m['id']}"
    await redis.execute_command(
        "HSET", key,
        "title", m.get("title") or "",
        "topic", m.get("topic") or "",
        "kind", m["kind"],
        "refId", m.get("refId") or "",
        "url", m.get("url") or "",
        "text", (m.get("text") or "")[:4000],
        "embedding", float_buffer(vector),
    )


async def search_materials(
    redis: Redis,
    query_vec: List[float],
    k: int = 5,
    kind: Optional[str] = None,
) -> List[Dict[str, object]]:
    """KNN search: returns the k nearest materials to the query vector."""
    filt = f"@kind:{{{kind}}}" if kind else "*"
    query = f"({filt})=>[KNN {k} @embedding $BLOB AS score]"
    reply = await redis.execute_command(
        "FT.SEARCH", INDEX, query,
        "PARAMS", "2", "BLOB", float_buffer(query_vec),
        "SORTBY", "score", "ASC",
        "RETURN", "7", "score", "title", "topic", "kind", "refId", "url", "text",
        "DIALECT", "2",
        "LIMIT", "0", str(k),
    )

    hits: List[Dict[str, object]] = []
    if not isinstance(reply, (list, tuple)):
        return hits
    # reply: [count, key1, [f,v,f,v,...], key2, [...], ...]
    i = 1
    while i + 1 < len(reply):
        raw_id = str(reply[i])
        ident = raw_id[len(PREFIX):] if raw_id.startswith(PREFIX) else raw_id
        fields = reply[i + 1]
        f: Dict[str, str] = {}
        if isinstance(fields, (list, tuple)):
            for j in range(0, len(fields) - 1, 2):
                f[str(fields[j])] = str(fields[j + 1])
        try:
            distance = float(f.get("score", "1"))
        except ValueError:
            distance = 1.0
        hits.append(
            {
                "id": ident,
                "score": max(0.0, 1.0 - distance),  # cosine distance -> similarity
                "kind": f.get("kind", ""),
                "refId": f.get("refId", ""),
                "title": f.get("title", ""),
                "topic": f.get("topic", ""),
                "text": f.get("text", ""),
                "url": f.get("url", ""),
            }
        )
        i += 2
    return hits
