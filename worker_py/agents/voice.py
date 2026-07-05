"""Voice agent. Port of ``worker/agents/voice.ts``.

Resolves the script to narrate and emits it for the client to speak via
Deepgram (/api/tts). Audio synthesis stays in the browser; this agent owns
selecting/shaping the narration text and recording the listen signal.
"""

import json
from typing import Dict

from redis.asyncio import Redis

from ..bus import publish as bus_publish
from ..loops.l1 import record_signal


async def run_narrate(redis: Redis, job: Dict[str, str]) -> None:
    uid, job_id = job["uid"], job["jobId"]
    text = (job.get("text") or "").strip()

    if not text and job.get("articleId"):
        try:
            raw = await redis.get(f"article:{job['articleId']}")
            if raw:
                a = json.loads(raw)
                text = str(a.get("summary") or a.get("text") or "").strip()
        except Exception:  # noqa: BLE001
            pass

    if not text:
        await bus_publish(redis, uid, {"jobId": job_id, "type": "error", "status": "error", "error": "Nothing to narrate"})
        return

    await record_signal(redis, uid, {"kind": "listen", "topic": job.get("topic")})
    await bus_publish(redis, uid, {"jobId": job_id, "type": "done", "status": "ready", "result": {"text": text[:1500]}})
