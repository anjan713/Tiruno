// Adapt a stored (user-added / daily) article into the reader's segment-based Article
// shape so the in-app ArticlePlayer can narrate it. Pure, client-safe transform (the
// StoredArticle import is type-only, so the server-only articles module isn't bundled).

import type { Article, ArticleSegment } from "@/lib/mock/data";
import type { StoredArticle } from "@/lib/articles";

const MAX_SEGMENTS = 6;

/** Split a long string into ~`size`-char chunks on sentence boundaries. */
function chunkText(text: string, size = 600): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [clean];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > size && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += `${s} `;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Build narration segments: a summary intro, then the article body in readable chunks. */
export function segmentsFromStored(a: StoredArticle): ArticleSegment[] {
  const segments: ArticleSegment[] = [];
  if (a.summary?.trim()) segments.push({ heading: "Summary", text: a.summary.trim() });

  const paragraphs = (a.text ?? "")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40);
  const body = paragraphs.length > 1 ? paragraphs : chunkText(a.text ?? "");
  body.slice(0, MAX_SEGMENTS).forEach((text, i) => segments.push({ heading: `Part ${i + 1}`, text }));

  if (!segments.length) {
    segments.push({
      heading: a.title || "Article",
      text: a.summary || "No readable content was extracted for this article.",
    });
  }
  return segments;
}

/** Adapt a StoredArticle into the reader's Article shape. */
export function toReaderArticle(a: StoredArticle): Article {
  const words = `${a.summary} ${a.text}`.trim().split(/\s+/).filter(Boolean).length;
  return {
    id: a.id,
    title: a.title,
    source: a.source,
    readingTime: `${Math.max(1, Math.round(words / 200))} min`,
    topic: a.topic,
    segments: segmentsFromStored(a),
  };
}
