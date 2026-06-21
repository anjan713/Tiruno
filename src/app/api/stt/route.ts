import { NextRequest } from "next/server";

export const runtime = "nodejs";

const MODEL = process.env.DEEPGRAM_STT_MODEL || "nova-3";

export async function POST(req: NextRequest) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    return Response.json({ error: "DEEPGRAM_API_KEY not configured" }, { status: 500 });
  }

  const contentType = req.headers.get("content-type") || "audio/webm";
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.byteLength === 0) return Response.json({ error: "Empty audio" }, { status: 400 });

  const dg = await fetch(
    `https://api.deepgram.com/v1/listen?model=${MODEL}&smart_format=true&punctuate=true`,
    {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": contentType },
      body: buf,
    }
  );

  if (!dg.ok) {
    const detail = await dg.text().catch(() => "");
    return Response.json({ error: "STT failed", status: dg.status, detail: detail.slice(0, 300) }, { status: 502 });
  }

  const json = await dg.json();
  const transcript: string =
    json?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  return Response.json({ transcript });
}
