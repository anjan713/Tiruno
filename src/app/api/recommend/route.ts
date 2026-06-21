import { NextRequest } from "next/server";
import { getRedis } from "@/lib/redis";
import { embed, embedBatch, embeddingProvider } from "@/lib/rag/embeddings";
import { ensureVectorIndex, indexMaterial, searchMaterials, type Material } from "@/lib/rag/vector";
import { LESSONS } from "@/lib/mock/data";

export const runtime = "nodejs";

// Seed the built-in lessons into the index once per process so recommendations
// have content immediately (articles + explore sources index themselves over time).
let seeded = false;
async function seedLessons(): Promise<void> {
  if (seeded) return;
  seeded = true;
  try {
    const r = getRedis();
    await ensureVectorIndex(r);
    const lessons = Object.values(LESSONS);
    const vecs = await embedBatch(lessons.map((l) => `${l.title}. ${l.concept}`));
    await Promise.all(
      lessons.map((l, i) =>
        indexMaterial(
          r,
          { id: `les-${l.id}`, kind: "lesson", refId: l.id, title: l.title, topic: l.topic, text: l.concept },
          vecs[i]
        )
      )
    );
  } catch {
    seeded = false; // allow a retry on the next call
  }
}

/** RAG "next-best-material": embed the query and return the nearest learning materials. */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  const k = Math.min(10, Math.max(1, Number(req.nextUrl.searchParams.get("k") || 5)));
  const kind = (req.nextUrl.searchParams.get("kind") || "") as Material["kind"] | "";
  if (!q) return Response.json({ error: "Provide ?q=" }, { status: 400 });

  try {
    const r = getRedis();
    await ensureVectorIndex(r);
    await seedLessons();
    const vec = await embed(q);
    const hits = await searchMaterials(r, vec, k, kind ? { kind } : {});
    return Response.json({ q, provider: embeddingProvider(), hits });
  } catch (e) {
    return Response.json({ error: "search failed", detail: String((e as Error).message) }, { status: 500 });
  }
}
