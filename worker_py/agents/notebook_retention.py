"""Retention/rotation + engagement agents. Port of ``worker/agents/notebookRetention.ts``."""

from typing import Dict, Optional

from redis.asyncio import Redis

from ..bus import publish as bus_publish
from ..notebooklm import NotebookLMClient, notebooklm_config, retention
from ..util import now_ms

_NOTEBOOK_KINDS = ["articles", "courses"]


async def _evict_overflow(redis: Redis, client: NotebookLMClient, notebook: str) -> int:
    """Evict lowest-engagement (tiebreak soonest-expiry) sources over the cap."""
    cfg = client.cfg
    notebook_id = cfg.notebooks[notebook]
    count = await retention.source_count(redis, notebook_id)
    if count <= cfg.source_cap:
        return 0

    candidates = []
    for article_id in await retention.active_article_ids(redis):
        st = await retention.get_article_state(redis, article_id)
        if st and st.get("active") and st.get("notebook") == notebook and st.get("sourceId"):
            candidates.append(st)
    candidates.sort(key=lambda s: (s.get("score", 0), s.get("expiresAt", 0)))

    evicted = 0
    for st in candidates:
        if count <= cfg.source_cap:
            break
        try:
            await client.remove_source(notebook, st["sourceId"])
        except Exception as e:  # noqa: BLE001
            print(f"[notebook_cleanup] overflow remove failed: {e}")
        await retention.mark_removed(redis, st["articleId"], notebook_id)
        count -= 1
        evicted += 1
    return evicted


async def run_notebook_cleanup(redis: Redis, job: Optional[Dict] = None) -> Dict[str, int]:
    """Remove sources whose retention window has passed; keep the notebook under
    NotebookLM's per-notebook source cap. Safe to run on a timer."""
    job = job or {}
    cfg = notebooklm_config()
    if not cfg.enabled:
        if job.get("uid") and job.get("jobId"):
            await bus_publish(redis, job["uid"], {"jobId": job["jobId"], "type": "done", "status": "ready", "result": {"removed": 0, "skipped": True}})
        return {"removed": 0}

    client = NotebookLMClient(cfg)
    due = await retention.due_for_removal(redis, now_ms())
    removed = 0

    for article_id in due:
        st = await retention.get_article_state(redis, article_id)
        if st and st.get("sourceId"):
            try:
                await client.remove_source(st["notebook"], st["sourceId"])
            except Exception as e:  # noqa: BLE001
                print(f"[notebook_cleanup] remove failed: {e}")
        notebook_id = cfg.notebooks[st["notebook"]] if st else None
        await retention.mark_removed(redis, article_id, notebook_id)
        removed += 1

    # Then keep each notebook under its source cap (lowest-engagement evicted first).
    evicted = 0
    for notebook in _NOTEBOOK_KINDS:
        evicted += await _evict_overflow(redis, client, notebook)
    removed += evicted

    if job.get("uid") and job.get("jobId"):
        await bus_publish(redis, job["uid"], {"jobId": job["jobId"], "type": "done", "status": "ready", "result": {"removed": removed, "evicted": evicted}})
    return {"removed": removed}


async def run_record_engagement(redis: Redis, job: Dict) -> None:
    """A view/listen/good quiz score extends an article's retention window."""
    cfg = notebooklm_config()
    state = await retention.touch_engagement(redis, job["articleId"], job.get("score") or 50, cfg.retention_days)
    if job.get("uid") and job.get("jobId"):
        await bus_publish(
            redis,
            job["uid"],
            {
                "jobId": job["jobId"],
                "type": "done",
                "status": "ready",
                "result": {"articleId": job["articleId"], "status": (state or {}).get("status", "unknown"), "expiresAt": (state or {}).get("expiresAt")},
            },
        )
