import type Redis from "ioredis";
import { runSkillAgent } from "../lib/sdk";
import { makeBus } from "../lib/bus";
import { getLevel, levelPromptHint, recordSignal } from "../loops/l1";
import { embed } from "../../src/lib/rag/embeddings";
import { ensureVectorIndex, indexMaterial, searchMaterials } from "../../src/lib/rag/vector";
import { notebooklmSummarize } from "../../src/lib/notebooklm";

export interface GenerateLessonJob {
  uid: string;
  jobId: string;
  topic: string;
  articleId?: string;
}

interface GenMCQ {
  id: string;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
  citation: string;
}

interface GenLesson {
  id: string;
  title: string;
  topic: string;
  concept: string;
  questions: GenMCQ[];
  generated: true;
  createdAt: number;
  /** Set when the lesson was authored from an ingested article (engagement linkage). */
  articleId?: string;
}

const lessonKey = (id: string) => `lesson:gen:${id}`;
const jobKey = (jobId: string) => `lessonjob:${jobId}`;

const PROMPT = (topic: string, levelHint: string, grounding: string) =>
  `You are Tiruno's lesson author. Write a short, accurate micro-lesson on "${topic}" for a learner.
${levelHint}

Ground every claim in this source material. Do not invent facts beyond it; where it's thin, rely on well-established fundamentals of the topic:
---
${grounding.slice(0, 6000) || "(no extra material retrieved; use well-established fundamentals)"}
---

Respond with ONLY one JSON object (no prose, no code fences) of exactly this shape:
{"title":"...","concept":"a 3-5 sentence plain-language explanation a tutor would say aloud","questions":[{"prompt":"...","options":["..","..","..",".."],"answer":0,"explanation":"one sentence on why the correct option is right","citation":"short source label"}]}

Include exactly 5 questions. Each question must have exactly 4 options and "answer" as the 0-based index of the correct option. Keep it tight and demo-sized.`;

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

/** Build grounding context from a specific article or via RAG retrieval over the index. */
async function gatherGrounding(
  redis: Redis,
  topic: string,
  articleId?: string
): Promise<string> {
  if (articleId) {
    try {
      const raw = await redis.get(`article:${articleId}`);
      if (raw) {
        const a = JSON.parse(raw);
        return [a.title, a.summary, a.text].filter(Boolean).join("\n\n");
      }
    } catch {
      /* fall through to RAG */
    }
  }
  try {
    await ensureVectorIndex(redis);
    const vec = await embed(topic);
    const hits = await searchMaterials(redis, vec, 5);
    return hits.map((h) => `${h.title} (${h.topic}). ${h.text}`).join("\n\n");
  } catch {
    return "";
  }
}

/**
 * Lesson-generation agent: retrieve grounding material (RAG, NotebookLM-pluggable),
 * have Claude author a level-matched micro-lesson, persist it, and index it for reuse.
 */
export async function runGenerateLesson(redis: Redis, job: GenerateLessonJob): Promise<void> {
  const bus = makeBus(redis);
  const topic = job.topic.trim() || "this topic";
  const id = `gen-${job.jobId}`;

  const setJob = (status: string, extra: Record<string, unknown> = {}) =>
    redis.set(jobKey(job.jobId), JSON.stringify({ jobId: job.jobId, status, ...extra }), "EX", 60 * 60 * 24);

  await setJob("working");
  await bus.publish(job.uid, { jobId: job.jobId, type: "progress", status: "researching", step: "Gathering material…" });

  let grounding = await gatherGrounding(redis, topic, job.articleId);
  // NotebookLM grounding hook (pluggable; returns null unless NOTEBOOKLM_ENABLED=1).
  try {
    const nb = await notebooklmSummarize(grounding, topic);
    if (nb) grounding = `${nb}\n\n${grounding}`;
  } catch {
    /* best effort */
  }

  const level = await getLevel(redis, job.uid, topic);
  await bus.publish(job.uid, { jobId: job.jobId, type: "progress", step: "Writing your lesson…" });

  const res = await runSkillAgent({
    prompt: PROMPT(topic, levelPromptHint(level), grounding),
    skills: [],
    maxTurns: 6,
    onStep: (step) => void bus.publish(job.uid, { jobId: job.jobId, type: "progress", step }),
  });

  if (!res.ok) {
    await setJob("error", { error: res.error || "generation failed" });
    await bus.publish(job.uid, { jobId: job.jobId, type: "error", status: "error", error: res.error || "Lesson generation failed" });
    return;
  }

  const parsed = parseJson<{ title?: string; concept?: string; questions?: GenMCQ[] }>(res.text, {});
  const questions: GenMCQ[] = (parsed.questions ?? [])
    .filter((q) => q && q.prompt && Array.isArray(q.options) && q.options.length >= 2)
    .slice(0, 5)
    .map((q, i) => ({
      id: `q${i + 1}`,
      prompt: String(q.prompt),
      options: q.options.slice(0, 4).map((o) => String(o)),
      answer: Math.max(0, Math.min((q.options.length || 1) - 1, Number(q.answer) || 0)),
      explanation: String(q.explanation ?? ""),
      citation: String(q.citation ?? "Generated by Tiru"),
    }));

  if (!questions.length) {
    await setJob("error", { error: "no questions produced" });
    await bus.publish(job.uid, { jobId: job.jobId, type: "error", status: "error", error: "Couldn't build a lesson — try a different topic." });
    return;
  }

  const lesson: GenLesson = {
    id,
    title: String(parsed.title || `A lesson on ${topic}`),
    topic,
    concept: String(parsed.concept || ""),
    questions,
    generated: true,
    createdAt: Date.now(),
    ...(job.articleId ? { articleId: job.articleId } : {}),
  };

  await redis.set(lessonKey(id), JSON.stringify(lesson), "EX", 60 * 60 * 24 * 7);

  // Index the new lesson so it can be recommended as "next-best material".
  try {
    const vec = await embed(`${lesson.title}. ${lesson.concept}`);
    await indexMaterial(redis, { id, kind: "lesson", refId: id, title: lesson.title, topic, text: lesson.concept }, vec);
  } catch {
    /* best effort */
  }

  await recordSignal(redis, job.uid, { kind: "explore", topic });
  await setJob("ready", { lessonId: id, title: lesson.title });
  await bus.publish(job.uid, {
    jobId: job.jobId,
    type: "done",
    status: "ready",
    result: { lessonId: id, title: lesson.title, topic },
  });
}
