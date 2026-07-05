"""Small shared helpers."""

import asyncio
import time
from typing import Any, Coroutine, Set

# Keep references to fire-and-forget tasks so they aren't garbage-collected
# mid-flight. Mirrors the Node worker's `void save()` / `void bus.publish()`.
_bg_tasks: Set[asyncio.Task] = set()


def now_ms() -> int:
    """Epoch milliseconds — matches JS ``Date.now()``."""
    return int(time.time() * 1000)


def fire(coro: Coroutine[Any, Any, Any]) -> None:
    """Schedule a coroutine without awaiting it (best-effort side effect)."""
    try:
        task = asyncio.create_task(coro)
    except RuntimeError:
        # No running loop (shouldn't happen inside the worker) — drop silently.
        return
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
