import type Redis from "ioredis";
import { createStore } from "../../src/lib/core/store";

/**
 * Create a storage client for the worker via the shared registry. Resolves to
 * Redis (REDIS_URL/REDIS_HOST) or the in-memory store. `blocking: true` keeps
 * XREADGROUP ... BLOCK from throwing on idle waits (maxRetriesPerRequest: null).
 * Typed as ioredis `Redis` so existing worker code is unchanged.
 */
export function makeRedis(): Redis {
  return createStore({ blocking: true }) as unknown as Redis;
}
