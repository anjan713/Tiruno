import { NextRequest } from "next/server";
import { getFeedbackStore } from "@/lib/feedback";
import { tiruChat, type ChatTurn } from "@/lib/ai/tiruChat";

export const runtime = "nodejs";

const UID = "demo";

interface TiruBody {
  message?: string;
  history?: ChatTurn[];
  page?: string;
}

/**
 * Tiru feedback/chat endpoint. Thin by design (SRP): parse + validate, record the
 * feedback via the FeedbackStore, delegate the reply to the tiruChat service, respond.
 */
export async function POST(req: NextRequest) {
  let body: TiruBody = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = (body.message || "").trim();
  if (!message) return Response.json({ error: "Missing message" }, { status: 400 });
  const page = (body.page || "").toString().slice(0, 120);

  // Capture feedback (best-effort) so it can shape better lessons.
  await getFeedbackStore(UID).add({ message, page, at: Date.now() });

  const { reply, via } = await tiruChat({ message, history: body.history, page });
  return Response.json({ reply, via });
}
