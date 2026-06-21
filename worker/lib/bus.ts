import type Redis from "ioredis";

/** Realtime message published on `rt:{uid}` (→ SSE) and appended to `events:{uid}` stream. */
export interface RtMessage {
  jobId: string;
  type: "progress" | "done" | "error";
  step?: string;
  status?: string;
  result?: unknown;
  error?: string;
  at: number;
}

export interface Bus {
  publish: (uid: string, msg: Omit<RtMessage, "at">) => Promise<void>;
}

/** Pub/sub + event-stream bridge to the UI. */
export function makeBus(redis: Redis): Bus {
  return {
    async publish(uid, msg) {
      const full: RtMessage = { ...msg, at: Date.now() };
      const payload = JSON.stringify(full);
      try {
        await redis.publish(`rt:${uid}`, payload);
        await redis.xadd(`events:${uid}`, "MAXLEN", "~", 500, "*", "data", payload);
      } catch (e) {
        console.warn("[bus] publish failed:", (e as Error).message);
      }
    },
  };
}
