"""Orchestrator agent. Port of ``worker/agents/orchestrator.ts``.

The conductor for fuzzy / voice requests ("Bear, what should I do next?") —
classifies the request and delegates to a worker agent.
"""

import json
import re
from typing import Any, Dict

from redis.asyncio import Redis

from ..agent import run_skill_agent
from ..bus import publish as bus_publish
from .curator import run_explore
from .learning_path import run_rebuild_path
from .voice import run_narrate


def _router_prompt(request: str) -> str:
    return (
        "You are Tiruno's orchestrator. Classify the user's request and decide which agent should handle it. "
        "Respond with ONLY a JSON object (no prose, no fences):\n"
        '{"action":"explore|rebuild_path|narrate|answer","topic":"<for explore>","text":"<for narrate>",'
        '"answer":"<for answer: a short helpful reply>"}\n\n'
        "Rules:\n"
        '- "research X", "what\'s new in X", "find me / get me X", "trending X" → action "explore", topic = X.\n'
        '- "what should I learn", "build/rebuild my path", "plan my studies" → action "rebuild_path".\n'
        '- "read/narrate this", "say it out loud" → action "narrate", text = the thing to narrate.\n'
        '- Anything else (greetings, general questions) → action "answer" with a concise answer.\n\n'
        f'User request: "{request}"'
    )


def _parse_plan(text: str) -> Dict[str, Any]:
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text or "", re.IGNORECASE)
    c = m.group(1) if m else (text or "")
    start = c.find("{")
    end = c.rfind("}")
    if start != -1 and end != -1:
        try:
            o = json.loads(c[start : end + 1])
            if isinstance(o, dict) and isinstance(o.get("action"), str):
                return o
        except Exception:  # noqa: BLE001
            pass
    return {"action": "answer", "answer": (text or "").strip()[:400]}


async def run_orchestrate(redis: Redis, job: Dict[str, str]) -> None:
    uid, job_id, request = job["uid"], job["jobId"], job["request"]
    await bus_publish(redis, uid, {"jobId": job_id, "type": "progress", "status": "researching", "step": "Thinking about what you need…"})

    res = await run_skill_agent(prompt=_router_prompt(request), skills=[], max_turns=3)
    plan = _parse_plan(res.text) if res.ok else {"action": "answer", "answer": "I couldn't process that — try rephrasing."}

    action = plan.get("action")
    if action == "explore":
        await run_explore(redis, {"uid": uid, "jobId": job_id, "topic": plan.get("topic") or request})
    elif action == "rebuild_path":
        await run_rebuild_path(redis, {"uid": uid, "jobId": job_id})
    elif action == "narrate":
        await run_narrate(redis, {"uid": uid, "jobId": job_id, "text": plan.get("text") or request})
    else:
        await bus_publish(redis, uid, {"jobId": job_id, "type": "done", "status": "ready", "result": {"answer": plan.get("answer") or "Done."}})
