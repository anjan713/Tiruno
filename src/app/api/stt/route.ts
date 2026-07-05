import { NextRequest } from "next/server";
import { getVoiceProvider } from "@/lib/core/voice";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const provider = getVoiceProvider();
  if (!provider || !provider.canSTT) {
    return Response.json({ error: "no_stt_provider", fallback: "webspeech" }, { status: 501 });
  }

  const contentType = req.headers.get("content-type") || "audio/webm";
  const audio = await req.arrayBuffer();
  if (audio.byteLength === 0) return Response.json({ error: "Empty audio" }, { status: 400 });

  try {
    const transcript = await provider.stt(audio, contentType);
    return Response.json({ transcript });
  } catch (e) {
    return Response.json(
      { error: "STT failed", provider: provider.name, detail: String((e as Error).message).slice(0, 300) },
      { status: 502 }
    );
  }
}
