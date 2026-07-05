"""Learning-Path agent. Port of ``worker/agents/learningPath.ts``.

Canvas snapshot -> gap profile -> sequenced path. Persists ``profile:gap:{uid}``
and ``path:{uid}``.
"""

import json
import re
from typing import Any, Dict

from redis.asyncio import Redis

from ..agent import run_skill_agent
from ..bus import publish as bus_publish
from ..loops.l1 import get_level, level_prompt_hint
from ..util import fire, now_ms


def _snapshot_key(uid: str) -> str:
    return f"canvas:snapshot:{uid}"


def _path_key(uid: str) -> str:
    return f"path:{uid}"


def _gap_key(uid: str) -> str:
    return f"profile:gap:{uid}"


def _prompt(courses: list, level_hint: str) -> str:
    enrolled = ", ".join(courses) if courses else "(no courses synced; use general CS/SWE topics)"
    return (
        f"You are Tiruno's learning-path planner. The student is enrolled in: {enrolled}.\n\n"
        f"{level_hint}\n\n"
        "Produce a personalized learning path. Respond with ONLY a single JSON object (no prose, no fences):\n"
        '{"gaps":[{"topic":"...","why":"one short sentence"}],"path":[{"unit":"...","nodes":[{"title":"...",'
        '"type":"lesson|article|checkpoint|review","topic":"..."}]}]}\n\n'
        "Include 2-3 gaps and 2-3 units (each with 3-4 nodes), ordered to move the student's understanding fastest."
    )


def _parse_json(text: str, fallback: Dict[str, Any]) -> Dict[str, Any]:
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


async def run_rebuild_path(redis: Redis, job: Dict[str, str]) -> None:
    uid, job_id = job["uid"], job["jobId"]
    await bus_publish(redis, uid, {"jobId": job_id, "type": "progress", "status": "researching", "step": "Reading your courses…"})

    courses = []
    try:
        raw = await redis.get(_snapshot_key(uid))
        snap = json.loads(raw) if raw else {}
        courses = [c.get("name") or "" for c in (snap.get("courses") or [])]
        courses = [c for c in courses if c]
    except Exception:  # noqa: BLE001
        pass

    level = await get_level(redis, uid, courses[0] if courses else "general")
    await bus_publish(redis, uid, {"jobId": job_id, "type": "progress", "step": "Building your path…"})

    def on_step(step: str) -> None:
        fire(bus_publish(redis, uid, {"jobId": job_id, "type": "progress", "step": step}))

    res = await run_skill_agent(prompt=_prompt(courses, level_prompt_hint(level)), skills=[], max_turns=6, on_step=on_step)

    if not res.ok:
        await bus_publish(redis, uid, {"jobId": job_id, "type": "error", "status": "error", "error": res.error or "path build failed"})
        return

    parsed = _parse_json(res.text, {"gaps": [], "path": []})
    gaps = parsed.get("gaps", [])
    path = parsed.get("path", [])
    try:
        await redis.set(_gap_key(uid), json.dumps({"gaps": gaps, "at": now_ms()}), ex=60 * 60 * 24 * 7)
        await redis.set(_path_key(uid), json.dumps({"path": path, "at": now_ms()}), ex=60 * 60 * 24 * 7)
    except Exception:  # noqa: BLE001
        pass

    await bus_publish(redis, uid, {"jobId": job_id, "type": "done", "status": "ready", "result": {"gaps": gaps, "path": path}})
