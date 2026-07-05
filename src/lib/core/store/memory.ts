import { EventEmitter } from "node:events";
import type { RedisLike } from "./types";

// In-memory Redis-compatible adapter. Lets Tiruno run with ZERO infrastructure
// for local dev / demos / tests. All state lives in one process-wide "hub" so
// every MemoryRedis instance (including duplicate() for pub/sub) shares data,
// mimicking a single Redis server.
//
// Limitation: it cannot bridge two OS processes. The Next.js app and the
// standalone worker each get their own hub, so worker<->app realtime needs real
// Redis. Within a single process everything works.

interface StreamEntry {
  id: string;
  fields: string[];
}
interface StreamState {
  entries: StreamEntry[];
  groups: Map<string, { lastId: string }>;
}

class MemoryHub {
  kv = new Map<string, { value: string; expireAt?: number }>();
  hashes = new Map<string, Map<string, string>>();
  sets = new Map<string, Set<string>>();
  zsets = new Map<string, Map<string, number>>();
  lists = new Map<string, string[]>();
  streams = new Map<string, StreamState>();
  /** Vector index emulation: key -> { fields, vec }. */
  vectors = new Map<string, { fields: Record<string, string>; vec: Float32Array }>();
  vectorIndex = false;
  /** Cross-instance pub/sub + stream wakeups. */
  events = new EventEmitter();

  constructor() {
    this.events.setMaxListeners(0);
  }

  alive(key: string): boolean {
    const e = this.kv.get(key);
    if (!e) return true; // non-string keys have no TTL here
    if (e.expireAt && e.expireAt < Date.now()) {
      this.kv.delete(key);
      return false;
    }
    return true;
  }
}

const globalKey = "__tiruno_memory_hub__";
// Reuse a single hub across HMR reloads in dev.
const g = globalThis as unknown as Record<string, MemoryHub | undefined>;
const hub: MemoryHub = g[globalKey] ?? (g[globalKey] = new MemoryHub());

const seqRef = { n: 0 };
function nextStreamId(): string {
  return `${Date.now()}-${seqRef.n++}`;
}

function cmpId(a: string, b: string): number {
  const [am, as] = a.split("-").map(Number);
  const [bm, bs] = b.split("-").map(Number);
  return am !== bm ? am - bm : (as || 0) - (bs || 0);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A single in-memory client. All instances share the process-wide hub. */
export class MemoryRedis implements RedisLike {
  /** Marker so callers can detect the in-memory backend if needed. */
  readonly isMemory = true;
  private subscriptions = new Set<string>();
  private messageHandler?: (channel: string, message: string) => void;
  private onMessage = (channel: string, message: string) => {
    if (this.subscriptions.has(channel)) this.messageHandler?.(channel, message);
  };

  constructor() {
    hub.events.on("message", this.onMessage);
  }

  // --- strings / KV ---
  async get(key: string): Promise<string | null> {
    if (!hub.alive(key)) return null;
    return hub.kv.get(key)?.value ?? null;
  }

  async set(key: string, value: string | number, ...args: unknown[]): Promise<"OK"> {
    let expireAt: number | undefined;
    for (let i = 0; i < args.length - 1; i++) {
      const flag = String(args[i]).toUpperCase();
      if (flag === "EX") expireAt = Date.now() + Number(args[i + 1]) * 1000;
      if (flag === "PX") expireAt = Date.now() + Number(args[i + 1]);
    }
    hub.kv.set(key, { value: String(value), expireAt });
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      const had = hub.kv.delete(k) || hub.hashes.delete(k) || hub.sets.delete(k) || hub.zsets.delete(k) || hub.lists.delete(k);
      if (had) n++;
    }
    return n;
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    return keys.map((k) => (hub.alive(k) ? hub.kv.get(k)?.value ?? null : null));
  }

  async expire(key: string, seconds: number): Promise<number> {
    const e = hub.kv.get(key);
    if (e) {
      e.expireAt = Date.now() + seconds * 1000;
      return 1;
    }
    return 0;
  }

  // --- hashes ---
  async hget(key: string, field: string): Promise<string | null> {
    return hub.hashes.get(key)?.get(field) ?? null;
  }

  async hset(key: string, ...args: unknown[]): Promise<number> {
    const h = hub.hashes.get(key) ?? new Map<string, string>();
    hub.hashes.set(key, h);
    let added = 0;
    if (args.length === 1 && typeof args[0] === "object" && args[0]) {
      for (const [f, v] of Object.entries(args[0] as Record<string, unknown>)) {
        if (!h.has(f)) added++;
        h.set(f, String(v));
      }
    } else {
      for (let i = 0; i < args.length - 1; i += 2) {
        const f = String(args[i]);
        if (!h.has(f)) added++;
        h.set(f, String(args[i + 1]));
      }
    }
    return added;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const h = hub.hashes.get(key);
    return h ? Object.fromEntries(h) : {};
  }

  // --- sets ---
  async sadd(key: string, ...members: (string | number)[]): Promise<number> {
    const s = hub.sets.get(key) ?? new Set<string>();
    hub.sets.set(key, s);
    let added = 0;
    for (const m of members) {
      const v = String(m);
      if (!s.has(v)) {
        s.add(v);
        added++;
      }
    }
    return added;
  }

  async scard(key: string): Promise<number> {
    return hub.sets.get(key)?.size ?? 0;
  }

  async sismember(key: string, member: string | number): Promise<number> {
    return hub.sets.get(key)?.has(String(member)) ? 1 : 0;
  }

  async smembers(key: string): Promise<string[]> {
    return [...(hub.sets.get(key) ?? [])];
  }

  async srem(key: string, ...members: (string | number)[]): Promise<number> {
    const s = hub.sets.get(key);
    if (!s) return 0;
    let n = 0;
    for (const m of members) if (s.delete(String(m))) n++;
    return n;
  }

  // --- sorted sets ---
  async zadd(key: string, score: number | string, member: string): Promise<number> {
    const z = hub.zsets.get(key) ?? new Map<string, number>();
    hub.zsets.set(key, z);
    const had = z.has(member);
    z.set(member, Number(score));
    return had ? 0 : 1;
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const z = hub.zsets.get(key);
    if (!z) return [];
    const sorted = [...z.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
    const end = stop < 0 ? sorted.length + stop + 1 : stop + 1;
    return sorted.slice(start, end);
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    const z = hub.zsets.get(key);
    if (!z) return [];
    const sorted = [...z.entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m);
    const end = stop < 0 ? sorted.length + stop + 1 : stop + 1;
    return sorted.slice(start, end);
  }

  async zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]> {
    const z = hub.zsets.get(key);
    if (!z) return [];
    const lo = min === "-inf" ? -Infinity : Number(min);
    const hi = max === "+inf" ? Infinity : Number(max);
    return [...z.entries()]
      .filter(([, s]) => s >= lo && s <= hi)
      .sort((a, b) => a[1] - b[1])
      .map(([m]) => m);
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    const z = hub.zsets.get(key);
    if (!z) return 0;
    let n = 0;
    for (const m of members) if (z.delete(m)) n++;
    return n;
  }

  // --- lists ---
  async lpush(key: string, ...values: (string | number)[]): Promise<number> {
    const l = hub.lists.get(key) ?? [];
    hub.lists.set(key, l);
    for (const v of values) l.unshift(String(v));
    return l.length;
  }

  async ltrim(key: string, start: number, stop: number): Promise<"OK"> {
    const l = hub.lists.get(key);
    if (l) {
      const end = stop < 0 ? l.length + stop + 1 : stop + 1;
      hub.lists.set(key, l.slice(start, end));
    }
    return "OK";
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const l = hub.lists.get(key) ?? [];
    const end = stop < 0 ? l.length + stop + 1 : stop + 1;
    return l.slice(start, end);
  }

  async lindex(key: string, index: number): Promise<string | null> {
    const l = hub.lists.get(key) ?? [];
    const i = index < 0 ? l.length + index : index;
    return l[i] ?? null;
  }

  // --- streams (job queue) ---
  async xadd(key: string, ...args: (string | number)[]): Promise<string> {
    let i = 0;
    let maxlen = 0;
    if (String(args[0]).toUpperCase() === "MAXLEN") {
      i = String(args[1]) === "~" ? 3 : 2; // MAXLEN [~] N
      maxlen = Number(args[i - 1]);
    }
    if (String(args[i]) === "*") i++; // auto id
    const id = nextStreamId();
    const fields = args.slice(i).map(String);
    const st: StreamState = hub.streams.get(key) ?? { entries: [], groups: new Map() };
    hub.streams.set(key, st);
    st.entries.push({ id, fields });
    if (maxlen > 0 && st.entries.length > maxlen) st.entries.splice(0, st.entries.length - maxlen);
    hub.events.emit(`stream:${key}`);
    return id;
  }

  async xgroup(...args: unknown[]): Promise<"OK"> {
    const [sub, key, group, start] = args.map(String);
    if (sub.toUpperCase() === "CREATE") {
      const st: StreamState = hub.streams.get(key) ?? { entries: [], groups: new Map() };
      hub.streams.set(key, st);
      if (st.groups.has(group)) {
        const err = new Error("BUSYGROUP Consumer Group name already exists");
        throw err;
      }
      const lastId = start === "$" ? st.entries[st.entries.length - 1]?.id ?? "0-0" : "0-0";
      st.groups.set(group, { lastId });
    }
    return "OK";
  }

  async xreadgroup(...args: unknown[]): Promise<unknown> {
    const a = args.map(String);
    const group = a[a.indexOf("GROUP") + 1];
    const blockIdx = a.indexOf("BLOCK");
    const blockMs = blockIdx >= 0 ? Number(a[blockIdx + 1]) : 0;
    const countIdx = a.indexOf("COUNT");
    const count = countIdx >= 0 ? Number(a[countIdx + 1]) : 10;
    const streamsIdx = a.indexOf("STREAMS");
    const key = a[streamsIdx + 1];

    const read = (): unknown | null => {
      const st = hub.streams.get(key);
      const g = st?.groups.get(group);
      if (!st || !g) return null;
      const fresh = st.entries.filter((e) => cmpId(e.id, g.lastId) > 0).slice(0, count);
      if (!fresh.length) return null;
      g.lastId = fresh[fresh.length - 1].id;
      return [[key, fresh.map((e) => [e.id, e.fields])]];
    };

    const first = read();
    if (first || blockMs === 0) return first;

    // Block up to blockMs for a new entry.
    return new Promise((resolve) => {
      let done = false;
      const finish = (val: unknown) => {
        if (done) return;
        done = true;
        hub.events.off(`stream:${key}`, onPush);
        resolve(val);
      };
      const onPush = () => finish(read());
      hub.events.on(`stream:${key}`, onPush);
      sleep(blockMs).then(() => finish(read()));
    });
  }

  async xack(): Promise<number> {
    return 1; // offset already advanced on read
  }

  // --- pub/sub ---
  async publish(channel: string, message: string): Promise<number> {
    hub.events.emit("message", channel, message);
    return 1;
  }

  async subscribe(...channels: string[]): Promise<number> {
    for (const c of channels) this.subscriptions.add(c);
    return this.subscriptions.size;
  }

  async unsubscribe(...channels: string[]): Promise<number> {
    if (channels.length === 0) this.subscriptions.clear();
    else for (const c of channels) this.subscriptions.delete(c);
    return this.subscriptions.size;
  }

  // --- lifecycle / misc ---
  on(event: string, listener: (...args: never[]) => void): this {
    // ioredis emits "message" with (channel, message); route those to subscribers.
    if (event === "message") this.messageHandler = listener as unknown as typeof this.messageHandler;
    return this;
  }

  async quit(): Promise<"OK"> {
    hub.events.off("message", this.onMessage);
    this.subscriptions.clear();
    return "OK";
  }

  disconnect(): void {
    hub.events.off("message", this.onMessage);
  }

  duplicate(): MemoryRedis {
    return new MemoryRedis();
  }

  // --- RediSearch FT.* emulation (vector index) ---
  async call(command: string, ...args: unknown[]): Promise<unknown> {
    const cmd = command.toUpperCase();
    if (cmd === "FT.CREATE") {
      hub.vectorIndex = true;
      return "OK";
    }
    if (cmd === "HSET") return this.vectorHset(args);
    if (cmd === "FT.SEARCH") return this.vectorSearch(args);
    if (cmd === "FT.DROPINDEX") {
      hub.vectorIndex = false;
      hub.vectors.clear();
      return "OK";
    }
    return null;
  }

  private vectorHset(args: unknown[]): number {
    const key = String(args[0]);
    const fields: Record<string, string> = {};
    let vec: Float32Array | undefined;
    for (let i = 1; i < args.length - 1; i += 2) {
      const f = String(args[i]);
      const v = args[i + 1];
      if (f === "embedding" && (v instanceof Buffer || v instanceof Uint8Array)) {
        const buf = v instanceof Buffer ? v : Buffer.from(v);
        vec = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
      } else {
        fields[f] = String(v);
      }
    }
    hub.vectors.set(key, { fields, vec: vec ?? new Float32Array() });
    return 1;
  }

  private vectorSearch(args: unknown[]): unknown[] {
    // args: [INDEX, query, "PARAMS","2","BLOB",<buf>, "SORTBY","score","ASC", "RETURN",n,...fields, "DIALECT","2", "LIMIT","0",k]
    const a = args.map((x) => x);
    const query = String(a[1]);
    const knn = Number(query.match(/KNN\s+(\d+)/)?.[1] ?? 5);
    const kindFilter = query.match(/@kind:\{([^}]+)\}/)?.[1];
    const blobIdx = a.findIndex((x) => x === "BLOB");
    const blob = a[blobIdx + 1];
    const buf = blob instanceof Buffer ? blob : Buffer.from(blob as Uint8Array);
    const q = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));

    const scored: Array<{ key: string; dist: number; fields: Record<string, string> }> = [];
    for (const [key, entry] of hub.vectors) {
      if (kindFilter && entry.fields.kind !== kindFilter) continue;
      scored.push({ key, dist: cosineDistance(q, entry.vec), fields: entry.fields });
    }
    scored.sort((x, y) => x.dist - y.dist);
    const top = scored.slice(0, knn);

    const reply: unknown[] = [top.length];
    for (const hit of top) {
      const fieldArr: string[] = ["score", String(hit.dist)];
      for (const [f, v] of Object.entries(hit.fields)) fieldArr.push(f, v);
      reply.push(hit.key, fieldArr);
    }
    return reply;
  }
}

function cosineDistance(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 1;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return 1 - sim; // cosine distance, matching Redis COSINE metric
}
