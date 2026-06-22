"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Volume2, Square, Loader2, Check, AlertTriangle, Sparkles, Link2, Bookmark } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useMascot } from "@/components/mascot/MascotProvider";
import { speak, stopSpeaking } from "@/lib/voice/voice";
import type { StoredArticle } from "@/lib/articles";

export default function ArticlesPage() {
  const { setAmbient } = useMascot();
  const [articles, setArticles] = useState<StoredArticle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [ack, setAck] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/articles");
      const { articles } = await res.json();
      setArticles(articles ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    setAmbient("idle");
    refetch();
    pollRef.current = setInterval(refetch, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      stopSpeaking();
    };
  }, [refetch, setAmbient]);

  const addUrl = async () => {
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
      setAck(data.message ?? "Summarisation started.");
      setUrl("");
      refetch();
    } catch {
      setAck("Couldn't reach the server.");
    } finally {
      setAdding(false);
      setTimeout(() => setAck(null), 4000);
    }
  };

  const explain = async (a: StoredArticle) => {
    if (!a.ready) return;
    if (speakingId === a.id) {
      stopSpeaking();
      setSpeakingId(null);
      setAmbient("idle");
      return;
    }
    setSpeakingId(a.id);
    setAmbient("talking");
    try {
      const audio = await speak(a.summary);
      audio.onended = () => {
        setSpeakingId(null);
        setAmbient("idle");
      };
    } catch {
      setSpeakingId(null);
      setAmbient("idle");
    }
  };

  const daily = articles.filter((a) => a.kind === "daily");
  const saved = articles.filter((a) => a.kind === "bookmark");

  return (
    <div>
      <PageHeader
        accent="secondary"
        eyebrow="Saved & ready"
        title="My Articles"
        subtitle="Bookmarks from the extension + 3 fresh reads summarised daily."
        mascot={speakingId ? "talking" : "idle"}
      />

      {/* Add by URL */}
      <div className="card mb-8 p-4">
        <div className="flex items-center gap-2">
          <Link2 className="h-5 w-5 shrink-0 text-muted" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addUrl()}
            placeholder="Paste an article link… Tiru will summarise & explain it"
            className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-muted"
          />
          <Button size="sm" onClick={addUrl} disabled={adding || !url.trim()}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </Button>
        </div>
        {ack && (
          <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-primary animate-rise">
            <Sparkles className="h-4 w-4" /> {ack}
          </p>
        )}
      </div>

      {/* Daily ready */}
      <SectionTitle icon={<Sparkles className="h-4 w-4 text-amber" />} title="Today's ready reads" sub="Pre-summarised — tap to have Tiru explain" />
      <div className="mb-8 flex flex-col gap-3">
        {!loaded && (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}
        {daily.map((a, i) => (
          <ArticleCard key={a.id} a={a} index={i} speaking={speakingId === a.id} onExplain={() => explain(a)} />
        ))}
      </div>

      {/* Bookmarks */}
      <SectionTitle icon={<Bookmark className="h-4 w-4 text-secondary" />} title="Bookmarked" sub="Saved from the Tiruno Chrome extension" />
      <div className="flex flex-col gap-3">
        {loaded && saved.length === 0 && (
          <EmptyState
            title="No bookmarks yet"
            description="Use the Tiruno Chrome extension — or paste a link above — to save articles here."
          />
        )}
        {saved.map((a, i) => (
          <ArticleCard key={a.id} a={a} index={i} speaking={speakingId === a.id} onExplain={() => explain(a)} />
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="mb-3">
      <h2 className="flex items-center gap-2 font-display text-h3 text-text">{icon} {title}</h2>
      <p className="text-sm text-muted">{sub}</p>
    </div>
  );
}

function ArticleCard({ a, index = 0, speaking, onExplain }: { a: StoredArticle; index?: number; speaking: boolean; onExplain: () => void }) {
  return (
    <div
      className="card p-5 animate-rise"
      style={{ animationDelay: `${Math.min(index * 60, 300)}ms`, animationFillMode: "backwards" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="chip bg-surface-alt text-xs text-muted">{a.topic}</span>
            <span className="text-xs font-semibold text-muted">{a.source}</span>
            <StatusBadge a={a} />
          </div>
          <h3 className="font-display text-h3 text-text">{a.title}</h3>
          {a.url && <p className="truncate text-xs text-muted">{a.url}</p>}
        </div>
        <Button
          size="sm"
          variant={speaking ? "primary" : "neutral"}
          onClick={onExplain}
          disabled={!a.ready}
          className="shrink-0"
        >
          {speaking ? <Square className="h-3.5 w-3.5" /> : <Volume2 className="h-4 w-4" />}
          {speaking ? "Stop" : a.ready ? "Tiru explains" : "Summarising…"}
        </Button>
      </div>
      {a.ready && a.summary && (
        <p className="mt-3 rounded-btn bg-surface-alt p-3 text-sm text-text">{a.summary}</p>
      )}
    </div>
  );
}

function StatusBadge({ a }: { a: StoredArticle }) {
  if (a.status === "ready")
    return (
      <span className="chip bg-success/15 text-xs font-bold text-success">
        <Check className="h-3 w-3" /> Ready
      </span>
    );
  if (a.status === "error")
    return (
      <span className="chip bg-danger/15 text-xs font-bold text-danger">
        <AlertTriangle className="h-3 w-3" /> Failed
      </span>
    );
  return (
    <span className="chip bg-primary/15 text-xs font-bold text-primary">
      <Loader2 className="h-3 w-3 animate-spin" /> Summarising…
    </span>
  );
}
