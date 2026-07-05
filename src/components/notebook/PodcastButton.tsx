"use client";

import { useEffect, useRef, useState } from "react";
import { Headphones, Pause, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getNotebookState, podcastStreamUrl, recordEngagement } from "@/lib/notebook";

/**
 * Plays an article's NotebookLM audio overview (podcast) if one exists. Renders
 * nothing when there's no playable podcast (e.g. mock mode or not yet ingested),
 * so it's safe to drop into any article view. Listening counts as engagement.
 */
export function PodcastButton({ articleId }: { articleId: string }) {
  const [available, setAvailable] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await getNotebookState(articleId);
      const url = data?.podcast?.url;
      if (!cancelled && url && !url.startsWith("mock://")) setAvailable(true);
    })();
    return () => {
      cancelled = true;
      audioRef.current?.pause();
    };
  }, [articleId]);

  if (!available) return null;

  const toggle = () => {
    if (!audioRef.current) {
      const a = new Audio(podcastStreamUrl(articleId));
      a.onplay = () => setPlaying(true);
      a.onpause = () => setPlaying(false);
      a.onended = () => setPlaying(false);
      a.onwaiting = () => setLoading(true);
      a.onplaying = () => setLoading(false);
      audioRef.current = a;
    }
    const a = audioRef.current;
    if (a.paused) {
      void a.play();
      // Listening to the AI podcast is a strong engagement signal → extends retention.
      void recordEngagement(articleId, 70);
    } else {
      a.pause();
    }
  };

  return (
    <Button size="sm" variant="neutral" onClick={toggle}>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : playing ? (
        <Pause className="h-4 w-4" />
      ) : (
        <Headphones className="h-4 w-4" />
      )}
      {playing ? "Pause podcast" : "AI podcast"}
    </Button>
  );
}
