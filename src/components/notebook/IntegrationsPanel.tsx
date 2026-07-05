"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, MinusCircle, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

type IntegrationState = "live" | "mock" | "off";

interface IntegrationStatus {
  id: string;
  label: string;
  state: IntegrationState;
  detail: string;
}

interface Report {
  integrations: IntegrationStatus[];
  skillsLast30Days: number;
  totalSkills: number;
}

const STATE_UI: Record<
  IntegrationState,
  { dot: string; text: string; Icon: React.ElementType; label: string }
> = {
  live: { dot: "bg-success", text: "text-success", Icon: CheckCircle2, label: "Live" },
  mock: { dot: "bg-amber", text: "text-amber", Icon: CircleDashed, label: "Mock" },
  off: { dot: "bg-muted", text: "text-muted", Icon: MinusCircle, label: "Off" },
};

export function IntegrationsPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/integrations")
      .then((r) => r.json())
      .then((d: Report) => {
        if (!cancelled) setReport(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="card mb-6 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-h3 text-text">Integrations</h2>
        {report && (
          <span className="chip bg-primary/10 text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            {report.skillsLast30Days} skill{report.skillsLast30Days === 1 ? "" : "s"} learned · 30d
          </span>
        )}
      </div>

      {loading && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-12 w-full" />
          ))}
        </div>
      )}

      {!loading && report && (
        <div className="flex flex-col divide-y divide-border">
          {report.integrations.map((it) => {
            const ui = STATE_UI[it.state];
            return (
              <div key={it.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-semibold text-text">{it.label}</p>
                  <p className="truncate text-xs text-muted">{it.detail}</p>
                </div>
                <span className={cn("flex shrink-0 items-center gap-1.5 text-sm font-bold", ui.text)}>
                  <span className={cn("h-2 w-2 rounded-full", ui.dot)} />
                  {ui.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {!loading && report && (
        <p className="mt-3 text-xs text-muted">
          <span className="font-semibold text-amber">Mock</span> means a hermetic simulator is
          standing in — the app still works in degraded mode.
        </p>
      )}
    </div>
  );
}
