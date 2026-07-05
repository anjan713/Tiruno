"""Hermes — the self-improving agent loop. Port of ``src/lib/core/hermes/*``.

Cycle: ACT -> RECORD (episodic memory) -> REFLECT (self-grade) -> EVOLVE
(rewrite the discovery strategy and, when warranted, author/refine a skill).
Strategies, skills, reflections and episodes live as markdown in the Vault.

Strategies are represented as plain dicts with the SAME camelCase keys the Node
worker uses (``version``, ``noveltyExplore``, ``sourceMix``, ``preferred``,
``avoid``, ``note``, ``at``) so the ``strategy:discovery:{uid}`` and
``improvements:log`` Redis mirrors stay byte-compatible.
"""

import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ..llm import get_llm, parse_json_from_text
from ..util import now_ms
from ..vault import get_vault

__all__ = ["Hermes", "get_hermes", "DEFAULT_STRATEGY"]

DEFAULT_STRATEGY: Dict[str, Any] = {
    "version": 1,
    "noveltyExplore": 0.2,
    "sourceMix": ["reddit", "hackernews", "github", "youtube", "x", "web"],
    "preferred": [],
    "avoid": [],
    "note": "Seed strategy: balanced sources, 20% explore for new voices.",
    "at": 0,
}


def slug(s: str) -> str:
    out = re.sub(r"[^a-z0-9]+", "-", (s or "").lower())
    out = re.sub(r"^-+|-+$", "", out)
    return out or "x"


def _iso_now() -> str:
    """Equivalent of JS ``new Date().toISOString()`` (millisecond precision, Z)."""
    dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _ts() -> str:
    return _iso_now().replace(":", "-").replace(".", "-")


def _pct(x: float) -> str:
    """JS ``(x * 100).toFixed(0)`` — percent with no decimals."""
    return f"{x * 100:.0f}"


def _dedupe(xs: List[str]) -> List[str]:
    return list(dict.fromkeys(x.strip() for x in xs if x and x.strip()))


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


class Hermes:
    def __init__(self, redis=None, vault=None, llm=None) -> None:
        self.vault = vault or get_vault()
        self.llm = llm if llm is not None else get_llm()
        self.redis = redis

    # --- paths ---
    def _strategy_path(self, uid: str) -> str:
        return f"strategies/discovery-{slug(uid)}"

    def _episode_path(self, uid: str, task: str) -> str:
        return f"memory/episodes/{slug(uid)}/{_ts()}-{slug(task)}"

    def _reflection_path(self, uid: str) -> str:
        return f"reflections/{slug(uid)}/{_ts()}"

    def _skill_path(self, name: str) -> str:
        return f"skills/{slug(name)}"

    # --- ACT step: episodic memory ---
    async def record_episode(self, ep: Dict[str, Any]) -> None:
        at = ep.get("at") or now_ms()
        metrics: Dict[str, Any] = ep.get("metrics") or {}
        frontmatter: Dict[str, Any] = {
            "task": ep["task"],
            "topic": ep.get("topic") or "",
            "strategyVersion": ep["strategyVersion"],
            "at": at,
        }
        for k, v in metrics.items():
            frontmatter[f"metric_{k}"] = v
        metrics_line = ", ".join(f"{k}={v}" for k, v in metrics.items()) or "none"
        body = (
            f"# {ep['task']} — {ep.get('topic') or ''}\n\n"
            f"**Input:** {ep.get('input', '')}\n\n"
            f"**Output:** {ep.get('output', '')}\n\n"
            f"**Metrics:** {metrics_line}\n"
        )
        await self.vault.write(self._episode_path(ep["uid"], ep["task"]), body, frontmatter)

    async def recent_episodes(self, uid: str, n: int = 12) -> List[Dict[str, Any]]:
        paths = await self.vault.list(f"memory/episodes/{slug(uid)}")
        latest = paths[-n:]
        out: List[Dict[str, Any]] = []
        for p in latest:
            note = await self.vault.read(p)
            if not note:
                continue
            fm = note.frontmatter
            metrics: Dict[str, float] = {}
            for k, v in fm.items():
                if k.startswith("metric_") and _is_number(v):
                    metrics[k[7:]] = v
            out.append(
                {
                    "id": p,
                    "uid": uid,
                    "task": str(fm.get("task", "")),
                    "topic": str(fm["topic"]) if fm.get("topic") else None,
                    "strategyVersion": int(fm.get("strategyVersion", 0) or 0),
                    "input": "",
                    "output": "",
                    "metrics": metrics,
                    "at": int(fm.get("at", note.updated_at) or note.updated_at),
                }
            )
        return out

    # --- reward signal (compatible with existing Redis outcome list) ---
    async def record_outcome(self, uid: str, followup: str, accepted: bool) -> None:
        if not self.redis:
            return
        try:
            await self.redis.lpush(
                f"suggestions:{uid}:outcomes",
                json.dumps({"followup": followup, "accepted": accepted, "at": now_ms()}),
            )
            await self.redis.ltrim(f"suggestions:{uid}:outcomes", 0, 199)
        except Exception:  # noqa: BLE001
            pass

    async def outcome_stats(self, uid: str) -> Dict[str, float]:
        accepts = 0
        total = 0
        if self.redis:
            try:
                raw = await self.redis.lrange(f"suggestions:{uid}:outcomes", 0, 49)
                for r in raw:
                    try:
                        o = json.loads(r)
                        total += 1
                        if o.get("accepted"):
                            accepts += 1
                    except Exception:  # noqa: BLE001
                        continue
            except Exception:  # noqa: BLE001
                pass
        return {"total": total, "accepts": accepts, "acceptRate": (accepts / total) if total else 0.5}

    # --- strategy (living file) ---
    async def current_strategy(self, uid: str) -> Dict[str, Any]:
        note = await self.vault.read(self._strategy_path(uid))
        if not note:
            return dict(DEFAULT_STRATEGY)
        fm = note.frontmatter

        def arr(v: Any) -> List[str]:
            return [str(x) for x in v] if isinstance(v, list) else []

        source_mix = arr(fm.get("sourceMix"))
        return {
            "version": int(fm.get("version", 1) or 1),
            "noveltyExplore": float(fm.get("noveltyExplore", DEFAULT_STRATEGY["noveltyExplore"])),
            "sourceMix": source_mix if source_mix else list(DEFAULT_STRATEGY["sourceMix"]),
            "preferred": arr(fm.get("preferred")),
            "avoid": arr(fm.get("avoid")),
            "note": str(fm.get("note", DEFAULT_STRATEGY["note"])),
            "at": int(fm.get("at", note.updated_at) or note.updated_at),
        }

    async def _save_strategy(self, uid: str, s: Dict[str, Any]) -> None:
        frontmatter = {
            "version": s["version"],
            "noveltyExplore": round(float(s["noveltyExplore"]), 2),
            "sourceMix": s["sourceMix"],
            "preferred": s["preferred"],
            "avoid": s["avoid"],
            "note": s["note"],
            "at": s["at"],
        }
        body = (
            f"# Discovery strategy (v{s['version']})\n\n"
            f"{s['note']}\n\n"
            f"- **Explore new voices:** {_pct(s['noveltyExplore'])}%\n"
            f"- **Source mix:** {', '.join(s['sourceMix'])}\n"
            f"- **Favor:** {', '.join(s['preferred']) or '—'}\n"
            f"- **De-emphasize:** {', '.join(s['avoid']) or '—'}\n"
        )
        await self.vault.write(self._strategy_path(uid), body, frontmatter)

        # Mirror to Redis for fast runtime reads / backward compatibility.
        if self.redis:
            try:
                await self.redis.lpush(f"strategy:discovery:{uid}", json.dumps(s))
                await self.redis.ltrim(f"strategy:discovery:{uid}", 0, 19)
                await self.redis.lpush(
                    "improvements:log",
                    json.dumps({"uid": uid, "version": s["version"], "note": s["note"], "at": s["at"]}),
                )
                await self.redis.ltrim("improvements:log", 0, 199)
            except Exception:  # noqa: BLE001
                pass

    # --- skills (living files) ---
    async def save_skill(self, skill: Dict[str, Any]) -> Dict[str, Any]:
        existing = await self.vault.read(self._skill_path(skill["name"]))
        version = (int(existing.frontmatter.get("version", 0) or 0) + 1) if existing else 1
        full = {**skill, "version": version, "at": now_ms()}
        steps = full.get("steps") or []
        body = (
            f"# Skill: {full['name']}\n\n"
            f"**When:** {full['when']}\n\n"
            f"## Steps\n"
            + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(steps))
            + "\n"
        )
        await self.vault.write(
            self._skill_path(full["name"]),
            body,
            {"name": full["name"], "when": full["when"], "version": full["version"], "at": full["at"]},
        )
        return full

    async def relevant_skills(self, query: str, limit: int = 3) -> List[Dict[str, Any]]:
        hits = await self.vault.search(query, dir="skills", limit=limit)
        out: List[Dict[str, Any]] = []
        for h in hits:
            note = await self.vault.read(h.path)
            if not note:
                continue
            steps = []
            for line in re.split(r"\r?\n", note.content):
                m = re.match(r"^\d+\.\s+(.*)$", line)
                if m:
                    steps.append(m.group(1))
            out.append(
                {
                    "name": str(note.frontmatter.get("name", h.path)),
                    "when": str(note.frontmatter.get("when", "")),
                    "steps": steps,
                    "version": int(note.frontmatter.get("version", 1) or 1),
                    "at": int(note.frontmatter.get("at", note.updated_at) or note.updated_at),
                }
            )
        return out

    # --- prompt hints (evolved knowledge shapes the next run) ---
    async def strategy_hint(self, uid: str) -> str:
        s = await self.current_strategy(uid)
        parts = [
            f"Discovery strategy v{s['version']}: spend ~{_pct(s['noveltyExplore'])}% of effort surfacing fresh/novel voices."
        ]
        if s["preferred"]:
            parts.append(f"Favor these sources that have worked well: {', '.join(s['preferred'])}.")
        if s["avoid"]:
            parts.append(f"De-emphasize: {', '.join(s['avoid'])}.")
        return " ".join(parts)

    async def skills_hint(self, query: str) -> str:
        skills = await self.relevant_skills(query, 2)
        if not skills:
            return ""
        return "Apply these learned skills where relevant:\n" + "\n".join(
            f"- {s['name']} (when {s['when']}): {'; '.join(s['steps'])}" for s in skills
        )

    # --- REFLECT + EVOLVE ---
    async def reflect_and_evolve(self, uid: str) -> Dict[str, Any]:
        prev, stats, episodes = await asyncio.gather(
            self.current_strategy(uid),
            self.outcome_stats(uid),
            self.recent_episodes(uid, 12),
        )

        baseline_novelty = max(
            0.1,
            min(0.5, (0.2 + (0.5 - stats["acceptRate"]) * 0.4) if stats["total"] else 0.2),
        )

        reflection = await self._llm_reflect(uid, prev, stats, episodes, baseline_novelty)
        adj = reflection.get("adjustments") or {}

        nxt: Dict[str, Any] = {
            "version": prev["version"] + 1,
            "noveltyExplore": round(float(adj.get("noveltyExplore", baseline_novelty)), 2),
            "sourceMix": adj["sourceMix"] if adj.get("sourceMix") else prev["sourceMix"],
            "preferred": _dedupe([*(adj.get("preferred") or []), *prev["preferred"]])[:8],
            "avoid": _dedupe([*(adj.get("avoid") or []), *prev["avoid"]])[:8],
            "note": reflection.get("critique")
            or (
                DEFAULT_STRATEGY["note"]
                if stats["total"] == 0
                else f"Tuned from {stats['total']} outcomes (accept {_pct(stats['acceptRate'])}%)."
            ),
            "at": now_ms(),
        }

        await self._save_strategy(uid, nxt)
        await self._write_reflection(uid, reflection, stats, nxt)
        skill = reflection.get("skill")
        if skill and skill.get("name") and skill.get("steps"):
            await self.save_skill(skill)
        return nxt

    async def _llm_reflect(
        self,
        uid: str,
        prev: Dict[str, Any],
        stats: Dict[str, float],
        episodes: List[Dict[str, Any]],
        baseline_novelty: float,
    ) -> Dict[str, Any]:
        fallback = {
            "score": stats["acceptRate"],
            "critique": (
                "No feedback yet — keeping a balanced, exploratory strategy."
                if stats["total"] == 0
                else f"Accept rate {_pct(stats['acceptRate'])}% over {stats['total']} suggestions; "
                f"adjusting explore to {_pct(baseline_novelty)}%."
            ),
            "adjustments": {"noveltyExplore": baseline_novelty},
        }
        if not self.llm:
            return fallback

        ep_lines = "\n".join(
            f"- {e['task']} \"{e.get('topic') or ''}\" v{e['strategyVersion']}: "
            + ", ".join(f"{k}={v}" for k, v in e["metrics"].items())
            for e in episodes
        )[:2000]

        prompt = (
            "You are Hermes, the self-improvement module of a learning agent. Review recent "
            "discovery performance and propose how to improve the next strategy version.\n\n"
            f"Current strategy v{prev['version']}: explore={prev['noveltyExplore']}, "
            f"preferred=[{', '.join(prev['preferred'])}], avoid=[{', '.join(prev['avoid'])}].\n"
            f"Suggestion accept rate: {_pct(stats['acceptRate'])}% over {stats['total']} outcomes.\n"
            f"Recent episodes:\n{ep_lines or '(none yet)'}\n\n"
            "Respond with ONLY a JSON object:\n"
            '{"score":0..1,"critique":"1-2 sentences","adjustments":{"noveltyExplore":0..1,'
            '"preferred":["..."],"avoid":["..."],"sourceMix":["..."]},"skill":{"name":"short-name",'
            '"when":"trigger","steps":["..."]}}\n'
            '"skill" is optional — include it only if you learned a concrete, reusable tactic. '
            "Keep arrays short."
        )

        try:
            text = await self.llm.complete(
                prompt,
                system="You output only valid JSON. Be concise and grounded in the data provided.",
                max_tokens=700,
                temperature=0.4,
                json=True,
            )
            parsed = parse_json_from_text(text, {}) or {}
            return {
                "score": parsed["score"] if _is_number(parsed.get("score")) else fallback["score"],
                "critique": parsed.get("critique") or fallback["critique"],
                "adjustments": parsed.get("adjustments") or fallback["adjustments"],
                "skill": parsed.get("skill"),
            }
        except Exception:  # noqa: BLE001
            return fallback

    async def summary(self, uid: str) -> Dict[str, Any]:
        strategy, episodes = await asyncio.gather(
            self.current_strategy(uid),
            self.recent_episodes(uid, 100),
        )

        skill_paths = await self.vault.list("skills")
        skills: List[Dict[str, Any]] = []
        for p in skill_paths:
            note = await self.vault.read(p)
            if not note:
                continue
            steps = []
            for line in re.split(r"\r?\n", note.content):
                m = re.match(r"^\d+\.\s+(.*)$", line)
                if m:
                    steps.append(m.group(1))
            skills.append(
                {
                    "name": str(note.frontmatter.get("name", p)),
                    "when": str(note.frontmatter.get("when", "")),
                    "steps": steps,
                    "version": int(note.frontmatter.get("version", 1) or 1),
                    "at": int(note.frontmatter.get("at", note.updated_at) or note.updated_at),
                }
            )

        reflection_paths = (await self.vault.list(f"reflections/{slug(uid)}"))[-10:][::-1]
        reflections: List[Dict[str, Any]] = []
        for p in reflection_paths:
            note = await self.vault.read(p)
            if not note:
                continue
            reflections.append(
                {
                    "score": float(note.frontmatter.get("score", 0) or 0),
                    "strategyVersion": int(note.frontmatter.get("strategyVersion", 0) or 0),
                    "at": int(note.frontmatter.get("at", note.updated_at) or note.updated_at),
                }
            )

        return {"strategy": strategy, "skills": skills, "reflections": reflections, "episodes": len(episodes)}

    async def _write_reflection(
        self,
        uid: str,
        r: Dict[str, Any],
        stats: Dict[str, float],
        nxt: Dict[str, Any],
    ) -> None:
        skill = r.get("skill")
        body = (
            f"# Reflection — {_iso_now()}\n\n"
            f"**Self-grade:** {_pct(r['score'])}%\n\n"
            f"**Critique:** {r['critique']}\n\n"
            f"**Outcomes:** {stats['accepts']}/{stats['total']} accepted ({_pct(stats['acceptRate'])}%)\n\n"
            f"**New strategy:** v{nxt['version']}, explore {_pct(nxt['noveltyExplore'])}%"
            + (f"\n\n**Learned skill:** {skill['name']}" if skill else "")
            + "\n"
        )
        await self.vault.write(
            self._reflection_path(uid),
            body,
            {"uid": uid, "score": round(float(r["score"]), 2), "strategyVersion": nxt["version"], "at": now_ms()},
        )


def get_hermes(redis=None) -> Hermes:
    return Hermes(redis=redis)
