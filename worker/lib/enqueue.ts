import type Redis from "ioredis";

/**
 * Enqueue a job for the agent worker onto the `jobs:agent` Redis Stream.
 * Worker-side mirror of `src/lib/jobs.ts` `enqueue()` — lets agents kick off
 * follow-up jobs (e.g. curator → ingest_article).
 */
export async function enqueue(redis: Redis, type: string, payload: Record<string, unknown>): Promise<string> {
  const id = await redis.xadd("jobs:agent", "*", "type", type, "payload", JSON.stringify(payload));
  return id ?? "";
}
