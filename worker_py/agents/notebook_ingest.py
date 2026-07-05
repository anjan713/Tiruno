"""NotebookLM ingestion agent. Port of ``worker/agents/notebookIngest.ts``.

Per-article state machine: discovered -> ingested (source added) -> assets
(podcast + lesson/MCQ). Clean public URLs become URL sources; emails/paywalled
pages are written to disk and uploaded as file sources. No-ops gracefully when
NotebookLM is off.
"""

import hashlib
import json
import os
from typing import Any, Dict, Optional

from redis.asyncio import Redis

from ..articles import fetch_article, gen_id, get_article, host_of, index_article_vector, save_article
from ..bus import publish as bus_publish
from ..loops.l1 import record_signal
from ..notebooklm import NotebookLMClient, notebooklm_config, retention
from ..util import now_ms
from .lesson import run_generate_lesson


def _podcast_key(article_id: str) -> str:
    return f"podcast:{article_id}"


def _url_key(url: str) -> str:
    """Maps a source URL to the articleId we already created for it (URL-level dedup)."""
    return f"notebook:url:{hashlib.sha1(url.encode('utf-8')).hexdigest()[:16]}"


async def _resolve_article(redis: Redis, job: Dict[str, Any]) -> Optional[dict]:
    if job.get("articleId"):
        existing = await get_article(redis, job["articleId"])
        if existing:
            return existing
    # URL-level dedup: reuse the article we already created for this URL.
    if job.get("url") and not job.get("articleId"):
        mapped = await redis.get(_url_key(job["url"]))
        if mapped:
            existing = await get_article(redis, mapped)
            if existing:
                return existing
    if not job.get("url") and not job.get("text"):
        return None

    title = (job.get("title") or "").strip()
    text = (job.get("text") or "").strip()
    source = host_of(job["url"]) if job.get("url") else "email"
    if job.get("url") and not text:
        try:
            fetched = await fetch_article(job["url"])
            text = fetched["text"]
            title = title or fetched["title"]
            source = fetched["source"]
        except Exception:  # noqa: BLE001
            pass

    article = {
        "id": job.get("articleId") or gen_id(),
        "url": job.get("url"),
        "title": title or job.get("url") or "Untitled",
        "source": source,
        "topic": (job.get("topic") or "").strip() or "General",
        "text": text,
        "summary": "",
        "status": "ready",
        "ready": True,
        "kind": "bookmark",
        "addedAt": now_ms(),
    }
    await save_article(redis, article)
    if article.get("url"):
        await redis.set(_url_key(article["url"]), article["id"], ex=60 * 60 * 24 * 90)
    return article


async def _ensure_capacity(redis: Redis, client: NotebookLMClient, notebook: str) -> None:
    """Free notebook slots under the per-notebook cap. Evicts the lowest-engagement
    sources first (tiebreak: soonest-expiring), so engaged material survives."""
    cfg = client.cfg
    notebook_id = cfg.notebooks[notebook]
    count = await retention.source_count(redis, notebook_id)
    if count < cfg.source_cap:
        return

    candidates = []
    for article_id in await retention.active_article_ids(redis):
        st = await retention.get_article_state(redis, article_id)
        if st and st.get("active") and st.get("notebook") == notebook and st.get("sourceId"):
            candidates.append(st)
    # Lowest score first; among equal scores, the soonest to expire goes first.
    candidates.sort(key=lambda s: (s.get("score", 0), s.get("expiresAt", 0)))

    for st in candidates:
        if count < cfg.source_cap:
            break
        try:
            await client.remove_source(notebook, st["sourceId"])
        except Exception:  # noqa: BLE001
            pass
        await retention.mark_removed(redis, st["articleId"], notebook_id)
        count -= 1


async def run_ingest_article(redis: Redis, job: Dict[str, Any]) -> None:
    uid, job_id = job["uid"], job["jobId"]
    cfg = notebooklm_config()
    notebook = job.get("notebook") or "articles"

    if not cfg.enabled:
        await bus_publish(redis, uid, {"jobId": job_id, "type": "done", "status": "ready", "result": {"skipped": True, "reason": "NotebookLM disabled"}})
        return

    try:
        await bus_publish(redis, uid, {"jobId": job_id, "type": "progress", "status": "researching", "step": "Preparing source…"})

        article = await _resolve_article(redis, job)
        if not article:
            await bus_publish(redis, uid, {"jobId": job_id, "type": "error", "status": "error", "error": "No article to ingest"})
            return

        prior = await retention.record_discovered(redis, article["id"], notebook)
        # Dedup: if this article already has a live source, don't re-add it.
        if not job.get("force") and prior.get("active") and prior.get("sourceId") and prior.get("status") != "removed":
            await bus_publish(
                redis,
                uid,
                {
                    "jobId": job_id,
                    "type": "done",
                    "status": "ready",
                    "result": {"deduped": True, "articleId": article["id"], "notebook": notebook, "sourceId": prior["sourceId"], "status": prior["status"]},
                },
            )
            return
        client = NotebookLMClient(cfg)
        await _ensure_capacity(redis, client, notebook)

        use_file = job.get("email") is True or not article.get("url")
        if use_file:
            os.makedirs(cfg.data_dir, exist_ok=True)
            file_path = os.path.join(cfg.data_dir, f"{article['id']}.md")
            md = f"# {article['title']}\n\n_Source: {article['source']}_\n\n{article['text']}\n"
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(md)
            await bus_publish(redis, uid, {"jobId": job_id, "type": "progress", "step": "Uploading file source…"})
            source_id = (await client.upload_file_source(notebook, file_path, article["title"]))["id"]
        else:
            await bus_publish(redis, uid, {"jobId": job_id, "type": "progress", "step": "Adding URL source…"})
            source_id = (await client.add_url_source(notebook, article["url"], article["title"]))["id"]

        await retention.record_ingested(
            redis,
            article_id=article["id"],
            notebook=notebook,
            source_id=source_id,
            source_kind="file" if use_file else "url",
            url=article.get("url"),
            notebook_id=cfg.notebooks[notebook],
            retention_days=cfg.retention_days,
        )

        assets = []

        try:
            await bus_publish(redis, uid, {"jobId": job_id, "type": "progress", "step": "Generating podcast…"})
            audio = await client.generate_audio_overview(notebook, [source_id])
            await redis.set(
                _podcast_key(article["id"]),
                json.dumps({"url": audio["audioUrl"], "status": audio["status"], "at": now_ms()}),
                ex=60 * 60 * 24 * 30,
            )
            assets.append({"kind": "podcast", "url": audio["audioUrl"], "at": now_ms()})
        except Exception as e:  # noqa: BLE001
            print(f"[notebook_ingest] podcast failed: {e}")

        try:
            await bus_publish(redis, uid, {"jobId": job_id, "type": "progress", "step": "Writing lesson + MCQs…"})
            lesson_job_id = f"{job_id}-lesson"
            await run_generate_lesson(redis, {"uid": uid, "jobId": lesson_job_id, "topic": article["topic"], "articleId": article["id"]})
            lesson_id = f"gen-{lesson_job_id}"
            assets.append({"kind": "lesson", "refId": lesson_id, "at": now_ms()})
            assets.append({"kind": "mcq", "refId": lesson_id, "at": now_ms()})
        except Exception as e:  # noqa: BLE001
            print(f"[notebook_ingest] lesson failed: {e}")

        await retention.record_assets(redis, article["id"], assets)
        await index_article_vector(redis, article)
        await record_signal(redis, uid, {"kind": "explore", "topic": article["topic"]})

        await bus_publish(
            redis,
            uid,
            {
                "jobId": job_id,
                "type": "done",
                "status": "ready",
                "result": {
                    "articleId": article["id"],
                    "notebook": notebook,
                    "sourceId": source_id,
                    "sourceKind": "file" if use_file else "url",
                    "assets": assets,
                },
            },
        )
    except Exception as e:  # noqa: BLE001
        await bus_publish(redis, uid, {"jobId": job_id, "type": "error", "status": "error", "error": str(e)})
