"""Per-article retention state. Port of ``src/lib/core/notebooklm/retention.ts``.

NotebookLM caps sources per notebook (~50), so each ingested article is tracked
with an expiry. Engagement extends the window; a cleanup job removes sources
whose window has passed (or the soonest-expiring ones when over the cap).

Redis keys:
  notebook:articles:{articleId}  -> JSON state
  notebook:articles:expiry       -> ZSET member=articleId score=expiresAt(ms)
  notebook:sources:{notebookId}  -> SET of sourceIds (cap counting)
"""

import json
from typing import List, Optional

from redis.asyncio import Redis

from ..util import now_ms

EXPIRY_INDEX = "notebook:articles:expiry"
_DAY_MS = 24 * 60 * 60 * 1000
_STATE_TTL_S = 60 * 60 * 24 * 60  # keep state 60d for audit even after removal


def _state_key(article_id: str) -> str:
    return f"notebook:articles:{article_id}"


def _source_set(notebook_id: str) -> str:
    return f"notebook:sources:{notebook_id}"


async def get_article_state(redis: Redis, article_id: str) -> Optional[dict]:
    raw = await redis.get(_state_key(article_id))
    return json.loads(raw) if raw else None


async def _save(redis: Redis, state: dict) -> dict:
    state["updatedAt"] = now_ms()
    await redis.set(_state_key(state["articleId"]), json.dumps(state), ex=_STATE_TTL_S)
    if state["active"]:
        await redis.zadd(EXPIRY_INDEX, {state["articleId"]: state["expiresAt"]})
    else:
        await redis.zrem(EXPIRY_INDEX, state["articleId"])
    return state


async def record_discovered(redis: Redis, article_id: str, notebook: str = "articles") -> dict:
    existing = await get_article_state(redis, article_id)
    if existing:
        return existing
    now = now_ms()
    return await _save(
        redis,
        {
            "articleId": article_id,
            "notebook": notebook,
            "status": "discovered",
            "active": False,
            "assets": [],
            "score": 0,
            "addedAt": now,
            "expiresAt": now,
            "updatedAt": now,
        },
    )


async def record_ingested(
    redis: Redis,
    *,
    article_id: str,
    notebook: str,
    source_id: str,
    source_kind: str,
    notebook_id: str,
    retention_days: int,
    url: Optional[str] = None,
) -> dict:
    now = now_ms()
    prev = await get_article_state(redis, article_id)
    state = {
        "articleId": article_id,
        "notebook": notebook,
        "sourceId": source_id,
        "sourceKind": source_kind,
        "url": url,
        "status": "ingested",
        "active": True,
        "assets": (prev or {}).get("assets", []),
        "score": (prev or {}).get("score", 0),
        "addedAt": (prev or {}).get("addedAt", now),
        "expiresAt": now + retention_days * _DAY_MS,
        "updatedAt": now,
    }
    await redis.sadd(_source_set(notebook_id), source_id)
    return await _save(redis, state)


async def record_assets(redis: Redis, article_id: str, assets: List[dict]) -> Optional[dict]:
    state = await get_article_state(redis, article_id)
    if not state:
        return None
    state["assets"] = [*state.get("assets", []), *assets]
    state["status"] = "assets"
    return await _save(redis, state)


async def touch_engagement(redis: Redis, article_id: str, score: float, retention_days: int) -> Optional[dict]:
    state = await get_article_state(redis, article_id)
    if not state or not state.get("active"):
        return state
    state["score"] = max(state.get("score", 0), round(score))
    state["status"] = "engaged"
    state["expiresAt"] = now_ms() + retention_days * _DAY_MS
    return await _save(redis, state)


async def due_for_removal(redis: Redis, now: Optional[int] = None) -> List[str]:
    return await redis.zrangebyscore(EXPIRY_INDEX, 0, now if now is not None else now_ms())


async def active_article_ids(redis: Redis) -> List[str]:
    return await redis.zrange(EXPIRY_INDEX, 0, -1)


async def mark_removed(redis: Redis, article_id: str, notebook_id: Optional[str] = None) -> None:
    state = await get_article_state(redis, article_id)
    await redis.zrem(EXPIRY_INDEX, article_id)
    if not state:
        return
    if notebook_id and state.get("sourceId"):
        await redis.srem(_source_set(notebook_id), state["sourceId"])
    state["active"] = False
    state["status"] = "removed"
    await _save(redis, state)


async def source_count(redis: Redis, notebook_id: str) -> int:
    return await redis.scard(_source_set(notebook_id))
