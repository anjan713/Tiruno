import { NextRequest } from "next/server";
import { getRedis } from "@/lib/redis";
import { enqueue } from "@/lib/jobs";
import { genId } from "@/lib/articles";

export const runtime = "nodejs";

const UID = "demo";
const lessonKey = (id: string) => `lesson:gen:${id}`;
const jobKey = (jobId: string) => `lessonjob:${jobId}`;

/** Kick off lesson generation. Body: { topic, articleId? }. Returns { jobId }. */
export async function POST(req: NextRequest) {
  let body: { topic?: string; articleId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const topic = (body.topic || "").trim();
  const articleId = body.articleId ? String(body.articleId) : undefined;
  if (!topic && !articleId) return Response.json({ error: "Provide a topic to learn" }, { status: 400 });

  const jobId = genId();
  try {
    const r = getRedis();
    await r.set(jobKey(jobId), JSON.stringify({ jobId, status: "pending", topic }), "EX", 60 * 60 * 24);
    await enqueue("generate_lesson", { uid: UID, jobId, topic, ...(articleId ? { articleId } : {}) });
    return Response.json({ ok: true, jobId, status: "pending" });
  } catch {
    return Response.json({ error: "Couldn't reach the lesson queue. Is the worker running?" }, { status: 503 });
  }
}

/** GET ?id=<lessonId> -> generated lesson; GET ?jobId=<id> -> job status. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const jobId = req.nextUrl.searchParams.get("jobId");
  try {
    const r = getRedis();
    if (id) {
      const raw = await r.get(lessonKey(id));
      if (!raw) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json({ lesson: JSON.parse(raw) });
    }
    if (jobId) {
      const raw = await r.get(jobKey(jobId));
      if (!raw) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json(JSON.parse(raw));
    }
    return Response.json({ error: "id or jobId required" }, { status: 400 });
  } catch {
    return Response.json({ error: "lookup failed" }, { status: 500 });
  }
}
