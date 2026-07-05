"""Worker-side job enqueue. Port of ``worker/lib/enqueue.ts`` / ``src/lib/jobs.ts``.

Lets agents kick off follow-up jobs (e.g. curator -> ingest_article) onto the
shared ``jobs:agent`` Redis Stream.
"""

import json

from redis.asyncio import Redis


async def enqueue(redis: Redis, job_type: str, payload: dict) -> str:
    job_id = await redis.xadd("jobs:agent", {"type": job_type, "payload": json.dumps(payload)})
    return job_id or ""
