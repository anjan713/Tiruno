// Storage contract — the command surface the app/worker actually use.
//
// This is intentionally a Redis-shaped interface: ioredis satisfies it natively,
// and the in-memory adapter (./memory.ts) implements the same surface so the app
// runs with zero infra. New backends (Upstash, a Postgres shim, etc.) only need
// to implement these methods. RediSearch vector ops go through `call()` so the
// vector layer stays unchanged across adapters.

export interface RedisLike {
  // --- strings / KV ---
  get(key: string): Promise<string | null>;
  set(key: string, value: string | number, ...args: unknown[]): Promise<"OK" | null>;
  del(...keys: string[]): Promise<number>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  expire(key: string, seconds: number): Promise<number>;

  // --- hashes ---
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, ...args: unknown[]): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;

  // --- sets ---
  sadd(key: string, ...members: (string | number)[]): Promise<number>;
  scard(key: string): Promise<number>;
  smembers(key: string): Promise<string[]>;

  // --- sorted sets ---
  zadd(key: string, score: number | string, member: string): Promise<number>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;

  // --- lists ---
  lpush(key: string, ...values: (string | number)[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<"OK">;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  lindex(key: string, index: number): Promise<string | null>;

  // --- streams (job queue) ---
  xadd(key: string, ...args: (string | number)[]): Promise<string | null>;
  xreadgroup(...args: unknown[]): Promise<unknown>;
  xack(key: string, group: string, ...ids: string[]): Promise<number>;
  xgroup(...args: unknown[]): Promise<unknown>;

  // --- pub/sub (SSE realtime) ---
  publish(channel: string, message: string): Promise<number>;
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;

  // --- lifecycle / misc ---
  on(event: string, listener: (...args: never[]) => void): unknown;
  quit(): Promise<"OK">;
  duplicate(): RedisLike;
  /** Raw command escape hatch — used for RediSearch FT.* vector operations. */
  call(command: string, ...args: unknown[]): Promise<unknown>;
}

export type StoreProviderName = "redis" | "memory";
