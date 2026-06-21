import { NextRequest } from "next/server";
import { ARTICLES } from "@/lib/mock/data";
import { askClaude } from "@/lib/ai/claude";

export const runtime = "nodejs";

interface AskBody {
  question?: string;
  articleId?: string;
  context?: string;
  title?: string;
}

/** Built-in fallback answer when Claude isn't configured or is unreachable. */
function localAnswer(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("vector") || q.includes("embedding"))
    return "Vectors capture meaning, so we retrieve text that's relevant even when the wording differs — that's why semantic search beats keyword matching here.";
  if (q.includes("hallucinat") || q.includes("trust") || q.includes("wrong"))
    return "Grounding the model in retrieved sources keeps it honest — it answers from real material and cites it instead of guessing.";
  return "Great question! Retrieval keeps the answer grounded in your sources, so Tiru teaches from real material and cites it — not guesses.";
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

  let context = body.context || "";
  let title = body.title;
  if (!context && body.articleId && ARTICLES[body.articleId]) {
    const a = ARTICLES[body.articleId];
    title = title ?? a.title;
    context = a.segments.map((s) => `${s.heading}. ${s.text}`).join("\n\n");
  }

  const claude = await askClaude(question, { context, title });
  if (claude) return Response.json({ answer: claude, via: "claude" });
  return Response.json({ answer: localAnswer(question), via: "local" });
}
