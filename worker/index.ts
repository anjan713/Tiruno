import { loadEnv } from "./lib/env";
loadEnv();

import type Redis from "ioredis";
import { makeRedis } from "./lib/redis";
import { runExplore } from "./agents/curator";
import { runRebuildPath } from "./agents/learningPath";
import { runOrchestrate } from "./agents/orchestrator";
import { runNarrate } from "./agents/voice";
import { runCurate } from "./loops/l2";
import { recordSignal, bumpUnderstanding, type SignalKind } from "./loops/l1";
import { runGenerateLesson } from "./agents/lesson";
import { runIngestArticle } from "./agents/notebookIngest";
import { runIngestGmail } from "./agents/gmailIngest";
import { runNotebookCleanup, runRecordEngagement } from "./agents/notebookRetention";
import { enqueue } from "./lib/enqueue";
import { ensureVectorIndex } from "../src/lib/rag/vector";
import { notebookLMEnabled } from "../src/lib/core/notebooklm";

const STREAM = "jobs:agent";
const GROUP = "workers";
const CONSUMER = `w-${process.pid}`;

const DEAD_STREAM = "jobs:agent:dead";
const MAX_ATTEMPTS = Math.max(1, Number(process.env.WORKER_MAX_ATTEMPTS ?? 3));

interface Job {
  type: string;
  payload: Record<string, unknown>;
  id: string;
  /** 0-based count of prior failed attempts (carried across re-enqueues). */
  attempt: number;
}

function fieldsToJob(id: string, fields: string[]): Job {
  const map: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) map[fields[i]] = fields[i + 1];
  let payload: Record<string, unknown> = {};
  try {
    payload = map.payload ? JSON.parse(map.payload) : {};
  } catch {
    /* ignore malformed payload */
  }
  return { type: map.type ?? "unknown", payload, id, attempt: Number(map.attempt ?? 0) };
}

/**
 * On handler failure, retry by re-enqueuing with an incremented attempt count
 * (small backoff). After MAX_ATTEMPTS, route the job to the dead-letter stream
 * so it isn't lost or hot-looped.
 */
async function handleFailure(redis: Redis, job: Job, error: string): Promise<void> {
  const nextAttempt = job.attempt + 1;
  if (nextAttempt < MAX_ATTEMPTS) {
    await new Promise((r) => setTimeout(r, Math.min(5000, 250 * 2 ** job.attempt)));
    await redis.xadd(
      STREAM,
      "*",
      "type",
      job.type,
      "payload",
      JSON.stringify(job.payload),
      "attempt",
      String(nextAttempt)
    );
    console.warn(`[worker] retry ${nextAttempt}/${MAX_ATTEMPTS - 1} for type=${job.type}`);
  } else {
    await redis.xadd(
      DEAD_STREAM,
      "MAXLEN",
      "~",
      1000,
      "*",
      "type",
      job.type,
      "payload",
      JSON.stringify(job.payload),
      "error",
      error,
      "attempts",
      String(nextAttempt)
    );
    console.error(`[worker] dead-lettered type=${job.type} after ${nextAttempt} attempts`);
  }
}

/**
 * Code Router (deterministic): map routine jobs straight to the right agent.
 * Fuzzy/voice "what next?" requests will route to the Orchestrator agent (Phase C).
 */
async function route(redis: Redis, job: Job): Promise<void> {
  const uid = String(job.payload.uid ?? "demo");
  const jobId = String(job.payload.jobId ?? "");
  switch (job.type) {
    case "explore":
    case "find_articles":
      await runExplore(redis, { uid, jobId, topic: String(job.payload.topic ?? "") });
      return;
    case "orchestrate":
      await runOrchestrate(redis, { uid, jobId, request: String(job.payload.request ?? "") });
      return;
    case "rebuild_path":
      await runRebuildPath(redis, { uid, jobId });
      return;
    case "narrate":
    case "make_digest":
      await runNarrate(redis, {
        uid,
        jobId,
        text: job.payload.text ? String(job.payload.text) : undefined,
        articleId: job.payload.articleId ? String(job.payload.articleId) : undefined,
        topic: job.payload.topic ? String(job.payload.topic) : undefined,
      });
      return;
    case "signal":
      await recordSignal(redis, uid, {
        kind: String(job.payload.kind ?? "ask") as SignalKind,
        topic: job.payload.topic ? String(job.payload.topic) : undefined,
        meta: job.payload.meta ? String(job.payload.meta) : undefined,
      });
      if (job.payload.topic && typeof job.payload.delta === "number") {
        await bumpUnderstanding(redis, uid, String(job.payload.topic), Number(job.payload.delta));
      }
      return;
    case "curate":
      await runCurate(redis, uid);
      return;
    case "generate_lesson":
      await runGenerateLesson(redis, {
        uid,
        jobId,
        topic: String(job.payload.topic ?? ""),
        articleId: job.payload.articleId ? String(job.payload.articleId) : undefined,
      });
      return;
    case "ingest_article":
      await runIngestArticle(redis, {
        uid,
        jobId,
        articleId: job.payload.articleId ? String(job.payload.articleId) : undefined,
        url: job.payload.url ? String(job.payload.url) : undefined,
        title: job.payload.title ? String(job.payload.title) : undefined,
        topic: job.payload.topic ? String(job.payload.topic) : undefined,
        text: job.payload.text ? String(job.payload.text) : undefined,
        email: job.payload.email === true || job.payload.email === "true",
        force: job.payload.force === true || job.payload.force === "true",
        notebook: job.payload.notebook === "courses" ? "courses" : "articles",
      });
      return;
    case "ingest_gmail":
      await runIngestGmail(redis, {
        uid,
        jobId,
        max: typeof job.payload.max === "number" ? job.payload.max : undefined,
      });
      return;
    case "notebook_cleanup":
      await runNotebookCleanup(redis, { uid, jobId });
      return;
    case "notebook_engagement":
      await runRecordEngagement(redis, {
        uid,
        jobId,
        articleId: String(job.payload.articleId ?? ""),
        score: typeof job.payload.score === "number" ? job.payload.score : undefined,
      });
      return;
    default:
      console.warn(`[worker] unknown job type '${job.type}'`);
  }
}

async function ensureGroup(redis: Redis): Promise<void> {
  try {
    await redis.xgroup("CREATE", STREAM, GROUP, "$", "MKSTREAM");
    console.log(`[worker] created consumer group '${GROUP}' on '${STREAM}'`);
  } catch (e) {
    if (!String((e as Error).message).includes("BUSYGROUP")) throw e;
  }
}

/**
 * Periodic NotebookLM maintenance. Enqueues notebook_cleanup (rotation) every
 * NOTEBOOKLM_CLEANUP_INTERVAL_MS (default 1h; 0 disables) and optionally polls
 * Gmail every GMAIL_POLL_INTERVAL_MS (default off). Jobs go on the shared stream
 * so any worker in the group can pick them up.
 */
function startScheduler(redis: Redis): void {
  if (!notebookLMEnabled()) return;

  const cleanupMs = Number(process.env.NOTEBOOKLM_CLEANUP_INTERVAL_MS ?? 3600000);
  if (cleanupMs > 0) {
    setInterval(() => {
      void enqueue(redis, "notebook_cleanup", { uid: "system", jobId: `cleanup-${Date.now()}` }).catch((e) =>
        console.warn("[worker] cleanup schedule failed:", (e as Error).message)
      );
    }, cleanupMs);
    console.log(`[worker] scheduled notebook_cleanup every ${cleanupMs}ms`);
  }

  const gmailMs = Number(process.env.GMAIL_POLL_INTERVAL_MS ?? 0);
  if (gmailMs > 0) {
    setInterval(() => {
      void enqueue(redis, "ingest_gmail", { uid: "demo", jobId: `gmail-${Date.now()}` }).catch((e) =>
        console.warn("[worker] gmail schedule failed:", (e as Error).message)
      );
    }, gmailMs);
    console.log(`[worker] scheduled ingest_gmail every ${gmailMs}ms`);
  }
}

async function main(): Promise<void> {
  const redis = makeRedis();
  redis.on("error", (e) => console.warn("[worker][redis]", e.message));
  await ensureGroup(redis);
  try {
    await ensureVectorIndex(redis);
    console.log("[worker] vector index ready (idx:materials)");
  } catch (e) {
    console.warn("[worker] vector index unavailable:", (e as Error).message);
  }
  startScheduler(redis);
  console.log(`[worker] up — consuming '${STREAM}' as '${CONSUMER}'. Waiting for jobs…`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let resp: unknown;
    try {
      resp = await redis.xreadgroup(
        "GROUP",
        GROUP,
        CONSUMER,
        "COUNT",
        5,
        "BLOCK",
        5000,
        "STREAMS",
        STREAM,
        ">"
      );
    } catch (e) {
      console.warn("[worker] read error:", (e as Error).message);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    if (!resp) continue;

    // resp: [ [stream, [ [id, [k,v,...]], ... ]] ]
    for (const [, entries] of resp as [string, [string, string[]][]][]) {
      for (const [id, fields] of entries) {
        const job = fieldsToJob(id, fields);
        console.log(`[worker] job ${id} type=${job.type}${job.attempt ? ` (attempt ${job.attempt})` : ""}`);
        try {
          await route(redis, job);
        } catch (e) {
          const msg = (e as Error).message;
          console.error(`[worker] job ${id} failed:`, msg);
          try {
            await handleFailure(redis, job, msg);
          } catch (re) {
            console.error("[worker] retry/dead-letter failed:", (re as Error).message);
          }
        } finally {
          await redis.xack(STREAM, GROUP, id);
        }
      }
    }
  }
}

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
