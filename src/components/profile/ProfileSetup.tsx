"use client";

import { useState } from "react";
import Link from "next/link";
import {
  User,
  Tag,
  Link2,
  Plus,
  Loader2,
  Check,
  X,
  Lock,
  Sparkles,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { useGameStore } from "@/lib/store/useGameStore";
import { useInterestArticles } from "@/lib/profile/useInterestArticles";
import { learnGate, LEARN_MIN_ARTICLES, LEARN_MIN_KEYWORDS } from "@/lib/learn/gate";
import type { StoredArticle } from "@/lib/articles";

export function ProfileSetup() {
  const name = useGameStore((s) => s.name);
  const setName = useGameStore((s) => s.setName);
  const interestKeywords = useGameStore((s) => s.interestKeywords);
  const addInterestKeyword = useGameStore((s) => s.addInterestKeyword);
  const removeInterestKeyword = useGameStore((s) => s.removeInterestKeyword);
  const interestArticleIds = useGameStore((s) => s.interestArticleIds);

  const { articles, adding, ack, addByUrl, remove } = useInterestArticles();

  const [keyword, setKeyword] = useState("");
  const [url, setUrl] = useState("");

  const gate = learnGate({ name, interestArticleIds, interestKeywords });

  const submitKeyword = () => {
    addInterestKeyword(keyword);
    setKeyword("");
  };
  const submitUrl = async () => {
    await addByUrl(url);
    setUrl("");
  };

  return (
    <div className="mb-8">
      {/* Unlock banner */}
      <div
        className={cn(
          "card mb-5 flex items-center gap-4 p-5",
          gate.unlocked ? "border-2 border-success/40 bg-success/5" : "border-2 border-primary/30 bg-primary/5"
        )}
      >
        <span
          className={cn(
            "grid h-12 w-12 shrink-0 place-items-center rounded-2xl",
            gate.unlocked ? "bg-success/15 text-success" : "bg-primary/15 text-primary"
          )}
        >
          {gate.unlocked ? <Sparkles className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-h3 text-text">
            {gate.unlocked ? "Learn is unlocked!" : "Finish setup to unlock Learn"}
          </h2>
          <p className="text-sm text-muted">
            {gate.unlocked
              ? "Your articles of interest are ready to read in the Learn section."
              : `Add ${LEARN_MIN_ARTICLES} article links and ${LEARN_MIN_KEYWORDS} keywords of interest, then read the articles in Learn.`}
          </p>
        </div>
        {gate.unlocked && (
          <Link href="/learn">
            <Button size="sm">
              Go to Learn <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        )}
      </div>

      {/* Your name */}
      <div className="card mb-5 p-5">
        <SectionHeading icon={<User className="h-4 w-4 text-primary" />} title="Your name" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What should Tiru call you?"
          className="w-full rounded-btn border-2 border-border bg-surface px-3 py-2.5 font-semibold text-text outline-none transition-colors focus:border-primary"
        />
      </div>

      {/* Keywords of interest */}
      <div className="card mb-5 p-5">
        <SectionHeading
          icon={<Tag className="h-4 w-4 text-primary" />}
          title="Keywords of interest"
          progress={`${Math.min(interestKeywords.length, LEARN_MIN_KEYWORDS)}/${LEARN_MIN_KEYWORDS}`}
          done={gate.keywordsRemaining === 0}
        />
        <div className="mb-3 flex items-center gap-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitKeyword()}
            placeholder="e.g. distributed systems, LLMs, databases"
            className="min-w-0 flex-1 rounded-btn border-2 border-border bg-surface px-3 py-2.5 text-text outline-none transition-colors focus:border-primary"
          />
          <Button size="sm" onClick={submitKeyword} disabled={!keyword.trim()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
        {interestKeywords.length === 0 ? (
          <p className="text-sm text-muted">No keywords yet — add at least {LEARN_MIN_KEYWORDS}.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {interestKeywords.map((k) => (
              <span key={k} className="chip bg-primary/10 text-primary">
                {k}
                <button
                  onClick={() => removeInterestKeyword(k)}
                  className="ml-1 grid h-4 w-4 place-items-center rounded-full hover:bg-primary/20"
                  aria-label={`Remove ${k}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Article links */}
      <div className="card p-5">
        <SectionHeading
          icon={<Link2 className="h-4 w-4 text-secondary" />}
          title="Articles of interest"
          progress={`${Math.min(interestArticleIds.length, LEARN_MIN_ARTICLES)}/${LEARN_MIN_ARTICLES}`}
          done={gate.articlesRemaining === 0}
        />
        <div className="mb-3 flex items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitUrl()}
            placeholder="Paste an article link… you'll read it in Learn"
            className="min-w-0 flex-1 rounded-btn border-2 border-border bg-surface px-3 py-2.5 text-text outline-none transition-colors focus:border-primary"
          />
          <Button size="sm" onClick={submitUrl} disabled={adding || !url.trim()}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </Button>
        </div>
        {ack && (
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary animate-rise">
            <Sparkles className="h-4 w-4" /> {ack}
          </p>
        )}
        {interestArticleIds.length === 0 ? (
          <p className="text-sm text-muted">No articles yet — add at least {LEARN_MIN_ARTICLES} links.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {articles.map((a) => (
              <ArticleRow key={a.id} a={a} onRemove={() => remove(a.id)} />
            ))}
            {/* ids still resolving on the server show as pending rows */}
            {interestArticleIds
              .filter((id) => !articles.some((a) => a.id === id))
              .map((id) => (
                <div key={id} className="flex items-center gap-2 rounded-btn bg-surface-alt p-3 text-sm text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving link…
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  progress,
  done,
}: {
  icon: React.ReactNode;
  title: string;
  progress?: string;
  done?: boolean;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 font-display text-h3 text-text">
        {icon} {title}
      </h2>
      {progress && (
        <span
          className={cn(
            "flex items-center gap-1 rounded-chip px-2.5 py-1 text-xs font-bold",
            done ? "bg-success/10 text-success" : "bg-surface-alt text-muted"
          )}
        >
          {done && <Check className="h-3.5 w-3.5" />} {progress}
        </span>
      )}
    </div>
  );
}

function ArticleRow({ a, onRemove }: { a: StoredArticle; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-btn bg-surface-alt p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-text">{a.title}</p>
        <p className="truncate text-xs text-muted">{a.url ?? a.source}</p>
      </div>
      <StatusBadge a={a} />
      <button
        onClick={onRemove}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted hover:bg-danger/10 hover:text-danger"
        aria-label={`Remove ${a.title}`}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function StatusBadge({ a }: { a: StoredArticle }) {
  if (a.status === "error")
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-danger">
        <AlertTriangle className="h-3.5 w-3.5" /> Failed
      </span>
    );
  if (a.ready)
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-success">
        <Check className="h-3.5 w-3.5" /> Ready
      </span>
    );
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-amber">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Summarising
    </span>
  );
}
