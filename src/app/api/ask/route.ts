import { NextRequest } from "next/server";
import { ARTICLES } from "@/lib/mock/data";
import { answer } from "@/lib/ai/answer";

export const runtime = "nodejs";

interface AskBody {
  question?: string;
  articleId?: string;
  context?: string;
  title?: string;
}

export async function POST(req: NextRequest) {
  let body: AskBody = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const question = (body.question || "").trim();
  if (!question) return Response.json({ error: "Missing question" }, { status: 400 });

  // Resolve article context (mock articles) when the caller didn't supply it.
  let context = body.context || "";
  let title = body.title;
  if (!context && body.articleId && ARTICLES[body.articleId]) {
    const a = ARTICLES[body.articleId];
    title = title ?? a.title;
    context = a.segments.map((s) => `${s.heading}. ${s.text}`).join("\n\n");
  }

  const { answer: text, via } = await answer(question, { context, title });
  return Response.json({ answer: text, via });
}
