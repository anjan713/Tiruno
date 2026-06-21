import type Redis from "ioredis";
import { runSkillAgent } from "../lib/sdk";
import { makeBus } from "../lib/bus";
import { recordSignal } from "../loops/l1";
import { proposeFollowups } from "../loops/l2";
import { embedBatch } from "../../src/lib/rag/embeddings";
import { ensureVectorIndex, indexMaterial } from "../../src/lib/rag/vector";

export interface ExploreSource {
  title: string;
  url: string;
  source: string;
  engagement?: string;
  snippet?: string;
}

export interface ExploreState {
  jobId: string;
  uid: string;
  topic: string;
  status: "pending" | "researching" | "ready" | "error";
  steps: string[];
  sources: ExploreSource[];
  synthesis: string;
  followups: string[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ExploreJob {
  uid: string;
  jobId: string;
  topic: string;
}

const exploreKey = (uid: string, jobId: string) => `explore:${uid}:${jobId}`;

const PROMPT = (topic: string) => `Use the **last30days** skill to research what people have actually said about "${topic}" over the last 30 days across Reddit, X, YouTube, Hacker News, GitHub, and the web — ranked by real engagement.

When you are done, respond with ONLY a single JSON object (no prose, no markdown code fences) of exactly this shape:
{"sources":[{"title":"...","url":"https://...","source":"reddit|hackernews|youtube|github|x|web","engagement":"e.g. 1.2k upvotes · 340 comments","snippet":"one short sentence on why it matters"}],"synthesis":"A grounded 4-6 sentence markdown summary of the current conversation, reflecting what the sources collectively show."}

Include the 6-10 highest-engagement, most relevant items. Keep snippets to one sentence. Output the JSON object and nothing else.`;

/** Best-effort extraction of the agent's final JSON result. */
function parseResult(text: string): { sources: ExploreSource[]; synthesis: string } {
  const fallback = { sources: [] as ExploreSource[], synthesis: text.trim().slice(0, 1200) };
  if (!text) return fallback;
  // Strip code fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return fallback;
  try {
    const obj = JSON.parse(candidate.slice(start, end + 1));
    const sources: ExploreSource[] = Array.isArray(obj.sources)
      ? obj.sources
          .filter((s: unknown) => s && typeof (s as ExploreSource).title === "string")
          .map((s: ExploreSource) => ({
            title: String(s.title),
            url: String(s.url ?? ""),
            source: String(s.source ?? "web"),
            engagement: s.engagement ? String(s.engagement) : undefined,
            snippet: s.snippet ? String(s.snippet) : undefined,
          }))
      : [];
    const synthesis = typeof obj.synthesis === "string" ? obj.synthesis : fallback.synthesis;
    return { sources, synthesis };
  } catch {
    return fallback;
  }
}

/**
 * Curator / Discovery agent: research a topic with the last30days skill, stream
 * progress to the UI, and persist ranked sources + a grounded synthesis.
 */
export async function runExplore(redis: Redis, job: ExploreJob): Promise<ExploreState> {
  const bus = makeBus(redis);
  const key = exploreKey(job.uid, job.jobId);

  const state: ExploreState = {
    jobId: job.jobId,
    uid: job.uid,
    topic: job.topic,
    status: "researching",
    steps: ["Tiru is digging into the last 30 days…"],
    sources: [],
    synthesis: "",
    followups: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const save = async () => {
    state.updatedAt = Date.now();
    await redis.set(key, JSON.stringify(state), "EX", 60 * 60 * 24);
  };

  await save();
  await bus.publish(job.uid, { jobId: job.jobId, type: "progress", status: "researching", step: state.steps[0] });

  const res = await runSkillAgent({
    prompt: PROMPT(job.topic),
    onStep: (step) => {
      if (!step || state.steps[state.steps.length - 1] === step) return;
      state.steps.push(step);
      void save();
      void bus.publish(job.uid, { jobId: job.jobId, type: "progress", status: "researching", step });
    },
  });

  if (!res.ok) {
    state.status = "error";
    state.error = res.error || "Research failed";
    await save();
    await bus.publish(job.uid, { jobId: job.jobId, type: "error", status: "error", error: state.error });
    return state;
  }

  const { sources, synthesis } = parseResult(res.text);
  state.status = "ready";
  state.sources = sources;
  state.synthesis = synthesis;
  state.steps.push(`Found ${sources.length} sources.`);

  // Embed + index sources into the vector index for RAG / next-best-material.
  try {
    await ensureVectorIndex(redis);
    const vecs = await embedBatch(sources.map((s) => `${s.title}. ${s.snippet ?? ""}`));
    await Promise.all(
      sources.map((s, i) =>
        indexMaterial(
          redis,
          {
            id: `src-${Buffer.from(s.url || s.title).toString("base64url").slice(0, 24)}`,
            kind: "source",
            refId: s.url,
            title: s.title,
            topic: job.topic,
            text: s.snippet ?? s.title,
            url: s.url,
          },
          vecs[i]
        )
      )
    );
  } catch (e) {
    console.warn("[curator] index sources failed:", (e as Error).message);
  }

  // L1: record the research as an interest signal. L2: propose follow-up topics.
  await recordSignal(redis, job.uid, { kind: "explore", topic: job.topic });
  state.followups = await proposeFollowups(redis, job.uid, job.topic, sources, synthesis);

  await save();
  await bus.publish(job.uid, {
    jobId: job.jobId,
    type: "done",
    status: "ready",
    result: { sources, synthesis, followups: state.followups },
  });
  return state;
}
