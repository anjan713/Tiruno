"use client";

// Data/logic for the profile's "articles of interest" manager, kept out of the component
// (SRP). Adds a link via /api/articles (kind "bookmark"), tracks its id in the game store,
// and polls until Tiru has summarised it. The component stays presentational.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGameStore } from "@/lib/store/useGameStore";
import type { StoredArticle } from "@/lib/articles";

export interface InterestArticlesApi {
  /** The user's interest articles (the stored records for their saved ids), newest-added last. */
  articles: StoredArticle[];
  loading: boolean;
  adding: boolean;
  /** Transient acknowledgement / error message for the last add. */
  ack: string | null;
  addByUrl: (url: string) => Promise<void>;
  remove: (id: string) => void;
}

export function useInterestArticles(): InterestArticlesApi {
  const interestArticleIds = useGameStore((s) => s.interestArticleIds);
  const addInterestArticle = useGameStore((s) => s.addInterestArticle);
  const removeInterestArticle = useGameStore((s) => s.removeInterestArticle);

  const [all, setAll] = useState<StoredArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [ack, setAck] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/articles");
      const data = await res.json();
      setAll(Array.isArray(data.articles) ? data.articles : []);
    } catch {
      /* keep last known list */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    pollRef.current = setInterval(refetch, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refetch]);

  // Interest articles in the order the user added them.
  const articles = useMemo(() => {
    const byId = new Map(all.map((a) => [a.id, a] as const));
    return interestArticleIds.map((id) => byId.get(id)).filter((a): a is StoredArticle => Boolean(a));
  }, [all, interestArticleIds]);

  const addByUrl = useCallback(
    async (url: string) => {
      const u = url.trim();
      if (!u) return;
      setAdding(true);
      setAck(null);
      try {
        const res = await fetch("/api/articles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: u }),
        });
        const data = await res.json();
        if (data?.id) {
          addInterestArticle(data.id);
          setAck(data.message ?? "Tiru is summarising this article…");
          await refetch();
        } else {
          setAck(data?.error ?? "Couldn't add that link.");
        }
      } catch {
        setAck("Couldn't reach the server.");
      } finally {
        setAdding(false);
        setTimeout(() => setAck(null), 4000);
      }
    },
    [addInterestArticle, refetch]
  );

  const remove = useCallback((id: string) => removeInterestArticle(id), [removeInterestArticle]);

  return { articles, loading, adding, ack, addByUrl, remove };
}
