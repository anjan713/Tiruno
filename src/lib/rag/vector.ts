// Redis 8 / RediSearch vector index (HNSW + COSINE) for retrieval-augmented
// "next-best-material" search. Functions take an ioredis client so the same code
// runs in the Next.js app (shared client) and the standalone worker (its own client).

import type Redis from "ioredis";
import { EMBED_DIM } from "./embeddings";

const INDEX = "idx:materials";
const PREFIX = "vec:";

/** A unit of learning material that can be retrieved: a lesson, article, or source. */
export interface Material {
  id: string;
  kind: "lesson" | "article" | "source";
  refId: string; // id/slug to navigate to (lesson id, article id, or url)
  title: string;
  topic: string;
  text: string;
  url?: string;
}

export interface SearchHit {
  id: string;
  score: number; // cosine similarity in [0,1] (1 = identical)
  kind: string;
  refId: string;
  title: string;
  topic: string;
  text: string;
  url: string;
}

/** Pack a float vector into a little-endian FLOAT32 buffer for Redis. */
export function floatBuffer(vec: number[]): Buffer {
  const f = new Float32Array(vec);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

// Ensure the index exists at most once per process.
let ensured = false;

/** Create the HNSW vector index if it doesn't already exist. Idempotent. */
export async function ensureVectorIndex(redis: Redis): Promise<void> {
  if (ensured) return;
  try {
    await redis.call(
      "FT.CREATE", INDEX,
      "ON", "HASH",
      "PREFIX", "1", PREFIX,
      "SCHEMA",
      "title", "TEXT",
      "topic", "TEXT",
      "kind", "TAG",
      "refId", "TEXT", "NOSTEM",
      "url", "TEXT", "NOSTEM",
      "text", "TEXT",
      "embedding", "VECTOR", "HNSW", "6",
      "TYPE", "FLOAT32",
      "DIM", String(EMBED_DIM),
      "DISTANCE_METRIC", "COSINE"
    );
    ensured = true;
  } catch (e) {
    const msg = String((e as Error).message);
    if (msg.includes("Index already exists")) {
      ensured = true;
      return;
    }
    throw e;
  }
}

/** Upsert a material + its embedding into the vector index. */
export async function indexMaterial(redis: Redis, m: Material, vector: number[]): Promise<void> {
  const key = `${PREFIX}${m.id}`;
  await redis.call(
    "HSET", key,
    "title", m.title || "",
    "topic", m.topic || "",
    "kind", m.kind,
    "refId", m.refId || "",
    "url", m.url || "",
    "text", (m.text || "").slice(0, 4000),
    "embedding", floatBuffer(vector)
  );
}

interface SearchOpts {
  kind?: Material["kind"];
}

/** KNN search: returns the k nearest materials to the query vector. */
export async function searchMaterials(
  redis: Redis,
  queryVec: number[],
  k = 5,
  opts: SearchOpts = {}
): Promise<SearchHit[]> {
  const filter = opts.kind ? `@kind:{${opts.kind}}` : "*";
  const query = `(${filter})=>[KNN ${k} @embedding $BLOB AS score]`;
  const reply = (await redis.call(
    "FT.SEARCH", INDEX, query,
    "PARAMS", "2", "BLOB", floatBuffer(queryVec),
    "SORTBY", "score", "ASC",
    "RETURN", "7", "score", "title", "topic", "kind", "refId", "url", "text",
    "DIALECT", "2",
    "LIMIT", "0", String(k)
  )) as unknown[];

  const hits: SearchHit[] = [];
  // reply: [count, key1, [f,v,f,v,...], key2, [...], ...]
  for (let i = 1; i < reply.length; i += 2) {
    const id = String(reply[i]).replace(/^vec:/, "");
    const fields = reply[i + 1] as string[];
    const f: Record<string, string> = {};
    for (let j = 0; j < fields.length; j += 2) f[String(fields[j])] = String(fields[j + 1]);
    const distance = Number(f.score ?? 1);
    hits.push({
      id,
      score: Math.max(0, 1 - distance), // cosine distance -> similarity
      kind: f.kind ?? "",
      refId: f.refId ?? "",
      title: f.title ?? "",
      topic: f.topic ?? "",
      text: f.text ?? "",
      url: f.url ?? "",
    });
  }
  return hits;
}
