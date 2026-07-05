import { NextRequest } from "next/server";
import { enqueue } from "@/lib/jobs";
import { genId } from "@/lib/articles";

export const runtime = "nodejs";

const UID = "demo";

/**
 * Record engagement with an ingested article (a view/listen/quiz score), which
 * extends its NotebookLM retention window so engaged material survives rotation.
 * Body: { articleId, score? } (0..100). Returns { jobId }.
 */
export async function POST(req: NextRequest) {
  let body: { articleId?: string; score?: number } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const articleId = (body.articleId || "").trim();
  if (!articleId) return Response.json({ error: "articleId required" }, { status: 400 });

  const jobId = genId();
  try {
    await enqueue("notebook_engagement", {
      uid: UID,
      jobId,
      articleId,
      ...(typeof body.score === "number" ? { score: body.score } : {}),
    });
    return Response.json({ ok: true, jobId, status: "pending" });
  } catch {
    return Response.json({ error: "Couldn't reach the ingestion queue. Is the worker running?" }, { status: 503 });
  }
}
