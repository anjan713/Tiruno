import type Redis from "ioredis";
import { makeBus } from "../lib/bus";
import { recordSignal } from "../loops/l1";

export interface NarrateJob {
  uid: string;
  jobId: string;
  text?: string;
  articleId?: string;
  topic?: string;
}

/**
 * Voice agent: resolves the script to narrate and emits it for the client to speak
 * via Deepgram (/api/tts). Actual audio synthesis stays in the browser; this agent
 * owns selecting/shaping the narration text and recording the listen signal.
 */
export async function runNarrate(redis: Redis, job: NarrateJob): Promise<void> {
  const bus = makeBus(redis);
  let text = (job.text ?? "").trim();

  if (!text && job.articleId) {
    try {
      const raw = await redis.get(`article:${job.articleId}`);
      if (raw) {
        const a = JSON.parse(raw);
        text = String(a.summary || a.text || "").trim();
      }
    } catch {
      /* ignore */
    }
  }

  if (!text) {
    await bus.publish(job.uid, { jobId: job.jobId, type: "error", status: "error", error: "Nothing to narrate" });
    return;
  }

  await recordSignal(redis, job.uid, { kind: "listen", topic: job.topic });
  await bus.publish(job.uid, {
    jobId: job.jobId,
    type: "done",
    status: "ready",
    result: { text: text.slice(0, 1500) },
  });
}
