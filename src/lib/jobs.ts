import { getRedis } from "@/lib/redis";

/** Enqueue a job for the agent worker onto the `jobs:agent` Redis Stream. */
export async function enqueue(type: string, payload: Record<string, unknown>): Promise<string> {
  const r = getRedis();
  const id = await r.xadd("jobs:agent", "*", "type", type, "payload", JSON.stringify(payload));
  return id ?? "";
}
