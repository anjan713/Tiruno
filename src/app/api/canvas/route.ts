import { NextRequest } from "next/server";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const KEY = "canvas:snapshot:demo";

export function OPTIONS() {
  return new Response(null, { headers: CORS });
}

export async function GET() {
  try {
    const raw = await getRedis().get(KEY);
    return Response.json({ snapshot: raw ? JSON.parse(raw) : null }, { headers: CORS });
  } catch {
    return Response.json({ snapshot: null }, { headers: CORS });
  }
}

// Receives a Canvas snapshot relayed by the Chrome extension (course list, etc.).
export async function POST(req: NextRequest) {
  let body: { courses?: Array<{ id?: string; name?: string }> } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }
  const courses = Array.isArray(body.courses) ? body.courses.filter((c) => c?.name) : [];
  const snapshot = { courses, syncedAt: Date.now(), source: "chrome-extension" };
  try {
    await getRedis().set(KEY, JSON.stringify(snapshot));
  } catch {
    /* best effort */
  }
  return Response.json({ ok: true, count: courses.length }, { headers: CORS });
}
