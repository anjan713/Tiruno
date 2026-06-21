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
import { ensureVectorIndex } from "../src/lib/rag/vector";

const STREAM = "jobs:agent";
const GROUP = "workers";
const CONSUMER = `w-${process.pid}`;

interface Job {
  type: string;
  payload: Record<string, unknown>;
  id: string;
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
  return { type: map.type ?? "unknown", payload, id };
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
        console.log(`[worker] job ${id} type=${job.type}`);
        try {
          await route(redis, job);
        } catch (e) {
          console.error(`[worker] job ${id} failed:`, (e as Error).message);
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
