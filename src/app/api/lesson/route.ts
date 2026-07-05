import { NextRequest } from "next/server";
import { getRedis } from "@/lib/redis";
import { enqueue } from "@/lib/jobs";
import { genId } from "@/lib/articles";
import { getOrGenerateLesson } from "@/lib/learn/generate";

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

/** GET ?id=<lessonId> -> generated lesson; GET ?jobId=<id> -> job status.
 *  When the lesson isn't cached yet, generate it on demand from ?article / ?topic
 *  (so bookmark + prerequisite lessons work without a running worker). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id");
  const jobId = sp.get("jobId");
  try {
    const r = getRedis();
    if (id) {
      const raw = await r.get(lessonKey(id));
      if (raw) return Response.json({ lesson: JSON.parse(raw) });

      // Not cached — author on demand if we have something to ground it in.
      const article = sp.get("article") || undefined;
      const topic = sp.get("topic") || undefined;
      if (article || topic) {
        const lesson = await getOrGenerateLesson({
          id,
          articleId: article,
          topic,
          index: Number(sp.get("index") || 1),
          count: Number(sp.get("count") || 1),
        });
        if (lesson) return Response.json({ lesson });
      }
      return Response.json({ error: "not found" }, { status: 404 });
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
