import type Redis from "ioredis";
import { runSkillAgent } from "../lib/sdk";
import { makeBus } from "../lib/bus";
import { getLevel, levelPromptHint } from "../loops/l1";

export interface LearningPathJob {
  uid: string;
  jobId: string;
}

interface CanvasSnapshot {
  courses?: Array<{ id?: string; name?: string }>;
}

const snapshotKey = (uid: string) => `canvas:snapshot:${uid}`;
const pathKey = (uid: string) => `path:${uid}`;
const gapKey = (uid: string) => `profile:gap:${uid}`;

const PROMPT = (courses: string[], levelHint: string) => `You are Tiruno's learning-path planner. The student is enrolled in: ${
  courses.length ? courses.join(", ") : "(no courses synced; use general CS/SWE topics)"
}.

${levelHint}

Produce a personalized learning path. Respond with ONLY a single JSON object (no prose, no fences):
{"gaps":[{"topic":"...","why":"one short sentence"}],"path":[{"unit":"...","nodes":[{"title":"...","type":"lesson|article|checkpoint|review","topic":"..."}]}]}

Include 2-3 gaps and 2-3 units (each with 3-4 nodes), ordered to move the student's understanding fastest.`;

function parseJson<T>(text: string, fallback: T): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const c = fenced ? fenced[1] : text;
  const start = c.indexOf("{");
  const end = c.lastIndexOf("}");
  if (start === -1 || end === -1) return fallback;
  try {
    return JSON.parse(c.slice(start, end + 1)) as T;
  } catch {
    return fallback;
  }
}

/** Learning-Path agent: Canvas snapshot → gap profile → sequenced path. */
export async function runRebuildPath(redis: Redis, job: LearningPathJob): Promise<void> {
  const bus = makeBus(redis);
  await bus.publish(job.uid, { jobId: job.jobId, type: "progress", status: "researching", step: "Reading your courses…" });

  let courses: string[] = [];
  try {
    const raw = await redis.get(snapshotKey(job.uid));
    const snap: CanvasSnapshot = raw ? JSON.parse(raw) : {};
    courses = (snap.courses ?? []).map((c) => c.name ?? "").filter(Boolean);
  } catch {
    /* no snapshot */
  }

  // Use the first course topic to pick a starting level hint.
  const level = await getLevel(redis, job.uid, courses[0] ?? "general");
  await bus.publish(job.uid, { jobId: job.jobId, type: "progress", step: "Building your path…" });

  const res = await runSkillAgent({
    prompt: PROMPT(courses, levelPromptHint(level)),
    skills: [],
    maxTurns: 6,
    onStep: (step) => void bus.publish(job.uid, { jobId: job.jobId, type: "progress", step }),
  });

  if (!res.ok) {
    await bus.publish(job.uid, { jobId: job.jobId, type: "error", status: "error", error: res.error || "path build failed" });
    return;
  }

  const parsed = parseJson<{ gaps: unknown[]; path: unknown[] }>(res.text, { gaps: [], path: [] });
  try {
    await redis.set(gapKey(job.uid), JSON.stringify({ gaps: parsed.gaps, at: Date.now() }), "EX", 60 * 60 * 24 * 7);
    await redis.set(pathKey(job.uid), JSON.stringify({ path: parsed.path, at: Date.now() }), "EX", 60 * 60 * 24 * 7);
  } catch {
    /* best effort */
  }
  await bus.publish(job.uid, {
    jobId: job.jobId,
    type: "done",
    status: "ready",
    result: { gaps: parsed.gaps, path: parsed.path },
  });
}
