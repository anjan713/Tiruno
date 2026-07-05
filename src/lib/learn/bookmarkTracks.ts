// Build the professional Learn map from the user's bookmarks (not mock topics).
// Each bookmarked article becomes a SECTION whose number of lessons is derived
// deterministically from the article's length (see plan.ts). Prerequisite
// sections (e.g. "Docker basics" before AWS Fargate) are prepended when the
// self-learning loop has detected a gap.
//
// Pure data transform — safe to import into the client (type-only article import).

import type { CourseTrack, SkillNode } from "@/lib/mock/data";
import { lessonCountForText, identifyConcept, conceptLabel, countWords } from "./plan";

/** Minimal article shape the Learn UI needs (subset of StoredArticle). */
export interface BookmarkArticle {
  id: string;
  title: string;
  source: string;
  topic: string;
  text: string;
  summary: string;
  ready: boolean;
  kind: string;
  addedAt: number;
}

/** A prerequisite the self-learning loop wants the user to cover first. */
export interface PendingPrereq {
  concept: string;
  label: string;
  blockedTopicLabel: string;
  at: number;
}

const readingMinutes = (words: number) => Math.max(1, Math.round(words / 200));

function lessonNodes(
  prefix: string,
  count: number,
  label: string,
  articleId: string | undefined,
  topic: string
): SkillNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-l${i + 1}`,
    title: count > 1 ? `${label} · Part ${i + 1}` : label,
    type: "lesson" as const,
    status: "locked" as const,
    xp: 25,
    contentId: `${prefix}-l${i + 1}`,
    ...(articleId ? { articleId } : {}),
    topic,
    lessonIndex: i + 1,
    lessonCount: count,
  }));
}

/** Turn one ready article into a Learn section: N grounded lessons + a "read" node. */
function sectionFromArticle(a: BookmarkArticle) {
  const body = `${a.title}. ${a.summary} ${a.text}`;
  const concept = identifyConcept(body);
  const label = concept ? conceptLabel(concept) : a.topic || "Key ideas";
  const lessons = lessonCountForText(a.text || a.summary);
  const mins = readingMinutes(countWords(a.text || a.summary));
  const nodes: SkillNode[] = [
    ...lessonNodes(`bk-${a.id}`, lessons, label, a.id, a.topic || label),
    {
      id: `bk-${a.id}-read`,
      title: "Read the article",
      type: "article",
      status: "locked",
      xp: 15,
      contentId: a.id,
      articleId: a.id,
    },
  ];
  return {
    id: `bk-${a.id}`,
    title: a.title,
    subtitle: `${a.source} · ${mins} min read · ${lessons} lesson${lessons > 1 ? "s" : ""}`,
    accent: "primary",
    nodes,
  };
}

/** One track "From your bookmarks"; each ready bookmark is a section (unit). */
export function buildBookmarkTracks(articles: BookmarkArticle[]): CourseTrack[] {
  const bookmarks = articles
    .filter((a) => a.kind === "bookmark" && a.ready)
    .sort((a, b) => a.addedAt - b.addedAt);
  if (!bookmarks.length) return [];

  return [
    {
      courseId: "bookmarks",
      code: "SAVED",
      name: "From your bookmarks",
      accent: "primary",
      units: bookmarks.map(sectionFromArticle),
    },
  ];
}

/**
 * Fallback Learn track built from today's REAL daily reads (fetched from live feeds)
 * when the user hasn't bookmarked anything yet. Shows the most recent ready articles
 * so the demo always learns from real, current content instead of mock topics.
 */
export function buildDailyTracks(articles: BookmarkArticle[], limit = 3): CourseTrack[] {
  const daily = articles
    .filter((a) => a.kind === "daily" && a.ready && (a.text || a.summary))
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, limit);
  if (!daily.length) return [];

  return [
    {
      courseId: "daily",
      code: "TODAY",
      name: "Today's reads",
      accent: "primary",
      units: daily.map(sectionFromArticle),
    },
  ];
}

/**
 * Track built from the user's profile "articles of interest" (the links they added).
 * `interestIds` preserves the add order; only ready (summarised) articles become
 * sections — pending ones simply haven't appeared yet. Each section is the article's
 * grounded lessons plus a "Read the article" node opened in the in-app reader.
 */
export function buildInterestTracks(articles: BookmarkArticle[], interestIds: string[]): CourseTrack[] {
  if (!interestIds.length) return [];
  const byId = new Map(articles.map((a) => [a.id, a] as const));
  const ready = interestIds.map((id) => byId.get(id)).filter((a): a is BookmarkArticle => !!a && a.ready);
  if (!ready.length) return [];

  return [
    {
      courseId: "interests",
      code: "YOU",
      name: "Your articles of interest",
      accent: "primary",
      units: ready.map(sectionFromArticle),
    },
  ];
}

/** Prerequisite sections to learn FIRST (one section per detected gap). */
export function buildPrerequisiteTracks(prereqs: PendingPrereq[]): CourseTrack[] {
  if (!prereqs.length) return [];
  return [
    {
      courseId: "prerequisites",
      code: "PREP",
      name: "Learn these first",
      accent: "amber",
      units: prereqs.map((p) => ({
        id: `prereq-${p.concept}`,
        title: `${p.label} basics`,
        subtitle: `Needed before ${p.blockedTopicLabel}`,
        accent: "amber",
        nodes: lessonNodes(`prereq-${p.concept}`, 2, `${p.label} basics`, undefined, `${p.label} basics`),
      })),
    },
  ];
}
