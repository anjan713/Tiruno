// Storage registry — selects the active backend from the environment.
//
// STORE_PROVIDER=redis|memory forces a choice. Auto-detection:
//   REDIS_URL or REDIS_HOST set -> redis
//   (none)                      -> memory  (zero-infra dev/demo)

import Redis from "ioredis";
import { MemoryRedis } from "./memory";
import type { RedisLike, StoreProviderName } from "./types";

export type { RedisLike, StoreProviderName } from "./types";
export { MemoryRedis } from "./memory";

export function storeProviderName(): StoreProviderName {
  const override = (process.env.STORE_PROVIDER || "").toLowerCase();
  if (override === "memory") return "memory";
  if (override === "redis") return "redis";
  if (process.env.REDIS_URL || process.env.REDIS_HOST) return "redis";
  return "memory";
}

export interface CreateStoreOptions {
  /**
   * Set for clients that issue blocking commands (XREADGROUP ... BLOCK), i.e. the
   * worker. Uses maxRetriesPerRequest: null so idle waits don't throw.
   */
  blocking?: boolean;
}

// Log the "redis unavailable" warning only once per process to avoid flooding the
// console when a configured server is down (ioredis re-emits on every reconnect).
let warnedUnavailable = false;

function createIoRedis(opts: CreateStoreOptions): Redis {
  const isProd = process.env.NODE_ENV === "production";
  const maxRetriesPerRequest = opts.blocking ? null : 2;
  // In dev/demo we never want a down server to make requests hang: don't queue
  // commands while offline (they fail fast, then we fall back to memory), and cap
  // reconnection backoff so the logs stay quiet.
  const common = {
    maxRetriesPerRequest,
    connectTimeout: isProd ? 4000 : 1500,
    enableOfflineQueue: isProd,
    retryStrategy: (times: number) => Math.min(times * 200, isProd ? 2000 : 5000),
  };
  const url = process.env.REDIS_URL;
  let client: Redis;
  if (url) {
    client = new Redis(url, common);
  } else {
    const ssl = String(process.env.REDIS_SSL ?? "").toLowerCase();
    client = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT ?? 6379),
      username: process.env.REDIS_USERNAME || undefined,
      password: process.env.REDIS_PWD || undefined,
      tls: ssl === "true" || ssl === "1" ? {} : undefined,
      ...common,
    });
  }
  client.on("error", (e) => {
    if (!warnedUnavailable && !isProd) {
      warnedUnavailable = true;
      console.warn(`[store] redis unavailable (${e.message}); falling back to in-memory store for this session.`);
    }
  });
  return client;
}

/**
 * Transparent resilience wrapper for dev/demo: route every command to Redis while
 * it's connected, otherwise to an in-memory store. This keeps the app fully usable
 * (and fast) even when a configured REDIS_URL points at a server that isn't running.
 */
function makeResilientStore(redis: Redis): RedisLike {
  const memory = new MemoryRedis();
  const active = (): RedisLike =>
    redis.status === "ready" ? (redis as unknown as RedisLike) : memory;
  return new Proxy({} as RedisLike, {
    get(_target, prop: string | symbol) {
      const backend = active() as unknown as Record<string | symbol, unknown>;
      const value = backend[prop];
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(backend)
        : value;
    },
  });
}

/** Create a storage client for the active backend. */
export function createStore(opts: CreateStoreOptions = {}): RedisLike {
  if (storeProviderName() === "memory") return new MemoryRedis();
  const redis = createIoRedis(opts);
  // Production must use the configured store as-is (fail loudly on outages).
  if (process.env.NODE_ENV === "production") return redis as unknown as RedisLike;
  return makeResilientStore(redis);
}
