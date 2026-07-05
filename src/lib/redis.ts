import type Redis from "ioredis";
import { createStore } from "@/lib/core/store";

let client: Redis | null = null;

/**
 * Lazily-created shared storage client for the Next.js app. Resolves to the
 * active backend (Redis when REDIS_URL/REDIS_HOST is set, otherwise the
 * zero-infra in-memory store). Typed as ioredis `Redis` so existing callers are
 * unchanged; the in-memory adapter is command-compatible. See
 * `src/lib/core/store` to add or swap backends.
 */
export function getRedis(): Redis {
  if (client) return client;
  client = createStore() as unknown as Redis;
  return client;
}
