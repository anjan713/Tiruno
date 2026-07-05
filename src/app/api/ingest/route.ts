import { NextRequest } from "next/server";
import { getRedis } from "@/lib/redis";
import { enqueue } from "@/lib/jobs";
import { genId } from "@/lib/articles";

export const runtime = "nodejs";

const UID = "demo";

/**
 * Kick off NotebookLM ingestion for an article or raw source.
 * Body: { url?, articleId?, title?, topic?, text?, email?, force?, notebook? }.
 * Requires at least one of url / articleId / text. Returns { jobId }.
 */
export async function POST(req: NextRequest) {
  let body: {
    url?: string;
    articleId?: string;
    title?: string;
    topic?: string;
    text?: string;
    email?: boolean;
    force?: boolean;
    notebook?: "courses" | "articles";
  } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.url && !body.articleId && !body.text) {
    return Response.json({ error: "Provide a url, articleId, or text to ingest" }, { status: 400 });
  }

  const jobId = genId();
  try {
    await enqueue("ingest_article", {
      uid: UID,
      jobId,
      ...(body.articleId ? { articleId: body.articleId } : {}),
      ...(body.url ? { url: body.url } : {}),
      ...(body.title ? { title: body.title } : {}),
      ...(body.topic ? { topic: body.topic } : {}),
      ...(body.text ? { text: body.text } : {}),
      ...(body.email ? { email: true } : {}),
      ...(body.force ? { force: true } : {}),
      notebook: body.notebook === "courses" ? "courses" : "articles",
    });
    return Response.json({ ok: true, jobId, status: "pending" });
  } catch {
    return Response.json({ error: "Couldn't reach the ingestion queue. Is the worker running?" }, { status: 503 });
  }
}

/** GET ?articleId=<id> -> NotebookLM lifecycle state + generated assets (podcast). */
export async function GET(req: NextRequest) {
  const articleId = req.nextUrl.searchParams.get("articleId");
  if (!articleId) return Response.json({ error: "articleId required" }, { status: 400 });

  try {
    const r = getRedis();
    const [stateRaw, podcastRaw] = await Promise.all([
      r.get(`notebook:articles:${articleId}`),
      r.get(`podcast:${articleId}`),
    ]);
    if (!stateRaw) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({
      state: JSON.parse(stateRaw),
      podcast: podcastRaw ? JSON.parse(podcastRaw) : null,
    });
  } catch {
    return Response.json({ error: "lookup failed" }, { status: 500 });
  }
}
