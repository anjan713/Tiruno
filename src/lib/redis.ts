import Redis from "ioredis";

let client: Redis | null = null;

/** Lazily-created shared ioredis client. Prefers REDIS_URL (local dev), falls back to REDIS_* creds. */
export function getRedis(): Redis {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (url) {
    client = new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 4000 });
  } else {
    const ssl = String(process.env.REDIS_SSL ?? "").toLowerCase();
    client = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT ?? 6379),
      username: process.env.REDIS_USERNAME || undefined,
      password: process.env.REDIS_PWD || undefined,
      tls: ssl === "true" || ssl === "1" ? {} : undefined,
      maxRetriesPerRequest: 2,
      connectTimeout: 4000,
    });
  }

  // Prevent unhandled error events from crashing the process if Redis is down.
  client.on("error", (e) => {
    if (process.env.NODE_ENV !== "production") console.warn("[redis]", e.message);
  });

  return client;
}
