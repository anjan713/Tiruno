"""Realtime bus → UI. Port of ``worker/lib/bus.ts``.

Publishes each message on the ``rt:{uid}`` pub/sub channel (bridged to the
browser by ``/api/events`` SSE) and appends it to the capped ``events:{uid}``
stream. The message shape must match ``RtMessage`` so the client parses it.
"""

import json
from typing import Any, Dict

from redis.asyncio import Redis

from .util import now_ms


async def publish(redis: Redis, uid: str, msg: Dict[str, Any]) -> None:
    """Publish a realtime message (``at`` is stamped here, like the Node bus)."""
    full = {**msg, "at": now_ms()}
    payload = json.dumps(full)
    try:
        await redis.publish(f"rt:{uid}", payload)
        await redis.xadd(f"events:{uid}", {"data": payload}, maxlen=500, approximate=True)
    except Exception as e:  # noqa: BLE001
        print(f"[bus] publish failed: {e}")
