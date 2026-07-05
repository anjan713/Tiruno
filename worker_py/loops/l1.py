"""L1 — Personalization loop. Port of ``worker/loops/l1.ts``.

Learns the user's level per topic from implicit signals and exposes a prompt
hint so generated content lands at the right depth. Keys: ``signals:{uid}``
(stream) and ``understanding:{uid}:{topic}`` (hash).
"""

from typing import Optional

from redis.asyncio import Redis

from ..util import now_ms

# Level = "eli5" | "intermediate" | "expert"
# SignalKind = answer_correct | answer_wrong | skip | replay | ask | explore | listen


def _signals_key(uid: str) -> str:
    return f"signals:{uid}"


def _understanding_key(uid: str, topic: str) -> str:
    return f"understanding:{uid}:{topic.lower()}"


def _num_str(v: float) -> str:
    """Match JS ``String(number)`` — integers have no trailing ``.0``."""
    return str(int(v)) if float(v).is_integer() else str(v)


async def record_signal(redis: Redis, uid: str, signal: dict) -> None:
    """Record a raw implicit signal onto the user's signal stream."""
    try:
        await redis.xadd(
            _signals_key(uid),
            {
                "kind": signal["kind"],
                "topic": signal.get("topic") or "",
                "meta": signal.get("meta") or "",
                "at": str(now_ms()),
            },
            maxlen=1000,
            approximate=True,
        )
    except Exception:  # noqa: BLE001
        pass


async def bump_understanding(redis: Redis, uid: str, topic: str, delta: float) -> float:
    """Nudge the understanding score for a topic. Score in [0,100]."""
    key = _understanding_key(uid, topic)
    try:
        cur = float((await redis.hget(key, "score")) or 40)
        nxt = max(0.0, min(100.0, cur + delta))
        await redis.hset(
            key,
            mapping={"score": _num_str(nxt), "topic": topic, "updatedAt": str(now_ms())},
        )
        return nxt
    except Exception:  # noqa: BLE001
        return 40.0


def score_to_level(score: float) -> str:
    if score < 33:
        return "eli5"
    if score < 67:
        return "intermediate"
    return "expert"


async def get_level(redis: Redis, uid: str, topic: str) -> str:
    """Current level for a topic (defaults to intermediate when unseen)."""
    try:
        score = float((await redis.hget(_understanding_key(uid, topic), "score")) or 50)
        return score_to_level(score)
    except Exception:  # noqa: BLE001
        return "intermediate"


def level_prompt_hint(level: str) -> str:
    """A short instruction injected into prompts to match the user's level."""
    if level == "eli5":
        return "Explain from first principles in plain language; define jargon; keep it simple and concrete."
    if level == "expert":
        return (
            "Assume strong background; be concise and technical; skip basics and focus on nuance, "
            "trade-offs, and what's new."
        )
    return "Assume some background; balance clarity with depth; briefly define non-obvious terms."
