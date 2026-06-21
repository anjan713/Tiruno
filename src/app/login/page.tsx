"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Briefcase, ArrowRight, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { PROFILES, type ProfileId } from "@/lib/mock/profiles";
import { applyProfile } from "@/lib/profileSync";
import { primeAudio, playSfx } from "@/lib/sound/sfx";

const TABS: { id: ProfileId; label: string; icon: React.ElementType }[] = [
  { id: "student", label: "Student", icon: GraduationCap },
  { id: "professional", label: "Professional", icon: Briefcase },
];

export default function LoginPage() {
  const router = useRouter();
  const [sel, setSel] = useState<ProfileId>("student");
  const [username, setUsername] = useState(PROFILES.student.username);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const p = PROFILES[sel];

  const selectTab = (id: ProfileId) => {
    setSel(id);
    setUsername(PROFILES[id].username);
    setPassword("");
    setError(null);
    playSfx("ding");
  };

  const login = async () => {
    if (username.trim() !== p.username || password !== p.password) {
      setError("Incorrect username or password.");
      playSfx("boing");
      return;
    }
    primeAudio();
    playSfx("level_chime");
    setBusy(true);
    await applyProfile(sel);
    router.push("/learn");
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-40"
        style={{ backgroundImage: "url(/art/bg/bg_onboarding.webp)" }}
      />
      <div className="relative mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 py-12">
        <div className="mb-6 font-display text-3xl font-extrabold text-primary">◆ Tiruno</div>

        {/* Top bar: switch Student / Professional */}
        <div className="mb-8 flex w-full max-w-xs rounded-chip bg-surface-alt p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => selectTab(id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-chip py-2.5 font-display text-sm font-bold transition-all",
                sel === id ? "bg-primary text-primary-fg shadow-soft" : "text-muted hover:text-text"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Profile card */}
        <div key={sel} className="card w-full animate-rise p-6">
          <div className="mb-5 flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.avatar} alt={p.name} className="drag-none h-16 w-16 rounded-2xl bg-surface-alt object-contain p-1" />
            <div>
              <h1 className="font-display text-h3 text-text">{p.name}</h1>
              <p className="text-sm text-muted">{p.tagline}</p>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              login();
            }}
            className="flex flex-col gap-3"
          >
            <div>
              <label htmlFor="username" className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Username</label>
              <input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                className="w-full rounded-btn border-2 border-border bg-surface px-4 py-2.5 font-semibold text-text outline-none transition-colors focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••"
                className="w-full rounded-btn border-2 border-border bg-surface px-4 py-2.5 font-semibold text-text outline-none transition-colors focus:border-primary"
              />
            </div>
            {error && (
              <p className="flex items-center gap-1.5 text-sm font-semibold text-danger">
                <AlertCircle className="h-4 w-4" /> {error}
              </p>
            )}
            <Button type="submit" block size="lg" disabled={busy} className="mt-1">
              {busy ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" /> Signing in…
                </>
              ) : (
                <>
                  Log in <ArrowRight className="h-5 w-5" />
                </>
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
