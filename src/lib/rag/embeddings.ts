// Pluggable text embeddings for the RAG layer.
//
// Provider is chosen from env at call time:
//   VOYAGE_API_KEY  -> Voyage AI   (voyage-3.5-lite, output_dimension = EMBED_DIM)
//   OPENAI_API_KEY  -> OpenAI      (text-embedding-3-small, dimensions = EMBED_DIM)
//   (neither)       -> deterministic local hashing embedding (offline-safe)
//
// Every provider returns an L2-normalized EMBED_DIM vector, so the Redis HNSW
// index (COSINE) is consistent regardless of which one is active.
//
// A Redis-backed cache (keyed by provider+model+text) embeds identical texts only
// once, keeping remote request volume low (important for rate-limited free tiers)
// and the index internally consistent.

import Redis from "ioredis";

/** Fixed embedding dimension. The vector index is created with this DIM. */
export const EMBED_DIM = 1024;

export type EmbeddingProvider = "voyage" | "openai" | "local";

/** Which provider will be used given the current environment. */
export function embeddingProvider(): EmbeddingProvider {
  const override = (process.env.EMBED_PROVIDER || "").toLowerCase();
  if (override === "local" || override === "voyage" || override === "openai") return override;
  if (process.env.VOYAGE_API_KEY) return "voyage";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "local";
}

function l2normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (!norm || !isFinite(norm)) return v.map(() => 0);
  return v.map((x) => x / norm);
}

/** FNV-1a 32-bit hash. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic hashing embedding (signed, bag-of-tokens + bigrams). It has no
 * deep semantics, but cosine similarity reflects real token overlap — enough to
 * make KNN retrieval meaningful offline and keep the demo fully self-contained.
 */
export function localEmbed(text: string): number[] {
  const vec = new Array<number>(EMBED_DIM).fill(0);
  const tokens = (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 1);
  const grams: string[] = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) grams.push(`${tokens[i]}_${tokens[i + 1]}`);
  for (const g of grams) {
    const h = fnv1a(g);
    const bucket = h % EMBED_DIM;
    const sign = (h >>> 31) & 1 ? -1 : 1;
    vec[bucket] += sign;
  }
  return l2normalize(vec);
}

function modelName(provider: EmbeddingProvider): string {
  if (provider === "voyage") return process.env.VOYAGE_MODEL || "voyage-3.5-lite";
  if (provider === "openai") return process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
  return "local";
}

// ---- Redis cache (lazy, optional) -----------------------------------------
let cacheClient: Redis | null | undefined;
function getCache(): Redis | null {
  if (cacheClient !== undefined) return cacheClient;
  const url = process.env.REDIS_URL;
  try {
    cacheClient = url ? new Redis(url, { maxRetriesPerRequest: 1 }) : null;
    cacheClient?.on("error", () => {});
  } catch {
    cacheClient = null;
  }
  return cacheClient;
}

const cacheKey = (provider: EmbeddingProvider, text: string) =>
  `emb:${provider}:${modelName(provider)}:${text.length}:${fnv1a(text).toString(36)}`;

async function cacheGet(key: string): Promise<number[] | null> {
  const c = getCache();
  if (!c) return null;
  try {
    const v = await c.get(key);
    return v ? (JSON.parse(v) as number[]) : null;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, vec: number[]): Promise<void> {
  const c = getCache();
  if (!c) return;
  try {
    await c.set(key, JSON.stringify(vec), "EX", 60 * 60 * 24 * 30);
  } catch {
    /* best effort */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST with retry/backoff on 429 + 5xx (honors Retry-After). Throws on final failure. */
async function postWithRetry(url: string, init: RequestInit, attempts = 4): Promise<Response> {
  const backoff = [1000, 4000, 10000, 20000];
  let lastErr = "";
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
      if (res.ok) return res;
      lastErr = String(res.status);
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after")) * 1000;
        if (i < attempts - 1) await sleep(ra > 0 ? ra : backoff[i]);
        continue;
      }
      throw new Error(lastErr);
    } catch (e) {
      lastErr = (e as Error).message;
      if (i < attempts - 1) await sleep(backoff[i]);
    }
  }
  throw new Error(lastErr || "request failed");
}

async function voyageEmbed(texts: string[]): Promise<number[][]> {
  const res = await postWithRetry("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: modelName("voyage"), input: texts, output_dimension: EMBED_DIM }),
  });
  const json = await res.json();
  return (json.data as Array<{ embedding: number[] }>).map((d) => l2normalize(d.embedding));
}

async function openaiEmbed(texts: string[]): Promise<number[][]> {
  const res = await postWithRetry("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: modelName("openai"), input: texts, dimensions: EMBED_DIM }),
  });
  const json = await res.json();
  return (json.data as Array<{ embedding: number[] }>).map((d) => l2normalize(d.embedding));
}

/**
 * Embed a batch of texts. Resolves cache hits first and only embeds the misses.
 * On provider failure, falls back to the local embedding (same dim) but does NOT
 * cache the fallback, so a later successful call can store the real vector.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const clean = texts.map((t) => (t || "").slice(0, 8000));
  const provider = embeddingProvider();
  const keys = clean.map((t) => cacheKey(provider, t));
  const out = new Array<number[] | null>(clean.length).fill(null);

  await Promise.all(keys.map(async (k, i) => { out[i] = await cacheGet(k); }));

  const missIdx = out.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  if (missIdx.length) {
    const missTexts = missIdx.map((i) => clean[i]);
    let vecs: number[][];
    let usedFallback = false;
    try {
      if (provider === "voyage") vecs = await voyageEmbed(missTexts);
      else if (provider === "openai") vecs = await openaiEmbed(missTexts);
      else vecs = missTexts.map(localEmbed);
    } catch (e) {
      console.warn(`[embeddings] ${provider} failed, using local:`, (e as Error).message);
      vecs = missTexts.map(localEmbed);
      usedFallback = true;
    }
    await Promise.all(
      missIdx.map(async (idx, j) => {
        out[idx] = vecs[j];
        if (!usedFallback) await cacheSet(keys[idx], vecs[j]);
      })
    );
  }

  return out.map((v) => v ?? localEmbed(""));
}

/** Embed a single text into an EMBED_DIM L2-normalized vector. */
export async function embed(text: string): Promise<number[]> {
  const [v] = await embedBatch([text]);
  return v;
}
