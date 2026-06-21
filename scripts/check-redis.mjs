// Quick Redis Cloud connectivity + module check. Run:
//   node --env-file=.env.local scripts/check-redis.mjs
// Prints only non-secret diagnostics.
import Redis from "ioredis";

const ssl = String(process.env.REDIS_SSL ?? "").toLowerCase();
const useTls = ssl === "true" || ssl === "1" || ssl === "yes";

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT ?? 6379),
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PWD || undefined,
  tls: useTls ? {} : undefined,
  connectTimeout: 8000,
  maxRetriesPerRequest: 1,
});

try {
  const pong = await redis.ping();
  console.log("PING:", pong);

  let modules = [];
  try {
    const raw = await redis.call("MODULE", "LIST");
    modules = (raw ?? []).map((m) => (Array.isArray(m) ? m[1] : m));
  } catch (e) {
    console.log("MODULE LIST not permitted:", e.message);
  }
  console.log("MODULES:", modules.length ? modules.join(", ") : "(none / hidden)");
  console.log("hasRediSearch:", modules.map(String).some((m) => /search/i.test(m)));
  console.log("hasRedisJSON:", modules.map(String).some((m) => /json|ReJSON/i.test(m)));

  await redis.set("tiruno:healthcheck", "ok", "EX", 30);
  console.log("SET/GET:", await redis.get("tiruno:healthcheck"));
} catch (e) {
  console.error("REDIS ERROR:", e.message);
  process.exitCode = 1;
} finally {
  redis.disconnect();
}
