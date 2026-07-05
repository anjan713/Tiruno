import { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
};

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Stream an article's NotebookLM audio overview (podcast).
 * - http(s) url  → redirect to it
 * - local file   → stream the bytes (real-mode CLI output)
 * - mock:// url   → 409 (nothing to stream in mock mode)
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ articleId: string }> }) {
  const { articleId } = await params;
  try {
    const raw = await getRedis().get(`podcast:${articleId}`);
    if (!raw) return Response.json({ error: "no podcast for this article" }, { status: 404 });

    const url = String(JSON.parse(raw).url ?? "");
    if (!url) return Response.json({ error: "podcast has no audio url" }, { status: 404 });
    if (/^https?:\/\//i.test(url)) return Response.redirect(url, 302);
    if (url.startsWith("mock://")) {
      return Response.json({ error: "podcast not available in mock mode", url }, { status: 409 });
    }

    // Treat anything else as a local file path produced by the CLI.
    const filePath = url.replace(/^file:\/\//, "");
    const info = await stat(filePath);
    const stream = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream;
    return new Response(stream, {
      headers: {
        "Content-Type": contentTypeFor(filePath),
        "Content-Length": String(info.size),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return Response.json({ error: "podcast unavailable" }, { status: 500 });
  }
}
