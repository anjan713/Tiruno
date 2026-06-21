import Redis from "ioredis";

/**
 * Create an ioredis client for the worker. Prefers REDIS_URL (local dev Redis Stack),
 * falls back to REDIS_* cloud creds. `maxRetriesPerRequest: null` is required so that
 * blocking commands (XREADGROUP ... BLOCK) don't throw on idle waits.
 */
export function makeRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (url) {
    return new Redis(url, { maxRetriesPerRequest: null });
  }
  const ssl = String(process.env.REDIS_SSL ?? "").toLowerCase();
  return new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT ?? 6379),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PWD || undefined,
    tls: ssl === "true" || ssl === "1" ? {} : undefined,
    maxRetriesPerRequest: null,
  });
}
