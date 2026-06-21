import { NextRequest } from "next/server";

export const runtime = "nodejs";

const MODEL = process.env.DEEPGRAM_TTS_MODEL || "aura-2-apollo-en";

export async function POST(req: NextRequest) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    return Response.json({ error: "DEEPGRAM_API_KEY not configured" }, { status: 500 });
  }

  let text = "";
  try {
    const body = await req.json();
    text = String(body?.text ?? "").trim();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!text) return Response.json({ error: "Missing text" }, { status: 400 });
  // Deepgram TTS has a per-request character cap; keep segments reasonable.
  text = text.slice(0, 1800);

  const dg = await fetch(`https://api.deepgram.com/v1/speak?model=${MODEL}&encoding=mp3`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!dg.ok || !dg.body) {
    const detail = await dg.text().catch(() => "");
    return Response.json({ error: "TTS failed", status: dg.status, detail: detail.slice(0, 300) }, { status: 502 });
  }

  return new Response(dg.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
