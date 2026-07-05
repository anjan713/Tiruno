"""Lesson-generation agent. Port of ``worker/agents/lesson.ts``.

Retrieve grounding material (RAG, NotebookLM-pluggable), author a level-matched
micro-lesson, persist it under ``lesson:gen:{id}`` and index it for reuse.
"""

import json
import re
from typing import Any, Dict, List, Optional

from redis.asyncio import Redis

from ..agent import run_skill_agent
from ..bus import publish as bus_publish
from ..loops.l1 import get_level, level_prompt_hint, record_signal
from ..rag import embed, ensure_vector_index, index_material, search_materials
from ..summarize import notebooklm_summarize
from ..util import now_ms


def _lesson_key(lid: str) -> str:
    return f"lesson:gen:{lid}"


def _job_key(job_id: str) -> str:
    return f"lessonjob:{job_id}"


def _prompt(topic: str, level_hint: str, grounding: str) -> str:
    material = grounding[:6000] or "(no extra material retrieved; use well-established fundamentals)"
    return (
        f'You are Tiruno\'s lesson author. Write a short, accurate micro-lesson on "{topic}" for a learner.\n'
        f"{level_hint}\n\n"
        "Ground every claim in this source material. Do not invent facts beyond it; where it's thin, "
        "rely on well-established fundamentals of the topic:\n"
        "---\n"
        f"{material}\n"
        "---\n\n"
        "Respond with ONLY one JSON object (no prose, no code fences) of exactly this shape:\n"
        '{"title":"...","concept":"a 3-5 sentence plain-language explanation a tutor would say aloud",'
        '"questions":[{"prompt":"...","options":["..","..","..",".."],"answer":0,'
        '"explanation":"one sentence on why the correct option is right","citation":"short source label"}]}\n\n'
        'Include exactly 5 questions. Each question must have exactly 4 options and "answer" as the 0-based '
        "index of the correct option. Keep it tight and demo-sized."
    )


def _parse_json_obj(text: str, fallback: Dict[str, Any]) -> Dict[str, Any]:
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text or "", re.IGNORECASE)
    c = m.group(1) if m else (text or "")
    start = c.find("{")
    end = c.rfind("}")
    if start == -1 or end == -1:
        return fallback
    try:
        return json.loads(c[start : end + 1])
    except Exception:  # noqa: BLE001
        return fallback


async def _gather_grounding(redis: Redis, topic: str, article_id: Optional[str] = None) -> str:
    """Build grounding context from a specific article or via RAG retrieval."""
    if article_id:
        try:
            raw = await redis.get(f"article:{article_id}")
            if raw:
                a = json.loads(raw)
                return "\n\n".join(x for x in [a.get("title"), a.get("summary"), a.get("text")] if x)
        except Exception:  # noqa: BLE001
            pass
    try:
        await ensure_vector_index(redis)
        vec = await embed(topic)
        hits = await search_materials(redis, vec, 5)
        return "\n\n".join(f"{h['title']} ({h['topic']}). {h['text']}" for h in hits)
    except Exception:  # noqa: BLE001
        return ""


async def run_generate_lesson(redis: Redis, job: Dict[str, str]) -> None:
    uid, job_id = job["uid"], job["jobId"]
    topic = (job.get("topic") or "").strip() or "this topic"
    article_id = job.get("articleId")
    lid = f"gen-{job_id}"

    async def set_job(status: str, extra: Optional[Dict[str, Any]] = None) -> None:
        await redis.set(
            _job_key(job_id),
            json.dumps({"jobId": job_id, "status": status, **(extra or {})}),
            ex=60 * 60 * 24,
        )

    await set_job("working")
    await bus_publish(redis, uid, {"jobId": job_id, "type": "progress", "status": "researching", "step": "Gathering material…"})

    grounding = await _gather_grounding(redis, topic, article_id)
    # NotebookLM grounding hook (pluggable; returns None unless enabled).
    try:
        nb = await notebooklm_summarize(grounding, topic)
        if nb:
            grounding = f"{nb}\n\n{grounding}"
    except Exception:  # noqa: BLE001
        pass

    level = await get_level(redis, uid, topic)
    await bus_publish(redis, uid, {"jobId": job_id, "type": "progress", "step": "Writing your lesson…"})

    res = await run_skill_agent(
        prompt=_prompt(topic, level_prompt_hint(level), grounding),
        skills=[],
        max_turns=6,
        on_step=lambda step: bus_publish_step(redis, uid, job_id, step),
    )

    if not res.ok:
        await set_job("error", {"error": res.error or "generation failed"})
        await bus_publish(redis, uid, {"jobId": job_id, "type": "error", "status": "error", "error": res.error or "Lesson generation failed"})
        return

    parsed = _parse_json_obj(res.text, {})
    valid = [
        q
        for q in (parsed.get("questions") or [])
        if isinstance(q, dict) and q.get("prompt") and isinstance(q.get("options"), list) and len(q["options"]) >= 2
    ]
    questions: List[Dict[str, Any]] = []
    for i, q in enumerate(valid[:5]):
        options = [str(o) for o in q["options"][:4]]
        opt_len = len(q["options"]) or 1
        try:
            ans_num = int(float(q.get("answer")))
        except (TypeError, ValueError):
            ans_num = 0
        answer = max(0, min(opt_len - 1, ans_num))
        questions.append(
            {
                "id": f"q{i + 1}",
                "prompt": str(q["prompt"]),
                "options": options,
                "answer": answer,
                "explanation": str(q.get("explanation") or ""),
                "citation": str(q.get("citation") or "Generated by Tiru"),
            }
        )

    if not questions:
        await set_job("error", {"error": "no questions produced"})
        await bus_publish(redis, uid, {"jobId": job_id, "type": "error", "status": "error", "error": "Couldn't build a lesson — try a different topic."})
        return

    lesson = {
        "id": lid,
        "title": str(parsed.get("title") or f"A lesson on {topic}"),
        "topic": topic,
        "concept": str(parsed.get("concept") or ""),
        "questions": questions,
        "generated": True,
        "createdAt": now_ms(),
        # Set when authored from an ingested article (engagement linkage).
        **({"articleId": article_id} if article_id else {}),
    }

    await redis.set(_lesson_key(lid), json.dumps(lesson), ex=60 * 60 * 24 * 7)

    # Index the new lesson so it can be recommended as "next-best material".
    try:
        vec = await embed(f"{lesson['title']}. {lesson['concept']}")
        await index_material(
            redis,
            {"id": lid, "kind": "lesson", "refId": lid, "title": lesson["title"], "topic": topic, "text": lesson["concept"]},
            vec,
        )
    except Exception:  # noqa: BLE001
        pass

    await record_signal(redis, uid, {"kind": "explore", "topic": topic})
    await set_job("ready", {"lessonId": lid, "title": lesson["title"]})
    await bus_publish(
        redis,
        uid,
        {"jobId": job_id, "type": "done", "status": "ready", "result": {"lessonId": lid, "title": lesson["title"], "topic": topic}},
    )


def bus_publish_step(redis: Redis, uid: str, job_id: str, step: str) -> None:
    """Sync ``on_step`` shim: schedule a progress publish without awaiting."""
    from ..util import fire

    fire(bus_publish(redis, uid, {"jobId": job_id, "type": "progress", "step": step}))
