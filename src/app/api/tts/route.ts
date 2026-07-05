import { NextRequest } from "next/server";
import { getVoiceProvider, TTS_CHAR_LIMIT } from "@/lib/core/voice";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const provider = getVoiceProvider();
  // 501 + a machine-readable flag tells the client to use browser WebSpeech.
  if (!provider || !provider.canTTS) {
    return Response.json({ error: "no_tts_provider", fallback: "webspeech" }, { status: 501 });
  }

  let text = "";
  try {
    const body = await req.json();
    text = String(body?.text ?? "").trim();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!text) return Response.json({ error: "Missing text" }, { status: 400 });
  text = text.slice(0, TTS_CHAR_LIMIT);

  try {
    const { stream, contentType } = await provider.tts(text);
    return new Response(stream, {
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400" },
    });
  } catch (e) {
    return Response.json(
      { error: "TTS failed", provider: provider.name, detail: String((e as Error).message).slice(0, 300) },
      { status: 502 }
    );
  }
}
