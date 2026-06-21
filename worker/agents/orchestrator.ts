import type Redis from "ioredis";
import { runSkillAgent } from "../lib/sdk";
import { makeBus } from "../lib/bus";
import { runExplore } from "./curator";
import { runRebuildPath } from "./learningPath";
import { runNarrate } from "./voice";

export interface OrchestrateJob {
  uid: string;
  jobId: string;
  request: string;
}

interface Plan {
  action: "explore" | "rebuild_path" | "narrate" | "answer";
  topic?: string;
  text?: string;
  answer?: string;
}

const ROUTER_PROMPT = (request: string) => `You are Tiruno's orchestrator. Classify the user's request and decide which agent should handle it. Respond with ONLY a JSON object (no prose, no fences):
{"action":"explore|rebuild_path|narrate|answer","topic":"<for explore>","text":"<for narrate>","answer":"<for answer: a short helpful reply>"}

Rules:
- "research X", "what's new in X", "find me / get me X", "trending X" → action "explore", topic = X.
- "what should I learn", "build/rebuild my path", "plan my studies" → action "rebuild_path".
- "read/narrate this", "say it out loud" → action "narrate", text = the thing to narrate.
- Anything else (greetings, general questions) → action "answer" with a concise answer.

User request: "${request}"`;

function parsePlan(text: string): Plan {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const c = fenced ? fenced[1] : text;
  const start = c.indexOf("{");
  const end = c.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    try {
      const o = JSON.parse(c.slice(start, end + 1));
      if (o && typeof o.action === "string") return o as Plan;
    } catch {
      /* fall through */
    }
  }
  return { action: "answer", answer: text.trim().slice(0, 400) };
}

/**
 * Orchestrator agent (LLM): the conductor for fuzzy / voice requests like
 * "Bear, what should I do next?" — decides the plan and delegates to worker agents.
 */
export async function runOrchestrate(redis: Redis, job: OrchestrateJob): Promise<void> {
  const bus = makeBus(redis);
  await bus.publish(job.uid, { jobId: job.jobId, type: "progress", status: "researching", step: "Thinking about what you need…" });

  const res = await runSkillAgent({ prompt: ROUTER_PROMPT(job.request), skills: [], maxTurns: 3 });
  const plan = res.ok ? parsePlan(res.text) : { action: "answer" as const, answer: "I couldn't process that — try rephrasing." };

  switch (plan.action) {
    case "explore":
      await runExplore(redis, { uid: job.uid, jobId: job.jobId, topic: plan.topic || job.request });
      return;
    case "rebuild_path":
      await runRebuildPath(redis, { uid: job.uid, jobId: job.jobId });
      return;
    case "narrate":
      await runNarrate(redis, { uid: job.uid, jobId: job.jobId, text: plan.text || job.request });
      return;
    default:
      await bus.publish(job.uid, {
        jobId: job.jobId,
        type: "done",
        status: "ready",
        result: { answer: plan.answer ?? "Done." },
      });
  }
}
