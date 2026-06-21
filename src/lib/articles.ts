import { getRedis } from "@/lib/redis";
import { notebooklmSummarize, localSummarize } from "@/lib/notebooklm";
import { embed } from "@/lib/rag/embeddings";
import { ensureVectorIndex, indexMaterial } from "@/lib/rag/vector";

/**
 * Article storage in (local) Redis.
 *
 * Key pattern / JSON shape:
 *   article:{id}            -> JSON string of StoredArticle (below)
 *   articles:index          -> ZSET  member=id, score=addedAt (newest first)
 *   articles:daily:{date}   -> SET   of article ids generated for that day (TTL 2d)
 */

export type ArticleStatus = "summarizing" | "ready" | "error";

export interface StoredArticle {
  id: string;
  url?: string;
  title: string;
  source: string;
  topic: string;
  text: string;
  summary: string;
  status: ArticleStatus;
  ready: boolean;
  kind: "bookmark" | "daily";
  addedAt: number;
}

const KEY = (id: string) => `article:${id}`;
const INDEX = "articles:index";
const DAILY = (date: string) => `articles:daily:${date}`;

export const todayKey = () => new Date().toISOString().slice(0, 10);
export const genId = () => Math.random().toString(36).slice(2, 10);

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

export async function saveArticle(a: StoredArticle): Promise<void> {
  const r = getRedis();
  await r.set(KEY(a.id), JSON.stringify(a));
  await r.zadd(INDEX, a.addedAt, a.id);
}

/** Embed + index an article into the vector index (best-effort). */
export async function indexArticleVector(a: StoredArticle): Promise<void> {
  try {
    const r = getRedis();
    await ensureVectorIndex(r);
    const vec = await embed(`${a.title}. ${a.summary} ${a.text}`);
    await indexMaterial(
      r,
      { id: `art-${a.id}`, kind: "article", refId: a.id, title: a.title, topic: a.topic, text: a.summary || a.text, url: a.url },
      vec
    );
  } catch {
    /* best effort */
  }
}

export async function getArticle(id: string): Promise<StoredArticle | null> {
  const raw = await getRedis().get(KEY(id));
  return raw ? (JSON.parse(raw) as StoredArticle) : null;
}

export async function listArticles(limit = 50): Promise<StoredArticle[]> {
  const r = getRedis();
  const ids = await r.zrevrange(INDEX, 0, limit - 1);
  if (!ids.length) return [];
  const raws = await r.mget(...ids.map(KEY));
  return raws.filter(Boolean).map((x) => JSON.parse(x as string) as StoredArticle);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[String(n).toLowerCase()] ?? " ");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ");
}

/** True for snippets that look like script/markup rather than readable prose. */
function looksLikeCode(s: string): boolean {
  return /[{}]|=>|;\s|\bfunction\s*\(|addEventListener|querySelector|document\.|window\.|@click|x-data|=\s*\(/.test(s);
}

function isProse(s: string): boolean {
  if (s.length < 40) return false;
  if (looksLikeCode(s)) return false;
  if (s.split(/\s+/).filter(Boolean).length < 6) return false;
  const symbolRatio = s.replace(/[a-z0-9\s.,'"’“”():%–—-]/gi, "").length / s.length;
  return symbolRatio < 0.12;
}

function metaContent(html: string, attr: "name" | "property", key: string): string | undefined {
  const a = new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']*)["']`, "i");
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${key}["']`, "i");
  return html.match(a)?.[1] ?? html.match(b)?.[1];
}

/** Extract readable article text: prefer real paragraphs, drop scripts/markup. */
function extractReadable(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ");

  const paras: string[] = [];
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(cleaned))) {
    const t = decodeEntities(stripTags(m[1])).replace(/\s+/g, " ").trim();
    if (isProse(t)) paras.push(t);
  }

  let text = paras.join(" ");
  if (text.length < 200) {
    const region =
      cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
      cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
      cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ??
      cleaned;
    const flat = decodeEntities(stripTags(region)).replace(/\s+/g, " ").trim();
    const sentences = flat.split(/(?<=[.!?])\s+/).filter(isProse);
    text = (sentences.join(" ") || flat).trim();
  }
  return text.slice(0, 4000);
}

/** Fetch + extract readable text + title from a live URL. */
export async function fetchArticle(url: string): Promise<{ title: string; text: string; source: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "TirunoBot/1.0 (+https://tiruno.app)" },
    signal: AbortSignal.timeout(8000),
  });
  const html = await res.text();
  const rawTitle =
    metaContent(html, "property", "og:title") ??
    html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const metaDesc =
    metaContent(html, "name", "description") ??
    metaContent(html, "property", "og:description");
  const body = extractReadable(html);
  const text = [metaDesc ? decodeEntities(metaDesc).trim() : "", body]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 4000);
  return { title: decodeEntities((rawTitle ?? url).trim()), text, source: hostOf(url) };
}

/** Summarise an article in place (NotebookLM-pluggable, with local fallback). */
export async function summarizeArticle(id: string): Promise<void> {
  const a = await getArticle(id);
  if (!a) return;
  try {
    let text = a.text;
    if (!text && a.url) {
      const fetched = await fetchArticle(a.url);
      text = fetched.text;
      if (!a.title || a.title === a.url) a.title = fetched.title;
      if (!a.source) a.source = fetched.source;
    }
    const nb = await notebooklmSummarize(text, a.title, a.url).catch(() => null);
    a.text = text;
    a.summary = nb ?? localSummarize(text, a.title);
    a.status = "ready";
    a.ready = true;
  } catch {
    a.status = "error";
    a.summary = "Tiru couldn't open that link to summarise it.";
    a.ready = false;
  }
  await saveArticle(a);
  if (a.ready) await indexArticleVector(a);
}

const DAILY_POOL: Array<{ title: string; source: string; topic: string; text: string }> = [
  {
    title: "Edge Computing Moves Compute Closer to Users",
    source: "Cloud Native Times",
    topic: "DevOps & Cloud",
    text: "Edge computing runs workloads on nodes near the user instead of a distant data center. This cuts round-trip latency, reduces origin load, and keeps experiences fast on poor networks. The trade-offs are harder deployment, data consistency across regions, and observability spread over many small sites.",
  },
  {
    title: "Designing Idempotent APIs",
    source: "API Digest",
    topic: "System Design",
    text: "Idempotent endpoints return the same result no matter how many times a client retries. The common pattern is an idempotency key the server records, so a duplicate request returns the original response instead of acting twice. This makes payment and order APIs safe under network retries.",
  },
  {
    title: "Prompt Caching Cuts LLM Costs",
    source: "AI Weekly",
    topic: "AI / LLMs",
    text: "Prompt caching stores the model's processing of a stable prefix — like a long system prompt or document — so repeated calls skip recomputation. Teams report large cost and latency savings for chat and RAG workloads where the same context is reused across many requests.",
  },
  {
    title: "Redis as a Vector Database",
    source: "Backend Notes",
    topic: "Databases",
    text: "With RediSearch, Redis stores embeddings and runs approximate nearest-neighbor search using HNSW, in memory. Because vectors live next to your cache and JSON, retrieval-augmented generation pipelines get millisecond lookups without a separate vector store, and hybrid filters combine metadata with similarity.",
  },
];

/** Ensure today has 3 pre-summarised "ready" daily articles. */
export async function ensureDaily(): Promise<void> {
  const r = getRedis();
  const date = todayKey();
  const have = await r.scard(DAILY(date));
  if (have >= 3) return;
  const picks = DAILY_POOL.slice(0, 3);
  for (const p of picks) {
    const id = `daily-${date}-${genId()}`;
    const a: StoredArticle = {
      id,
      title: p.title,
      source: p.source,
      topic: p.topic,
      text: p.text,
      summary: localSummarize(p.text, p.title),
      status: "ready",
      ready: true,
      kind: "daily",
      addedAt: Date.now() - DAILY_POOL.indexOf(p), // keep order stable
    };
    await saveArticle(a);
    await r.sadd(DAILY(date), id);
    await indexArticleVector(a);
  }
  await r.expire(DAILY(date), 60 * 60 * 24 * 2);
}
