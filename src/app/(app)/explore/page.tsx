"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Compass,
  Search,
  Loader2,
  Volume2,
  Square,
  ExternalLink,
  Bookmark,
  Check,
  Sparkles,
  AlertTriangle,
  GraduationCap,
  Newspaper,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Mascot } from "@/components/mascot/Mascot";
import { useMascot } from "@/components/mascot/MascotProvider";
import { speak, stopSpeaking } from "@/lib/voice/voice";

interface ExploreSource {
  title: string;
  url: string;
  source: string;
  engagement?: string;
  snippet?: string;
}

type Status = "idle" | "pending" | "researching" | "ready" | "error";

interface RtMessage {
  jobId: string;
  type: "progress" | "done" | "error";
  step?: string;
  status?: string;
  result?: {
    sources?: ExploreSource[];
    synthesis?: string;
    followups?: string[];
    lessonId?: string;
    title?: string;
  };
  error?: string;
}

interface RelatedHit {
  id: string;
  score: number;
  kind: string;
  refId: string;
  title: string;
  topic: string;
  url: string;
}

const SUGGESTIONS = ["AI coding agents", "React Server Components", "Redis vector search", "LLM evals"];

export default function ExplorePage() {
  const router = useRouter();
  const { setAmbient } = useMascot();
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [steps, setSteps] = useState<string[]>([]);
  const [sources, setSources] = useState<ExploreSource[]>([]);
  const [synthesis, setSynthesis] = useState("");
  const [followups, setFollowups] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [related, setRelated] = useState<RelatedHit[]>([]);
  const [lessonBusy, setLessonBusy] = useState(false);
  const [lessonStep, setLessonStep] = useState("");

  const jobRef = useRef<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lessonJobRef = useRef<string | null>(null);
  const lessonPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const researching = status === "pending" || status === "researching";

  const applyState = useCallback(
    (s: { status?: string; steps?: string[]; sources?: ExploreSource[]; synthesis?: string; followups?: string[]; error?: string }) => {
      if (s.steps) setSteps(s.steps);
      if (s.sources) setSources(s.sources);
      if (typeof s.synthesis === "string") setSynthesis(s.synthesis);
      if (s.followups) setFollowups(s.followups);
      if (s.error) setError(s.error);
      if (s.status === "ready") {
        setStatus("ready");
        setAmbient("idle");
      } else if (s.status === "error") {
        setStatus("error");
        setAmbient("error");
      } else if (s.status === "researching" || s.status === "pending") {
        setStatus("researching");
      }
    },
    [setAmbient]
  );

  // Persistent SSE connection; filter messages by the active jobId.
  useEffect(() => {
    setAmbient("idle");
    const es = new EventSource("/api/events");
    esRef.current = es;
    es.onmessage = (ev) => {
      let msg: RtMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      // Lesson-generation job (its own jobId) -> navigate to the new lesson.
      if (msg.jobId && msg.jobId === lessonJobRef.current) {
        if (msg.type === "done" && msg.result?.lessonId) {
          router.push(`/lesson/${msg.result.lessonId}`);
        } else if (msg.type === "error") {
          setLessonBusy(false);
          setError(msg.error ?? "Lesson generation failed");
        } else if (msg.type === "progress" && msg.step) {
          setLessonStep(msg.step);
        }
        return;
      }
      if (!msg.jobId || msg.jobId !== jobRef.current) return;
      if (msg.type === "progress" && msg.step) {
        setSteps((prev) => (prev[prev.length - 1] === msg.step ? prev : [...prev, msg.step!]));
      } else if (msg.type === "done" && msg.result) {
        setSources(msg.result.sources ?? []);
        setSynthesis(msg.result.synthesis ?? "");
        setFollowups(msg.result.followups ?? []);
        setStatus("ready");
        setAmbient("idle");
      } else if (msg.type === "error") {
        setError(msg.error ?? "Research failed");
        setStatus("error");
        setAmbient("error");
      }
    };
    return () => {
      es.close();
      if (pollRef.current) clearInterval(pollRef.current);
      if (lessonPollRef.current) clearInterval(lessonPollRef.current);
      stopSpeaking();
    };
  }, [setAmbient, router]);

  const research = async (t?: string) => {
    const q = (t ?? topic).trim();
    if (!q || researching) return;
    setTopic(q);
    setStatus("pending");
    setSteps([]);
    setSources([]);
    setSynthesis("");
    setFollowups([]);
    setError(null);
    setSaved({});
    setAmbient("thinking");
    stopSpeaking();
    setSpeaking(false);

    try {
      const res = await fetch("/api/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't start research");
        setStatus("error");
        setAmbient("error");
        return;
      }
      jobRef.current = data.jobId;
      setStatus("researching");

      // Polling fallback in case SSE misses an event.
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        if (!jobRef.current) return;
        try {
          const r = await fetch(`/api/explore?jobId=${jobRef.current}`);
          if (!r.ok) return;
          const s = await r.json();
          applyState(s);
          if (s.status === "ready" || s.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch {
          /* ignore */
        }
      }, 3000);
    } catch {
      setError("Couldn't reach the server.");
      setStatus("error");
      setAmbient("error");
    }
  };

  // Related materials (RAG): nearest indexed materials once research is ready.
  useEffect(() => {
    if (status !== "ready" || !topic) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/recommend?q=${encodeURIComponent(topic)}&k=4`);
        const j = await r.json();
        if (!cancelled && Array.isArray(j.hits)) setRelated(j.hits);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, topic]);

  const generateLesson = async () => {
    if (lessonBusy || !topic) return;
    setLessonBusy(true);
    setLessonStep("Preparing…");
    setError(null);
    try {
      const res = await fetch("/api/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't start lesson generation");
        setLessonBusy(false);
        return;
      }
      lessonJobRef.current = data.jobId;
      if (lessonPollRef.current) clearInterval(lessonPollRef.current);
      lessonPollRef.current = setInterval(async () => {
        if (!lessonJobRef.current) return;
        try {
          const r = await fetch(`/api/lesson?jobId=${lessonJobRef.current}`);
          if (!r.ok) return;
          const s = await r.json();
          if (s.status === "ready" && s.lessonId) {
            if (lessonPollRef.current) clearInterval(lessonPollRef.current);
            router.push(`/lesson/${s.lessonId}`);
          } else if (s.status === "error") {
            if (lessonPollRef.current) clearInterval(lessonPollRef.current);
            setError(s.error ?? "Lesson generation failed");
            setLessonBusy(false);
          }
        } catch {
          /* ignore */
        }
      }, 3000);
    } catch {
      setError("Couldn't reach the server.");
      setLessonBusy(false);
    }
  };

  const toggleSpeak = async () => {
    if (!synthesis) return;
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      setAmbient("idle");
      return;
    }
    setSpeaking(true);
    setAmbient("talking");
    try {
      const audio = await speak(synthesis);
      audio.onended = () => {
        setSpeaking(false);
        setAmbient("idle");
      };
    } catch {
      setSpeaking(false);
      setAmbient("idle");
    }
  };

  const saveSource = async (s: ExploreSource) => {
    if (!s.url || saved[s.url]) return;
    setSaved((p) => ({ ...p, [s.url]: true }));
    try {
      await fetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: s.url, title: s.title, source: s.source, topic }),
      });
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="pb-16">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="font-display text-sm font-bold uppercase tracking-wide text-secondary">Ask Tiru to research</p>
          <h1 className="flex items-center gap-2 font-display text-display text-text">
            <Compass className="h-8 w-8 text-primary" /> Explore
          </h1>
          <p className="text-muted">
            Type any topic — Tiru researches the <strong>last 30 days</strong> across Reddit, X, YouTube, HN, GitHub &amp; the web.
          </p>
        </div>
        <Mascot state={speaking ? "talking" : researching ? "thinking" : "idle"} size={84} float lean />
      </header>

      {/* Search box */}
      <div className="card mb-4 p-4">
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5 shrink-0 text-muted" />
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && research()}
            placeholder="e.g. AI video tools, Rust async, what users want in Next.js…"
            className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-muted"
            disabled={researching}
          />
          <Button size="sm" onClick={() => research()} disabled={researching || !topic.trim()}>
            {researching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {researching ? "Researching…" : "Research"}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => research(s)}
              disabled={researching}
              className="chip bg-surface-alt text-xs text-muted transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Progress */}
      {researching && (
        <div className="card mb-4 p-5">
          <div className="mb-3 flex items-center gap-2 font-display font-bold text-primary">
            <Loader2 className="h-4 w-4 animate-spin" /> Tiru is researching “{topic}”…
          </div>
          <ul className="flex flex-col gap-1.5">
            {steps.map((s, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-center gap-2 text-sm",
                  i === steps.length - 1 ? "text-text" : "text-muted"
                )}
              >
                {i === steps.length - 1 ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                ) : (
                  <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                )}
                {s}
              </li>
            ))}
            {steps.length === 0 && <li className="text-sm text-muted">Spinning up the research skill…</li>}
          </ul>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="card mb-4 flex items-center gap-3 border border-danger/30 p-5">
          <Mascot state="error" size={56} />
          <div>
            <p className="font-display font-bold text-danger">
              <AlertTriangle className="mr-1 inline h-4 w-4" /> Research hit a snag
            </p>
            <p className="text-sm text-muted">{error}</p>
            <p className="mt-1 text-xs text-muted">Make sure the agent worker is running: <code>npm run worker</code></p>
          </div>
        </div>
      )}

      {/* Synthesis */}
      {status === "ready" && synthesis && (
        <div className="card mb-4 p-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-h3 text-text">
              <Sparkles className="h-4 w-4 text-amber" /> What people are saying
            </h2>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant={speaking ? "primary" : "neutral"} onClick={toggleSpeak}>
                {speaking ? <Square className="h-3.5 w-3.5" /> : <Volume2 className="h-4 w-4" />}
                {speaking ? "Stop" : "Tiru explains"}
              </Button>
              <Button size="sm" onClick={generateLesson} disabled={lessonBusy}>
                {lessonBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GraduationCap className="h-4 w-4" />}
                {lessonBusy ? "Building…" : "Make a lesson"}
              </Button>
            </div>
          </div>
          <p className="whitespace-pre-line text-text">{synthesis}</p>
          {lessonBusy && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-secondary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {lessonStep || "Tiru is writing your lesson…"}
            </p>
          )}
          {followups.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-secondary">
                <Sparkles className="h-3.5 w-3.5" /> Tiru suggests researching next
              </p>
              <div className="flex flex-wrap gap-2">
                {followups.map((f) => (
                  <button
                    key={f}
                    onClick={() => research(f)}
                    className="chip bg-primary/10 text-xs font-semibold text-primary transition-transform hover:scale-105"
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sources */}
      {status === "ready" && sources.length > 0 && (
        <>
          <h2 className="mb-3 font-display text-h3 text-text">Top sources ({sources.length})</h2>
          <div className="flex flex-col gap-3">
            {sources.map((s, i) => (
              <div key={`${s.url}-${i}`} className="card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="chip bg-surface-alt text-xs uppercase text-muted">{s.source}</span>
                      {s.engagement && <span className="text-xs font-semibold text-secondary">{s.engagement}</span>}
                    </div>
                    <h3 className="font-display text-h3 text-text">{s.title}</h3>
                    {s.snippet && <p className="mt-1 text-sm text-muted">{s.snippet}</p>}
                    {s.url && <p className="mt-1 truncate text-xs text-muted">{s.url}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="neutral" className="w-full">
                          <ExternalLink className="h-4 w-4" /> Open
                        </Button>
                      </a>
                    )}
                    {s.url && (
                      <Button
                        size="sm"
                        variant={saved[s.url] ? "primary" : "neutral"}
                        onClick={() => saveSource(s)}
                        disabled={saved[s.url]}
                      >
                        {saved[s.url] ? <Check className="h-3.5 w-3.5" /> : <Bookmark className="h-4 w-4" />}
                        {saved[s.url] ? "Saved" : "Save"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Next-best material (RAG retrieval over the vector index) */}
      {status === "ready" && related.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 flex items-center gap-2 font-display text-h3 text-text">
            <Sparkles className="h-4 w-4 text-secondary" /> Next best in your library
          </h2>
          <div className="flex flex-col gap-2">
            {related.map((m) => {
              const href = m.kind === "lesson" ? `/lesson/${m.refId}` : m.kind === "article" ? `/article/${m.refId}` : m.url;
              const external = m.kind === "source";
              const Icon = m.kind === "lesson" ? GraduationCap : m.kind === "article" ? Newspaper : ExternalLink;
              return (
                <a
                  key={m.id}
                  href={href || "#"}
                  {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="card flex items-center gap-3 p-4 transition-transform hover:-translate-y-0.5"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display font-bold text-text">{m.title}</p>
                    <p className="text-xs capitalize text-muted">{m.kind} · {m.topic || "general"}</p>
                  </div>
                  <span className="chip bg-surface-alt text-xs text-secondary">{Math.round(m.score * 100)}% match</span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty / first run */}
      {status === "idle" && (
        <div className="card flex items-center gap-3 p-5 text-muted">
          <Mascot state="empty" size={64} />
          <p>Ask Tiru anything you want to get current on — pick a suggestion above or type your own topic.</p>
        </div>
      )}
    </div>
  );
}
