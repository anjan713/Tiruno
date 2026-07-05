import { NextRequest } from "next/server";
import { analyzeFeedback } from "@/lib/learn/feedback";

export const runtime = "nodejs";

const UID = "demo";

// POST /api/feedback — end-of-lesson feedback.
// Body: { articleId?, topic?, lessonTitle?, scorePct, feedbackText? }
// Returns: { ok, outcome, gap } where gap (if any) names the missing prerequisite.
export async function POST(req: NextRequest) {
  let body: {
    articleId?: string;
    topic?: string;
    lessonTitle?: string;
    scorePct?: number;
    feedbackText?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await analyzeFeedback({
      uid: UID,
      articleId: body.articleId,
      topic: body.topic,
      lessonTitle: body.lessonTitle,
      scorePct: Math.max(0, Math.min(100, Number(body.scorePct) || 0)),
      feedbackText: (body.feedbackText || "").trim() || undefined,
    });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
  }
}
