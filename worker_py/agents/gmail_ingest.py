"""Gmail-ingestion agent. Port of ``worker/agents/gmailIngest.ts``.

Pull newsletter bodies (Gmail MCP, pluggable), then feed each into the NotebookLM
ingestion pipeline as an uploaded file source (emails are never added as URLs).
No-ops gracefully when Gmail isn't configured.
"""

import asyncio
import json
import os
import re
from typing import Dict, List, Optional

from redis.asyncio import Redis

from ..bus import publish as bus_publish
from .notebook_ingest import run_ingest_article


def _strip_html(s: str) -> str:
    s = re.sub(r"<style[\s\S]*?</style>", " ", s, flags=re.IGNORECASE)
    s = re.sub(r"<script[\s\S]*?</script>", " ", s, flags=re.IGNORECASE)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


async def _mock_newsletters(max_n: int) -> List[dict]:
    msgs = [
        {
            "id": "mock-nl-1",
            "subject": "TLDR — Postgres 17 ships incremental backups",
            "from": "TLDR <dan@tldrnewsletter.com>",
            "body": "Postgres 17 introduces incremental backups via pg_basebackup, cutting backup time and storage for large databases. The walsummarizer process tracks changed blocks so only deltas are copied. Logical replication also gains failover slot support.",
        },
        {
            "id": "mock-nl-2",
            "subject": "Bytes — Why your bundle is slow",
            "from": "Bytes <hello@bytes.dev>",
            "body": "Tree-shaking only works on ES modules with no side effects. Mark packages sideEffects:false, prefer named imports, and audit with source-map-explorer. Dynamic import() splits routes so the initial payload stays small.",
        },
    ]
    return msgs[: max(0, max_n)]


async def _cli_newsletters(cmd: str, max_n: int) -> List[dict]:
    binary, *base = cmd.split()
    args = [*base, "--max", str(max_n), "--json"]
    try:
        proc = await asyncio.create_subprocess_exec(
            binary, *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        out, _err = await asyncio.wait_for(proc.communicate(), timeout=60)
        if proc.returncode != 0:
            return []
        raw = (out or b"").decode("utf-8", "ignore")
        obj = json.loads(raw[raw.find("{") : raw.rfind("}") + 1])
        msgs = obj.get("messages") if isinstance(obj, dict) else None
        out_list: List[dict] = []
        if isinstance(msgs, list):
            for i, m in enumerate(msgs):
                if isinstance(m, dict):
                    out_list.append(
                        {
                            "id": str(m.get("id") or f"gmail-{i}"),
                            "subject": str(m.get("subject") or "Newsletter"),
                            "from": str(m.get("from") or ""),
                            "body": _strip_html(str(m.get("body") or m.get("text") or m.get("html") or "")),
                        }
                    )
        return out_list
    except Exception:  # noqa: BLE001
        return []


async def _fetch_newsletters(max_n: int) -> Optional[tuple]:
    """Returns (provider_name, messages) or None if Gmail isn't configured."""
    if os.environ.get("GMAIL_MOCK") == "1":
        return "mock", await _mock_newsletters(max_n)
    cmd = (os.environ.get("GMAIL_CMD") or "").strip()
    if os.environ.get("GMAIL_ENABLED") == "1" and cmd:
        return "cli", await _cli_newsletters(cmd, max_n)
    return None


async def run_ingest_gmail(redis: Redis, job: Dict) -> None:
    uid, job_id = job["uid"], job["jobId"]
    await bus_publish(redis, uid, {"jobId": job_id, "type": "progress", "status": "researching", "step": "Checking your inbox…"})

    max_n = max(1, min(20, job.get("max") or 5))
    fetched = await _fetch_newsletters(max_n)

    if fetched is None:
        await bus_publish(
            redis,
            uid,
            {
                "jobId": job_id,
                "type": "done",
                "status": "ready",
                "result": {"ingested": 0, "reason": "Gmail not configured (set GMAIL_MOCK=1 or GMAIL_ENABLED=1 + GMAIL_CMD)"},
            },
        )
        return

    provider_name, messages = fetched
    seen_key = f"notebook:gmail:seen:{uid}"
    article_ids: List[str] = []
    skipped = 0

    for i, m in enumerate(messages):
        body = _strip_html(m.get("body", ""))
        if not body or len(body) < 40:
            continue
        # Dedup: never re-ingest a message we've already processed.
        if await redis.sismember(seen_key, m["id"]):
            skipped += 1
            continue
        await bus_publish(redis, uid, {"jobId": job_id, "type": "progress", "step": f"Ingesting \"{m['subject']}\"…"})
        # Stable articleId per message → idempotent across runs.
        await run_ingest_article(
            redis,
            {"uid": uid, "jobId": f"{job_id}-m{i}", "articleId": f"gmail-{m['id']}", "title": m["subject"], "text": body, "topic": "Newsletter", "email": True},
        )
        await redis.sadd(seen_key, m["id"])
        article_ids.append(f"gmail-{m['id']}")

    await bus_publish(
        redis,
        uid,
        {"jobId": job_id, "type": "done", "status": "ready", "result": {"ingested": len(article_ids), "skipped": skipped, "via": provider_name, "articleIds": article_ids}},
    )
