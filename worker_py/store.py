"""Async Redis client factory. Mirrors ``src/lib/core/store`` (redis backend).

The Python worker always uses a *real* shared Redis — the in-memory adapter only
makes sense when the worker runs in the same process as the app, which is not the
case here. Configure with ``REDIS_URL`` or ``REDIS_HOST``/``REDIS_PORT``.

``decode_responses=True`` keeps all the JSON/string ops returning ``str``. Binary
vector blobs are still written correctly because request-side encoding accepts
raw ``bytes`` regardless of this flag (only responses are decoded), and the vector
index never returns the embedding field.
"""

import os

from redis.asyncio import Redis


def make_redis(blocking: bool = False) -> Redis:
    """Create an async Redis client.

    ``blocking`` documents that the client issues ``XREADGROUP ... BLOCK`` and
    should wait on idle reads (redis-py's default ``socket_timeout=None`` already
    does this; the flag is kept for parity with the Node worker).
    """
    url = os.environ.get("REDIS_URL")
    if url:
        return Redis.from_url(url, decode_responses=True)

    ssl = str(os.environ.get("REDIS_SSL", "")).lower() in ("true", "1")
    return Redis(
        host=os.environ.get("REDIS_HOST", "127.0.0.1"),
        port=int(os.environ.get("REDIS_PORT", "6379")),
        username=os.environ.get("REDIS_USERNAME") or None,
        password=os.environ.get("REDIS_PWD") or None,
        ssl=ssl,
        decode_responses=True,
    )
