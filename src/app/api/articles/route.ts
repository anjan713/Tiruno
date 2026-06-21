import { NextRequest } from "next/server";
import {
  listArticles,
  saveArticle,
  summarizeArticle,
  ensureDaily,
  genId,
  hostOf,
  type StoredArticle,
} from "@/lib/articles";

export const runtime = "nodejs";

// Allow the Chrome extension (chrome-extension://...) and the dev site to call this.
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new Response(null, { headers: CORS });
}

export async function GET() {
  try {
    await ensureDaily();
    const articles = await listArticles();
    return Response.json({ articles }, { headers: CORS });
  } catch {
    return Response.json({ articles: [] }, { headers: CORS });
  }
}

export async function POST(req: NextRequest) {
  let body: { url?: string; title?: string; source?: string; topic?: string; text?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }

  const url = (body.url ?? "").trim();
  const text = (body.text ?? "").trim();
  if (!url && !text) {
    return Response.json({ error: "Provide a url (or text) to summarise" }, { status: 400, headers: CORS });
  }

  const id = genId();
  const article: StoredArticle = {
    id,
    url: url || undefined,
    title: body.title || url || "Saved article",
    source: body.source || (url ? hostOf(url) : "web"),
    topic: body.topic || "Saved",
    text,
    summary: "",
    status: "summarizing",
    ready: false,
    kind: "bookmark",
    addedAt: Date.now(),
  };

  await saveArticle(article);
  // Fire-and-forget: summarise in the background; client polls GET until ready.
  void summarizeArticle(id);

  // Acknowledgement that summarisation has started.
  return Response.json(
    { ok: true, id, status: "summarizing", message: "Tiru is summarising this article…" },
    { headers: CORS }
  );
}
