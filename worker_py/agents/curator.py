"""Curator / Discovery agent. Port of ``worker/agents/curator.ts``.

Research a topic with the ``last30days`` skill, stream progress to the UI, and
persist ranked sources + a grounded synthesis under ``explore:{uid}:{jobId}``.
"""

import base64
import json
import os
import re
from typing import Any, Dict, List

from redis.asyncio import Redis

from ..agent import run_skill_agent
from ..bus import publish as bus_publish
from ..hermes import get_hermes
from ..jobs import enqueue
from ..loops.l1 import record_signal
from ..loops.l2 import propose_followups
from ..notebooklm import notebooklm_enabled
from ..rag import embed_batch, ensure_vector_index, index_material
from ..util import fire, now_ms


def _explore_key(uid: str, job_id: str) -> str:
    return f"explore:{uid}:{job_id}"


def _prompt(topic: str, hint: str) -> str:
    hint_block = f"\n{hint}\n" if hint else ""
    return (
        f'Use the **last30days** skill to research what people have actually said about "{topic}" '
        "over the last 30 days across Reddit, X, YouTube, Hacker News, GitHub, and the web — ranked by real engagement.\n"
        f"{hint_block}\n"
        "When you are done, respond with ONLY a single JSON object (no prose, no markdown code fences) of exactly this shape:\n"
        '{"sources":[{"title":"...","url":"https://...","source":"reddit|hackernews|youtube|github|x|web",'
        '"engagement":"e.g. 1.2k upvotes · 340 comments","snippet":"one short sentence on why it matters"}],'
        '"synthesis":"A grounded 4-6 sentence markdown summary of the current conversation, reflecting what the '
        'sources collectively show."}\n'
        "\n"
        "Include the 6-10 highest-engagement, most relevant items. Keep snippets to one sentence. "
        "Output the JSON object and nothing else."
    )


def _parse_result(text: str) -> Dict[str, Any]:
    """Best-effort extraction of the agent's final JSON result."""
    fallback = {"sources": [], "synthesis": (text or "").strip()[:1200]}
    if not text:
        return fallback
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    candidate = m.group(1) if m else text
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return fallback
    try:
        obj = json.loads(candidate[start : end + 1])
    except Exception:  # noqa: BLE001
        return fallback

    sources: List[Dict[str, str]] = []
    raw = obj.get("sources")
    if isinstance(raw, list):
        for s in raw:
            if isinstance(s, dict) and isinstance(s.get("title"), str):
                src = {
                    "title": str(s["title"]),
                    "url": str(s.get("url") or ""),
                    "source": str(s.get("source") or "web"),
                }
                if s.get("engagement"):
                    src["engagement"] = str(s["engagement"])
                if s.get("snippet"):
                    src["snippet"] = str(s["snippet"])
                sources.append(src)
    synthesis = obj["synthesis"] if isinstance(obj.get("synthesis"), str) else fallback["synthesis"]
    return {"sources": sources, "synthesis": synthesis}


async def run_explore(redis: Redis, job: Dict[str, str]) -> Dict[str, Any]:
    uid, job_id, topic = job["uid"], job["jobId"], job["topic"]
    key = _explore_key(uid, job_id)

    state: Dict[str, Any] = {
        "jobId": job_id,
        "uid": uid,
        "topic": topic,
        "status": "researching",
        "steps": ["Tiru is digging into the last 30 days…"],
        "sources": [],
        "synthesis": "",
        "followups": [],
        "createdAt": now_ms(),
        "updatedAt": now_ms(),
    }

    async def save() -> None:
        state["updatedAt"] = now_ms()
        await redis.set(key, json.dumps(state), ex=60 * 60 * 24)

    await save()
    await bus_publish(redis, uid, {"jobId": job_id, "type": "progress", "status": "researching", "step": state["steps"][0]})

    # Hermes: consult the evolved discovery strategy + learned skills.
    hermes = get_hermes(redis)
    strategy = await hermes.current_strategy(uid)
    strategy_hint = await hermes.strategy_hint(uid)
    skills_hint = await hermes.skills_hint(topic)
    hint = "\n".join(x for x in [strategy_hint, skills_hint] if x)

    def on_step(step: str) -> None:
        if not step or (state["steps"] and state["steps"][-1] == step):
            return
        state["steps"].append(step)
        fire(save())
        fire(bus_publish(redis, uid, {"jobId": job_id, "type": "progress", "status": "researching", "step": step}))

    res = await run_skill_agent(prompt=_prompt(topic, hint), skills=["last30days"], on_step=on_step)

    if not res.ok:
        state["status"] = "error"
        state["error"] = res.error or "Research failed"
        await save()
        await bus_publish(redis, uid, {"jobId": job_id, "type": "error", "status": "error", "error": state["error"]})
        return state

    parsed = _parse_result(res.text)
    sources, synthesis = parsed["sources"], parsed["synthesis"]
    state["status"] = "ready"
    state["sources"] = sources
    state["synthesis"] = synthesis
    state["steps"].append(f"Found {len(sources)} sources.")

    # Embed + index sources into the vector index for RAG / next-best-material.
    try:
        await ensure_vector_index(redis)
        vecs = await embed_batch([f"{s['title']}. {s.get('snippet') or ''}" for s in sources])
        for i, s in enumerate(sources):
            ident_src = (s.get("url") or s.get("title") or "").encode("utf-8")
            b64 = base64.urlsafe_b64encode(ident_src).decode("ascii").rstrip("=")[:24]
            await index_material(
                redis,
                {
                    "id": f"src-{b64}",
                    "kind": "source",
                    "refId": s.get("url", ""),
                    "title": s["title"],
                    "topic": topic,
                    "text": s.get("snippet") or s["title"],
                    "url": s.get("url", ""),
                },
                vecs[i],
            )
    except Exception as e:  # noqa: BLE001
        print(f"[curator] index sources failed: {e}")

    # Acquire -> ingest: feed the top discovered article URLs into NotebookLM so
    # they become grounded sources (podcast + lessons). Gated by NotebookLM being
    # enabled; opt out with NOTEBOOKLM_AUTO_INGEST=0. Dedup makes this idempotent.
    if notebooklm_enabled() and os.environ.get("NOTEBOOKLM_AUTO_INGEST") != "0":
        web_sources = [s for s in sources if re.match(r"^https?://", s.get("url") or "", re.IGNORECASE)][:5]
        for i, s in enumerate(web_sources):
            try:
                await enqueue(
                    redis,
                    "ingest_article",
                    {"uid": uid, "jobId": f"{job_id}-ing-{i}", "url": s["url"], "title": s.get("title", ""), "topic": topic, "notebook": "articles"},
                )
            except Exception as e:  # noqa: BLE001
                print(f"[curator] ingest enqueue failed: {e}")

    # L1: record the research as an interest signal. L2: propose follow-up topics.
    await record_signal(redis, uid, {"kind": "explore", "topic": topic})
    state["followups"] = await propose_followups(redis, uid, topic, sources, synthesis)

    await save()
    await bus_publish(
        redis,
        uid,
        {
            "jobId": job_id,
            "type": "done",
            "status": "ready",
            "result": {"sources": sources, "synthesis": synthesis, "followups": state["followups"]},
        },
    )

    # Hermes: record episodic memory, then reflect + evolve (best-effort).
    try:
        platforms = len({s.get("source") for s in sources})
        await hermes.record_episode(
            {
                "uid": uid,
                "task": "explore",
                "topic": topic,
                "strategyVersion": strategy["version"],
                "input": f'Research "{topic}" (explore {strategy["noveltyExplore"] * 100:.0f}%)',
                "output": f"{len(sources)} sources across {platforms} platforms; {len(state['followups'])} follow-ups proposed",
                "metrics": {"sources": len(sources), "platforms": platforms, "followups": len(state["followups"])},
            }
        )
        await hermes.reflect_and_evolve(uid)
    except Exception as e:  # noqa: BLE001
        print(f"[curator] hermes reflect failed: {e}")
    return state
