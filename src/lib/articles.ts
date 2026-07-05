import { getRedis } from "@/lib/redis";
import { summarize, localSummarize } from "@/lib/core/summarize";
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
    const { summary } = await summarize({ text, title: a.title, url: a.url });
    a.text = text;
    a.summary = summary;
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

const FEED_UA = "TirunoBot/1.0 (+https://tiruno.app)";
const DAILY_COUNT = 3;

/** Real developer/tech feeds the daily reads are pulled from (first reachable wins). */
const DAILY_FEEDS = [
  "https://dev.to/feed",
  "https://hnrss.org/frontpage?points=150",
];

/** Parse RSS <item> / Atom <entry> blocks into {title, link}. */
function parseFeedItems(xml: string): Array<{ title: string; link: string }> {
  const out: Array<{ title: string; link: string }> = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const b of blocks) {
    const rawTitle = (b.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "");
    const title = decodeEntities(stripTags(rawTitle)).replace(/\s+/g, " ").trim();
    let link =
      b.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim() ||
      b.match(/<link\b[^>]+href=["']([^"']+)["']/i)?.[1];
    link = link?.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    if (title && link && /^https?:\/\//.test(link)) out.push({ title, link });
  }
  return out;
}

/** Pull fresh, deduplicated items from the real feeds. */
async function fetchFeedItems(): Promise<Array<{ title: string; link: string }>> {
  const seen = new Set<string>();
  const items: Array<{ title: string; link: string }> = [];
  for (const feed of DAILY_FEEDS) {
    try {
      const res = await fetch(feed, { headers: { "User-Agent": FEED_UA }, signal: AbortSignal.timeout(8000) });
      for (const it of parseFeedItems(await res.text())) {
        const key = it.link.split("?")[0];
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(it);
      }
    } catch {
      /* try next feed */
    }
    if (items.length >= DAILY_COUNT * 3) break;
  }
  return items;
}

/** Last-resort seed if every real feed is unreachable (keeps the demo non-empty). */
const DAILY_FALLBACK: Array<{ title: string; source: string; topic: string; text: string }> = [
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

/**
 * Ensure today has DAILY_COUNT real, summarised "daily" articles pulled from live
 * developer feeds. Each pick is stored as a "summarizing" stub immediately, then the
 * full text is fetched + summarised in the background (clients poll until ready).
 */
export async function ensureDaily(): Promise<void> {
  const r = getRedis();
  const date = todayKey();
  if ((await r.scard(DAILY(date))) >= DAILY_COUNT) return;

  // Single-flight: only one in-flight request should populate the day's reads.
  try {
    const lock = await r.set(`articles:daily:lock:${date}`, "1", "EX", 120, "NX");
    if (!(lock === "OK" || lock === true)) return;
  } catch {
    /* memory fallback without NX support → proceed */
  }

  const items = (await fetchFeedItems()).slice(0, DAILY_COUNT);
  let order = 0;
  if (items.length) {
    for (const it of items) {
      const id = `daily-${date}-${genId()}`;
      const a: StoredArticle = {
        id,
        url: it.link,
        title: it.title,
        source: hostOf(it.link),
        topic: "Today",
        text: "",
        summary: "",
        status: "summarizing",
        ready: false,
        kind: "daily",
        addedAt: Date.now() - order++,
      };
      await saveArticle(a);
      await r.sadd(DAILY(date), id);
      void summarizeArticle(id); // background: fetch full text + summarise + index
    }
  } else {
    // Every feed was unreachable — seed locally so the app is never empty.
    for (const p of DAILY_FALLBACK.slice(0, DAILY_COUNT)) {
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
        addedAt: Date.now() - order++,
      };
      await saveArticle(a);
      await r.sadd(DAILY(date), id);
      await indexArticleVector(a);
    }
  }
  await r.expire(DAILY(date), 60 * 60 * 24 * 2);
}
