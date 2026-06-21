import { NextRequest } from "next/server";
import Redis from "ioredis";
import { ARTICLES } from "@/lib/mock/data";
import { notebooklmSummarize, localSummarize } from "@/lib/notebooklm";

export const runtime = "nodejs";

interface ExplainBody {
  articleId?: string;
  text?: string;
  title?: string;
  redisUrl?: string; // live Redis link the user provides
  key?: string; // key holding the article (string or hash/JSON)
}

/** Read an article payload from an arbitrary (user-provided) Redis. */
async function fromRedis(redisUrl: string, key: string): Promise<{ text: string; title?: string } | null> {
  const r = new Redis(redisUrl, { maxRetriesPerRequest: 2, connectTimeout: 4000, lazyConnect: true });
  try {
    await r.connect();
    const type = await r.type(key);
    let raw: string | null = null;
    if (type === "string") raw = await r.get(key);
    else if (type === "hash") raw = JSON.stringify(await r.hgetall(key));
    if (!raw) return null;
    try {
      const j = JSON.parse(raw);
      const text =
        j.text ||
        j.content ||
        j.body ||
        (Array.isArray(j.segments) ? j.segments.map((s: { text?: string }) => s.text ?? s).join(" ") : "") ||
        raw;
      return { text: String(text), title: j.title };
    } catch {
      return { text: raw };
    }
  } finally {
    r.disconnect();
  }
}

export async function POST(req: NextRequest) {
  let body: ExplainBody = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let text = "";
  let title = body.title;

  if (body.text) {
    text = body.text;
  } else if (body.articleId && ARTICLES[body.articleId]) {
    const a = ARTICLES[body.articleId];
    title = title ?? a.title;
    text = a.segments.map((s) => `${s.heading}. ${s.text}`).join(" ");
  } else if (body.redisUrl && body.key) {
    const got = await fromRedis(body.redisUrl, body.key).catch(() => null);
    if (got) {
      text = got.text;
      title = title ?? got.title;
    }
  }

  if (!text) return Response.json({ error: "No article text could be resolved" }, { status: 400 });

  const nb = await notebooklmSummarize(text, title).catch(() => null);
  const summary = nb ?? localSummarize(text, title);
  return Response.json({ summary, via: nb ? "notebooklm" : "builtin", title: title ?? null });
}
