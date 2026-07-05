"""Worker entry point + job loop. Port of ``worker/index.ts``.

Consumes the ``jobs:agent`` stream as a member of the ``workers`` consumer group
(``XREADGROUP ... BLOCK``), routes each job to the right agent, and ``XACK``s it.
Drop-in compatible with the Node worker — they can even run side by side on the
same group (jobs are load-balanced between consumers).
"""

import asyncio
import json
import os
import time
from typing import Any, Dict

from redis.asyncio import Redis

from .agents.curator import run_explore
from .agents.gmail_ingest import run_ingest_gmail
from .agents.learning_path import run_rebuild_path
from .agents.lesson import run_generate_lesson
from .agents.notebook_ingest import run_ingest_article
from .agents.notebook_retention import run_notebook_cleanup, run_record_engagement
from .agents.orchestrator import run_orchestrate
from .agents.voice import run_narrate
from .config import CONSUMER, GROUP, STREAM, load_env
from .jobs import enqueue
from .loops.l1 import bump_understanding, record_signal
from .loops.l2 import run_curate
from .notebooklm import notebooklm_enabled
from .rag import ensure_vector_index
from .store import make_redis


DEAD_STREAM = "jobs:agent:dead"
MAX_ATTEMPTS = max(1, int(os.environ.get("WORKER_MAX_ATTEMPTS") or "3"))


def _fields_to_job(entry_id: str, fields: Dict[str, str]) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}
    try:
        raw = fields.get("payload")
        payload = json.loads(raw) if raw else {}
    except Exception:  # noqa: BLE001
        payload = {}
    return {
        "type": fields.get("type", "unknown"),
        "payload": payload,
        "id": entry_id,
        "attempt": int(fields.get("attempt", 0) or 0),
    }


async def handle_failure(redis: Redis, job: Dict[str, Any], error: str) -> None:
    """Retry by re-enqueuing with an incremented attempt count (small backoff);
    after MAX_ATTEMPTS route the job to the dead-letter stream."""
    next_attempt = job["attempt"] + 1
    payload = json.dumps(job["payload"])
    if next_attempt < MAX_ATTEMPTS:
        await asyncio.sleep(min(5.0, 0.25 * 2 ** job["attempt"]))
        await redis.xadd(STREAM, {"type": job["type"], "payload": payload, "attempt": str(next_attempt)})
        print(f"[worker] retry {next_attempt}/{MAX_ATTEMPTS - 1} for type={job['type']}")
    else:
        await redis.xadd(
            DEAD_STREAM,
            {"type": job["type"], "payload": payload, "error": error, "attempts": str(next_attempt)},
            maxlen=1000,
            approximate=True,
        )
        print(f"[worker] dead-lettered type={job['type']} after {next_attempt} attempts")


async def route(redis: Redis, job: Dict[str, Any]) -> None:
    """Code Router (deterministic): map routine jobs straight to the right agent."""
    payload = job["payload"]
    uid = str(payload.get("uid", "demo"))
    job_id = str(payload.get("jobId", ""))
    t = job["type"]

    if t in ("explore", "find_articles"):
        await run_explore(redis, {"uid": uid, "jobId": job_id, "topic": str(payload.get("topic", ""))})
    elif t == "orchestrate":
        await run_orchestrate(redis, {"uid": uid, "jobId": job_id, "request": str(payload.get("request", ""))})
    elif t == "rebuild_path":
        await run_rebuild_path(redis, {"uid": uid, "jobId": job_id})
    elif t in ("narrate", "make_digest"):
        await run_narrate(
            redis,
            {
                "uid": uid,
                "jobId": job_id,
                "text": str(payload["text"]) if payload.get("text") else None,
                "articleId": str(payload["articleId"]) if payload.get("articleId") else None,
                "topic": str(payload["topic"]) if payload.get("topic") else None,
            },
        )
    elif t == "signal":
        await record_signal(
            redis,
            uid,
            {
                "kind": str(payload.get("kind", "ask")),
                "topic": str(payload["topic"]) if payload.get("topic") else None,
                "meta": str(payload["meta"]) if payload.get("meta") else None,
            },
        )
        if payload.get("topic") and isinstance(payload.get("delta"), (int, float)) and not isinstance(payload.get("delta"), bool):
            await bump_understanding(redis, uid, str(payload["topic"]), float(payload["delta"]))
    elif t == "curate":
        await run_curate(redis, uid)
    elif t == "generate_lesson":
        gen_job: Dict[str, str] = {"uid": uid, "jobId": job_id, "topic": str(payload.get("topic", ""))}
        if payload.get("articleId"):
            gen_job["articleId"] = str(payload["articleId"])
        await run_generate_lesson(redis, gen_job)
    elif t == "ingest_article":
        await run_ingest_article(
            redis,
            {
                "uid": uid,
                "jobId": job_id,
                "articleId": str(payload["articleId"]) if payload.get("articleId") else None,
                "url": str(payload["url"]) if payload.get("url") else None,
                "title": str(payload["title"]) if payload.get("title") else None,
                "topic": str(payload["topic"]) if payload.get("topic") else None,
                "text": str(payload["text"]) if payload.get("text") else None,
                "email": payload.get("email") is True or payload.get("email") == "true",
                "force": payload.get("force") is True or payload.get("force") == "true",
                "notebook": "courses" if payload.get("notebook") == "courses" else "articles",
            },
        )
    elif t == "ingest_gmail":
        await run_ingest_gmail(redis, {"uid": uid, "jobId": job_id, "max": payload.get("max") if isinstance(payload.get("max"), int) else None})
    elif t == "notebook_cleanup":
        await run_notebook_cleanup(redis, {"uid": uid, "jobId": job_id})
    elif t == "notebook_engagement":
        await run_record_engagement(
            redis,
            {
                "uid": uid,
                "jobId": job_id,
                "articleId": str(payload.get("articleId", "")),
                "score": payload.get("score") if isinstance(payload.get("score"), (int, float)) and not isinstance(payload.get("score"), bool) else None,
            },
        )
    else:
        print(f"[worker] unknown job type '{t}'")


async def ensure_group(redis: Redis) -> None:
    try:
        await redis.xgroup_create(STREAM, GROUP, id="$", mkstream=True)
        print(f"[worker] created consumer group '{GROUP}' on '{STREAM}'")
    except Exception as e:  # noqa: BLE001
        if "BUSYGROUP" not in str(e):
            raise


async def _periodic(redis: Redis, job_type: str, payload_fn, interval_s: float) -> None:
    while True:
        await asyncio.sleep(interval_s)
        try:
            await enqueue(redis, job_type, payload_fn())
        except Exception as e:  # noqa: BLE001
            print(f"[worker] {job_type} schedule failed: {e}")


def start_scheduler(redis: Redis) -> None:
    """Periodic NotebookLM maintenance: notebook_cleanup (rotation) every
    NOTEBOOKLM_CLEANUP_INTERVAL_MS (default 1h; 0 disables) and optional Gmail
    polling every GMAIL_POLL_INTERVAL_MS (default off). Jobs go on the shared
    stream so any worker in the group can pick them up."""
    if not notebooklm_enabled():
        return

    cleanup_ms = int(os.environ.get("NOTEBOOKLM_CLEANUP_INTERVAL_MS") or "3600000")
    if cleanup_ms > 0:
        asyncio.create_task(
            _periodic(redis, "notebook_cleanup", lambda: {"uid": "system", "jobId": f"cleanup-{int(time.time() * 1000)}"}, cleanup_ms / 1000)
        )
        print(f"[worker] scheduled notebook_cleanup every {cleanup_ms}ms")

    gmail_ms = int(os.environ.get("GMAIL_POLL_INTERVAL_MS") or "0")
    if gmail_ms > 0:
        asyncio.create_task(
            _periodic(redis, "ingest_gmail", lambda: {"uid": "demo", "jobId": f"gmail-{int(time.time() * 1000)}"}, gmail_ms / 1000)
        )
        print(f"[worker] scheduled ingest_gmail every {gmail_ms}ms")


async def run() -> None:
    redis = make_redis(blocking=True)
    await ensure_group(redis)
    try:
        await ensure_vector_index(redis)
        print("[worker] vector index ready (idx:materials)")
    except Exception as e:  # noqa: BLE001
        print(f"[worker] vector index unavailable: {e}")
    start_scheduler(redis)
    print(f"[worker] up — consuming '{STREAM}' as '{CONSUMER}'. Waiting for jobs…")

    while True:
        try:
            resp = await redis.xreadgroup(GROUP, CONSUMER, {STREAM: ">"}, count=5, block=5000)
        except Exception as e:  # noqa: BLE001
            print(f"[worker] read error: {e}")
            await asyncio.sleep(1)
            continue
        if not resp:
            continue

        # resp: [ (stream, [ (id, {k: v, ...}), ... ]) ]
        for _stream_name, entries in resp:
            for entry_id, fields in entries:
                job = _fields_to_job(entry_id, fields)
                attempt_suffix = f" (attempt {job['attempt']})" if job["attempt"] else ""
                print(f"[worker] job {entry_id} type={job['type']}{attempt_suffix}")
                try:
                    await route(redis, job)
                except Exception as e:  # noqa: BLE001
                    print(f"[worker] job {entry_id} failed: {e}")
                    try:
                        await handle_failure(redis, job, str(e))
                    except Exception as re:  # noqa: BLE001
                        print(f"[worker] retry/dead-letter failed: {re}")
                finally:
                    await redis.xack(STREAM, GROUP, entry_id)


def main() -> None:
    load_env()
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("\n[worker] shutting down.")


if __name__ == "__main__":
    main()
