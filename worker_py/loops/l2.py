"""L2 — Self-evolving discovery + self-grading. Port of ``worker/loops/l2.ts``.

Candidate follow-ups are proposed here from a session; the yes/no reward and
versioned strategy/skill evolution are handled by the Hermes module.
"""

import json
import re
from typing import Any, Dict, List
from urllib.parse import urlparse

from redis.asyncio import Redis

from ..hermes import get_hermes
from ..util import now_ms

STOP = {
    "the", "and", "for", "with", "that", "this", "from", "what", "your", "you", "are", "how",
    "why", "new", "now", "best", "top", "vs", "use", "using", "into", "about", "over", "last",
    "days", "people", "say", "said", "want", "users", "guide", "tutorial",
}

_PHRASE_RE = re.compile(r"\b([A-Z][a-zA-Z0-9.+#]+(?:\s+[A-Z][a-zA-Z0-9.+#]+){0,2})\b")


def _suggestions_key(uid: str) -> str:
    return f"suggestions:{uid}"


def _seen_sources_key(uid: str) -> str:
    return f"seen_sources:{uid}"


def _seen_authors_key(uid: str) -> str:
    return f"seen_authors:{uid}"


async def propose_followups(
    redis: Redis,
    uid: str,
    topic: str,
    sources: List[Dict[str, Any]],
    synthesis: str,
) -> List[str]:
    """Lightweight follow-up extraction from source titles + synthesis (no LLM)."""
    text = " ".join([synthesis, *[f"{s.get('title', '')} {s.get('snippet') or ''}" for s in sources]])
    topic_words = set(re.split(r"\s+", topic.lower()))

    counts: Dict[str, int] = {}
    for m in _PHRASE_RE.finditer(text):
        phrase = m.group(1).strip()
        lower = phrase.lower()
        if len(phrase) < 3:
            continue
        if lower in topic_words:
            continue
        if all(w in STOP for w in re.split(r"\s+", lower)):
            continue
        counts[phrase] = counts.get(phrase, 0) + 1

    entries = [(p, c) for p, c in counts.items() if topic.lower() not in p.lower()]
    entries.sort(key=lambda x: x[1], reverse=True)  # stable: ties keep insertion order
    ranked = [p for p, _ in entries][:4]

    if ranked:
        try:
            entry = json.dumps({"topic": topic, "followups": ranked, "at": now_ms(), "outcome": "pending"})
            await redis.lpush(_suggestions_key(uid), entry)
            await redis.ltrim(_suggestions_key(uid), 0, 49)
            # Track sources we've shown so future discovery can favor novel ones.
            for s in sources:
                if s.get("source"):
                    await redis.sadd(_seen_sources_key(uid), s["source"].lower())
            for s in sources:
                try:
                    host = (urlparse(s.get("url") or "").hostname or "")
                    host = re.sub(r"^www\.", "", host)
                    if host:
                        await redis.sadd(_seen_authors_key(uid), host)
                except Exception:  # noqa: BLE001
                    continue
        except Exception:  # noqa: BLE001
            pass
    return ranked


async def record_suggestion_outcome(redis: Redis, uid: str, followup: str, accepted: bool) -> None:
    """Record the user's yes/no on a proposed follow-up (explicit reward signal)."""
    await get_hermes(redis).record_outcome(uid, followup, accepted)


async def run_curate(redis: Redis, uid: str) -> Dict[str, Any]:
    """Curator step: Hermes self-grades recent outcomes and writes a new versioned
    discovery strategy (+ optional learned skill + reflection) to the Vault."""
    return await get_hermes(redis).reflect_and_evolve(uid)
