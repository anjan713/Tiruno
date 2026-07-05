"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Briefcase, Check, Loader2, Sparkles } from "lucide-react";
import { Mascot } from "@/components/mascot/Mascot";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/cn";
import { useGameStore } from "@/lib/store/useGameStore";
import { useMascot } from "@/components/mascot/MascotProvider";
import { primeAudio, playSfx } from "@/lib/sound/sfx";
import { MOCK_COURSES, PRO_INTERESTS } from "@/lib/mock/data";

type Step = "role" | "sync" | "courses" | "interests" | "building";

const BUILD_STEPS = [
  "Analyzing your selections",
  "Profiling strengths & gaps",
  "Drafting Unit 1 · Foundations",
  "Generating grounded lessons",
  "Polishing your skill tree",
];

export default function Onboarding() {
  const router = useRouter();
  const { setPersona, toggleCourse, toggleInterest, finishOnboarding, selectedCourses, selectedInterests, name, setName } =
    useGameStore();
  const { setAmbient, fire } = useMascot();
  const [step, setStep] = useState<Step>("role");
  const [syncing, setSyncing] = useState(false);
  const [buildIdx, setBuildIdx] = useState(0);

  useEffect(() => {
    setAmbient("onboarding");
  }, [setAmbient]);

  // SSE-style progressive reveal of the build steps
  useEffect(() => {
    if (step !== "building") return;
    setAmbient("generating");
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setBuildIdx(i);
      playSfx("ding");
      if (i >= BUILD_STEPS.length) {
        clearInterval(t);
        setTimeout(() => {
          finishOnboarding();
          fire("complete", { takeover: true, title: "Your path is ready!" });
          router.push("/learn");
        }, 700);
      }
    }, 720);
    return () => clearInterval(t);
  }, [step, finishOnboarding, router, setAmbient, fire]);

  const pickStudent = () => {
    primeAudio();
    playSfx("level_chime");
    setPersona("student");
    setStep("sync");
  };
  const pickPro = () => {
    primeAudio();
    playSfx("level_chime");
    setPersona("professional");
    setStep("interests");
  };

  const runSync = () => {
    setSyncing(true);
    setAmbient("thinking");
    setTimeout(() => {
      setSyncing(false);
      setAmbient("onboarding");
      setStep("courses");
    }, 1600);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      {/* Warm backdrop */}
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-40"
        style={{ backgroundImage: "url(/art/bg/bg_onboarding.webp)" }}
      />
      <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-12">
        <Logo size="lg" className="mb-2" />

        {step === "role" && (
          <div className="flex w-full flex-col items-center animate-rise">
            <Mascot state="onboarding" size={180} float bubble />
            <h1 className="mb-1 mt-2 text-center font-display text-display text-text text-balance">
              Hi! I&apos;m Tiru. What brings you here?
            </h1>
            <p className="mb-6 text-center text-muted">Pick a path — you can change it later.</p>
            <div className="mb-7 w-full max-w-xs">
              <label htmlFor="name" className="mb-1 block text-center text-sm font-semibold text-muted">
                First, what should I call you?
              </label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-btn border-2 border-border bg-surface px-4 py-2.5 text-center font-display font-bold text-text outline-none transition-colors focus:border-primary"
              />
            </div>
            <div className="grid w-full gap-4 sm:grid-cols-2">
              <RoleCard icon={<GraduationCap className="h-9 w-9" />} title="Student" sub="Sync Canvas courses & close gaps" onClick={pickStudent} />
              <RoleCard icon={<Briefcase className="h-9 w-9" />} title="Professional" sub="Pick interests & stay current" onClick={pickPro} />
            </div>
          </div>
        )}

        {step === "sync" && (
          <div className="flex w-full max-w-md flex-col items-center text-center animate-rise">
            <Mascot state={syncing ? "thinking" : "onboarding"} size={150} float bubble />
            <h2 className="mb-1 mt-2 font-display text-h2 text-text">Connect Canvas</h2>
            <p className="mb-6 text-muted">We&apos;ll pull your courses (mocked for the demo).</p>
            <Button size="lg" block onClick={runSync} disabled={syncing}>
              {syncing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
              {syncing ? "Syncing…" : "Connect & Sync"}
            </Button>
          </div>
        )}

        {step === "courses" && (
          <div className="flex w-full max-w-lg flex-col items-center animate-rise">
            <Mascot state="onboarding" size={120} />
            <h2 className="mb-1 mt-2 text-center font-display text-h2 text-text">Which courses should we teach?</h2>
            <p className="mb-6 text-center text-muted">Multi-select — none preselected was the rule; we picked a couple to start.</p>
            <div className="grid w-full gap-3">
              {MOCK_COURSES.map((c) => {
                const on = selectedCourses.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => {
                      toggleCourse(c.id);
                      playSfx(on ? "boing" : "ding");
                    }}
                    className={cn(
                      "flex items-center justify-between rounded-card border-2 bg-surface p-4 text-left transition-all",
                      on ? "border-primary shadow-soft" : "border-border hover:border-muted"
                    )}
                  >
                    <div>
                      <div className="font-display text-sm font-bold text-primary">{c.code}</div>
                      <div className="font-semibold text-text">{c.name}</div>
                    </div>
                    <span className={cn("grid h-7 w-7 place-items-center rounded-full border-2", on ? "border-primary bg-primary text-primary-fg" : "border-border")}>
                      {on && <Check className="h-4 w-4" />}
                    </span>
                  </button>
                );
              })}
            </div>
            <Button size="lg" block className="mt-6" disabled={selectedCourses.length === 0} onClick={() => setStep("building")}>
              Build my path <Sparkles className="h-5 w-5" />
            </Button>
          </div>
        )}

        {step === "interests" && (
          <div className="flex w-full max-w-lg flex-col items-center animate-rise">
            <Mascot state="onboarding" size={120} />
            <h2 className="mb-1 mt-2 text-center font-display text-h2 text-text">What do you want to grow in?</h2>
            <p className="mb-6 text-center text-muted">Pick a few interests — we&apos;ll seed your topic tree.</p>
            <div className="flex flex-wrap justify-center gap-2.5">
              {PRO_INTERESTS.map((it) => {
                const on = selectedInterests.includes(it);
                return (
                  <button
                    key={it}
                    onClick={() => {
                      toggleInterest(it);
                      playSfx(on ? "boing" : "ding");
                    }}
                    className={cn(
                      "chip border-2 px-4 py-2 font-display text-sm transition-all",
                      on ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface text-text hover:border-muted"
                    )}
                  >
                    {it}
                  </button>
                );
              })}
            </div>
            <Button size="lg" block className="mt-7" disabled={selectedInterests.length === 0} onClick={() => setStep("building")}>
              Build my path <Sparkles className="h-5 w-5" />
            </Button>
          </div>
        )}

        {step === "building" && (
          <div className="flex w-full max-w-md flex-col items-center text-center animate-rise">
            <Mascot state="generating" size={170} float bubble />
            <h2 className="mb-6 mt-2 font-display text-h2 text-text">Tiru is building your path…</h2>
            <div className="flex w-full flex-col gap-2.5">
              {BUILD_STEPS.map((s, i) => {
                const done = i < buildIdx;
                const active = i === buildIdx;
                return (
                  <div
                    key={s}
                    className={cn(
                      "flex items-center gap-3 rounded-btn border px-4 py-3 text-left transition-all",
                      done ? "border-success/40 bg-success/10" : active ? "border-primary bg-primary/5" : "border-border bg-surface opacity-60"
                    )}
                  >
                    <span className={cn("grid h-6 w-6 place-items-center rounded-full", done ? "bg-success text-white" : active ? "bg-primary text-primary-fg" : "bg-surface-alt text-muted")}>
                      {done ? <Check className="h-4 w-4" /> : active ? <Loader2 className="h-4 w-4 animate-spin" /> : i + 1}
                    </span>
                    <span className={cn("font-semibold", done ? "text-text" : active ? "text-text" : "text-muted")}>{s}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RoleCard({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-start gap-3 rounded-card border-2 border-border bg-surface p-6 text-left transition-all hover:-translate-y-1 hover:border-primary hover:shadow-lift"
    >
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary transition-transform group-hover:scale-110">
        {icon}
      </span>
      <div>
        <div className="font-display text-h3 text-text">{title}</div>
        <div className="text-sm text-muted">{sub}</div>
      </div>
    </button>
  );
}
