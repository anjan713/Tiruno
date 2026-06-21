"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Newspaper, Clock, Sparkles, ArrowRight, Volume2, Loader2, Square } from "lucide-react";
import { Mascot } from "@/components/mascot/Mascot";
import { useMascot } from "@/components/mascot/MascotProvider";
import { playSfx } from "@/lib/sound/sfx";
import { speak, stopSpeaking } from "@/lib/voice/voice";
import { FEED } from "@/lib/mock/data";

export default function FeedPage() {
  const router = useRouter();
  const { setAmbient } = useMascot();

  useEffect(() => setAmbient("idle"), [setAmbient]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ id: string; text: string } | null>(null);

  const open = (id: string) => {
    playSfx("ding");
    router.push(`/article/${id}`);
  };

  // Summarise the article (NotebookLM-pluggable) and have Tiru read it aloud (Deepgram).
  const explain = async (id: string) => {
    if (speakingId === id) {
      stopSpeaking();
      setSpeakingId(null);
      setAmbient("idle");
      return;
    }
    setBusyId(id);
    setAmbient("thinking");
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId: id }),
      });
      const { summary: text } = await res.json();
      setSummary({ id, text });
      setBusyId(null);
      setSpeakingId(id);
      setAmbient("talking");
      const a = await speak(text);
      a.onended = () => {
        setSpeakingId(null);
        setAmbient("idle");
      };
    } catch {
      setBusyId(null);
      setAmbient("idle");
    }
  };

  return (
    <div className="pb-16">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="font-display text-sm font-bold uppercase tracking-wide text-secondary">Fresh for you</p>
          <h1 className="font-display text-display text-text">Feed</h1>
          <p className="text-muted">Trending reads turned into gamified article units.</p>
        </div>
        <Mascot state="idle" size={84} float lean />
      </header>

      <div className="flex flex-col gap-3">
        {FEED.map((item) => {
          const isSpeaking = speakingId === item.id;
          const isBusy = busyId === item.id;
          return (
            <div key={item.id} className="card p-5 transition-all hover:shadow-lift">
              <div className="flex items-center gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-secondary/10 text-secondary">
                  <Newspaper className="h-6 w-6" />
                </span>
                <button onClick={() => open(item.id)} className="min-w-0 flex-1 text-left">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="chip bg-surface-alt text-xs text-muted">{item.topic}</span>
                    <span className="flex items-center gap-1 text-xs font-semibold text-muted">
                      <Sparkles className="h-3 w-3 text-amber" /> {item.freshness}
                    </span>
                  </div>
                  <h2 className="truncate font-display text-h3 text-text">{item.title}</h2>
                  <p className="text-sm text-muted">{item.reason}</p>
                </button>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="flex items-center gap-1 text-xs font-semibold text-muted">
                    <Clock className="h-3.5 w-3.5" /> {item.readingTime}
                  </span>
                  <button
                    onClick={() => open(item.id)}
                    aria-label="Open article"
                    className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary transition-transform hover:translate-x-0.5"
                  >
                    <ArrowRight className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                <button
                  onClick={() => explain(item.id)}
                  className="inline-flex items-center gap-2 rounded-chip bg-surface-alt px-3 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
                >
                  {isBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isSpeaking ? (
                    <Square className="h-3.5 w-3.5" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                  {isBusy ? "Summarising…" : isSpeaking ? "Stop" : "What's this about?"}
                </button>
                <span className="text-xs text-muted">Tiru summarises &amp; reads it aloud</span>
              </div>

              {summary?.id === item.id && (
                <p className="mt-3 animate-rise rounded-btn bg-surface-alt p-3 text-sm text-text">{summary.text}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
