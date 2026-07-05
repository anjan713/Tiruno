import { getRedis } from "@/lib/redis";
import type { FeedbackEntry, FeedbackStore } from "./types";

/**
 * Redis-backed feedback store: a capped per-user list (newest first). Substitutable
 * for any other FeedbackStore (LSP) and fails soft so feedback logging can never break
 * the request that produced it.
 */
export class RedisFeedbackStore implements FeedbackStore {
  private static readonly MAX = 200;

  constructor(private readonly uid: string) {}

  private key(): string {
    return `tiru:feedback:${this.uid}`;
  }

  async add(entry: FeedbackEntry): Promise<void> {
    try {
      const r = getRedis();
      await r.lpush(this.key(), JSON.stringify(entry));
      await r.ltrim(this.key(), 0, RedisFeedbackStore.MAX - 1);
    } catch {
      /* best-effort: feedback logging must never fail the caller */
    }
  }

  async list(limit = 50): Promise<FeedbackEntry[]> {
    try {
      const r = getRedis();
      const raw = await r.lrange(this.key(), 0, Math.max(0, limit - 1));
      return raw
        .map((x) => {
          try {
            return JSON.parse(x) as FeedbackEntry;
          } catch {
            return null;
          }
        })
        .filter((e): e is FeedbackEntry => e !== null);
    } catch {
      return [];
    }
  }
}
