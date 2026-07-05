// Hermes self-improving loop. See ./types.ts for the cycle overview.

import { getVault, type Vault } from "../vault";
import { getLLM, parseJsonFromText, type LLMProvider } from "../llm";
import type { RedisLike } from "../store/types";
import {
  DEFAULT_STRATEGY,
  type DiscoveryStrategy,
  type HermesEpisode,
  type HermesSkill,
  type OutcomeStats,
  type Reflection,
} from "./types";

export type {
  DiscoveryStrategy,
  HermesEpisode,
  HermesSkill,
  Reflection,
  OutcomeStats,
} from "./types";
export { DEFAULT_STRATEGY } from "./types";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
const ts = () => new Date().toISOString().replace(/[:.]/g, "-");

export interface HermesOptions {
  vault?: Vault;
  llm?: LLMProvider | null;
  redis?: RedisLike;
}

export class Hermes {
  private vault: Vault;
  private llm: LLMProvider | null;
  private redis?: RedisLike;

  constructor(opts: HermesOptions = {}) {
    this.vault = opts.vault ?? getVault();
    this.llm = opts.llm ?? getLLM();
    this.redis = opts.redis;
  }

  // --- paths ---
  private strategyPath(uid: string) {
    return `strategies/discovery-${slug(uid)}`;
  }
  private episodePath(uid: string, task: string) {
    return `memory/episodes/${slug(uid)}/${ts()}-${slug(task)}`;
  }
  private reflectionPath(uid: string) {
    return `reflections/${slug(uid)}/${ts()}`;
  }
  private skillPath(name: string) {
    return `skills/${slug(name)}`;
  }

  // --- ACT step: episodic memory ---
  async recordEpisode(ep: Omit<HermesEpisode, "id" | "at"> & { at?: number }): Promise<void> {
    const at = ep.at ?? Date.now();
    const frontmatter: Record<string, unknown> = {
      task: ep.task,
      topic: ep.topic ?? "",
      strategyVersion: ep.strategyVersion,
      at,
    };
    for (const [k, v] of Object.entries(ep.metrics)) frontmatter[`metric_${k}`] = v;
    const body =
      `# ${ep.task} — ${ep.topic ?? ""}\n\n` +
      `**Input:** ${ep.input}\n\n` +
      `**Output:** ${ep.output}\n\n` +
      `**Metrics:** ${Object.entries(ep.metrics).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}\n`;
    await this.vault.write(this.episodePath(ep.uid, ep.task), body, { frontmatter });
  }

  async recentEpisodes(uid: string, n = 12): Promise<HermesEpisode[]> {
    const paths = await this.vault.list(`memory/episodes/${slug(uid)}`);
    const latest = paths.slice(-n);
    const out: HermesEpisode[] = [];
    for (const p of latest) {
      const note = await this.vault.read(p);
      if (!note) continue;
      const fm = note.frontmatter;
      const metrics: Record<string, number> = {};
      for (const [k, v] of Object.entries(fm)) {
        if (k.startsWith("metric_") && typeof v === "number") metrics[k.slice(7)] = v;
      }
      out.push({
        id: p,
        uid,
        task: String(fm.task ?? ""),
        topic: fm.topic ? String(fm.topic) : undefined,
        strategyVersion: Number(fm.strategyVersion ?? 0),
        input: "",
        output: "",
        metrics,
        at: Number(fm.at ?? note.updatedAt),
      });
    }
    return out;
  }

  // --- reward signal (kept compatible with existing Redis outcome list) ---
  async recordOutcome(uid: string, followup: string, accepted: boolean): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.lpush(
        `suggestions:${uid}:outcomes`,
        JSON.stringify({ followup, accepted, at: Date.now() })
      );
      await this.redis.ltrim(`suggestions:${uid}:outcomes`, 0, 199);
    } catch {
      /* best effort */
    }
  }

  async outcomeStats(uid: string): Promise<OutcomeStats> {
    let accepts = 0;
    let total = 0;
    if (this.redis) {
      try {
        const raw = await this.redis.lrange(`suggestions:${uid}:outcomes`, 0, 49);
        for (const r of raw) {
          try {
            const o = JSON.parse(r);
            total += 1;
            if (o.accepted) accepts += 1;
          } catch {
            /* skip */
          }
        }
      } catch {
        /* best effort */
      }
    }
    return { total, accepts, acceptRate: total ? accepts / total : 0.5 };
  }

  // --- strategy (living file) ---
  async currentStrategy(uid: string): Promise<DiscoveryStrategy> {
    const note = await this.vault.read(this.strategyPath(uid));
    if (!note) return { ...DEFAULT_STRATEGY };
    const fm = note.frontmatter;
    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
    return {
      version: Number(fm.version ?? 1),
      noveltyExplore: Number(fm.noveltyExplore ?? DEFAULT_STRATEGY.noveltyExplore),
      sourceMix: arr(fm.sourceMix).length ? arr(fm.sourceMix) : DEFAULT_STRATEGY.sourceMix,
      preferred: arr(fm.preferred),
      avoid: arr(fm.avoid),
      note: String(fm.note ?? DEFAULT_STRATEGY.note),
      at: Number(fm.at ?? note.updatedAt),
    };
  }

  private async saveStrategy(uid: string, s: DiscoveryStrategy): Promise<void> {
    const frontmatter: Record<string, unknown> = {
      version: s.version,
      noveltyExplore: Number(s.noveltyExplore.toFixed(2)),
      sourceMix: s.sourceMix,
      preferred: s.preferred,
      avoid: s.avoid,
      note: s.note,
      at: s.at,
    };
    const body =
      `# Discovery strategy (v${s.version})\n\n` +
      `${s.note}\n\n` +
      `- **Explore new voices:** ${(s.noveltyExplore * 100).toFixed(0)}%\n` +
      `- **Source mix:** ${s.sourceMix.join(", ")}\n` +
      `- **Favor:** ${s.preferred.join(", ") || "—"}\n` +
      `- **De-emphasize:** ${s.avoid.join(", ") || "—"}\n`;
    await this.vault.write(this.strategyPath(uid), body, { frontmatter });

    // Mirror to Redis for fast runtime reads / backward compatibility.
    if (this.redis) {
      try {
        await this.redis.lpush(`strategy:discovery:${uid}`, JSON.stringify(s));
        await this.redis.ltrim(`strategy:discovery:${uid}`, 0, 19);
        await this.redis.lpush(
          "improvements:log",
          JSON.stringify({ uid, version: s.version, note: s.note, at: s.at })
        );
        await this.redis.ltrim("improvements:log", 0, 199);
      } catch {
        /* best effort */
      }
    }
  }

  // --- skills (living files) ---
  async saveSkill(skill: Omit<HermesSkill, "version" | "at">): Promise<HermesSkill> {
    const existing = await this.vault.read(this.skillPath(skill.name));
    const version = existing ? Number(existing.frontmatter.version ?? 0) + 1 : 1;
    const full: HermesSkill = { ...skill, version, at: Date.now() };
    const body =
      `# Skill: ${full.name}\n\n` +
      `**When:** ${full.when}\n\n` +
      `## Steps\n` +
      full.steps.map((s, i) => `${i + 1}. ${s}`).join("\n") +
      "\n";
    await this.vault.write(this.skillPath(full.name), body, {
      frontmatter: { name: full.name, when: full.when, version: full.version, at: full.at },
    });
    return full;
  }

  async relevantSkills(query: string, limit = 3): Promise<HermesSkill[]> {
    const hits = await this.vault.search(query, { dir: "skills", limit });
    const out: HermesSkill[] = [];
    for (const h of hits) {
      const note = await this.vault.read(h.path);
      if (!note) continue;
      const steps = note.content
        .split(/\r?\n/)
        .map((l) => l.match(/^\d+\.\s+(.*)$/)?.[1])
        .filter((x): x is string => !!x);
      out.push({
        name: String(note.frontmatter.name ?? h.path),
        when: String(note.frontmatter.when ?? ""),
        steps,
        version: Number(note.frontmatter.version ?? 1),
        at: Number(note.frontmatter.at ?? note.updatedAt),
      });
    }
    return out;
  }

  // --- prompt hints (close the loop: evolved knowledge shapes the next run) ---
  async strategyHint(uid: string): Promise<string> {
    const s = await this.currentStrategy(uid);
    const parts = [
      `Discovery strategy v${s.version}: spend ~${(s.noveltyExplore * 100).toFixed(0)}% of effort surfacing fresh/novel voices.`,
    ];
    if (s.preferred.length) parts.push(`Favor these sources that have worked well: ${s.preferred.join(", ")}.`);
    if (s.avoid.length) parts.push(`De-emphasize: ${s.avoid.join(", ")}.`);
    return parts.join(" ");
  }

  async skillsHint(query: string): Promise<string> {
    const skills = await this.relevantSkills(query, 2);
    if (!skills.length) return "";
    return (
      "Apply these learned skills where relevant:\n" +
      skills.map((s) => `- ${s.name} (when ${s.when}): ${s.steps.join("; ")}`).join("\n")
    );
  }

  // --- REFLECT + EVOLVE ---
  async reflectAndEvolve(uid: string): Promise<DiscoveryStrategy> {
    const [prev, stats, episodes] = await Promise.all([
      this.currentStrategy(uid),
      this.outcomeStats(uid),
      this.recentEpisodes(uid, 12),
    ]);

    // Deterministic baseline: low accept rate -> explore more; high -> exploit.
    const baselineNovelty = Math.max(
      0.1,
      Math.min(0.5, stats.total ? 0.2 + (0.5 - stats.acceptRate) * 0.4 : 0.2)
    );

    const reflection = await this.llmReflect(uid, prev, stats, episodes, baselineNovelty);

    const next: DiscoveryStrategy = {
      version: prev.version + 1,
      noveltyExplore: Number(
        (reflection.adjustments.noveltyExplore ?? baselineNovelty).toFixed(2)
      ),
      sourceMix: reflection.adjustments.sourceMix?.length
        ? reflection.adjustments.sourceMix
        : prev.sourceMix,
      preferred: dedupe([...(reflection.adjustments.preferred ?? []), ...prev.preferred]).slice(0, 8),
      avoid: dedupe([...(reflection.adjustments.avoid ?? []), ...prev.avoid]).slice(0, 8),
      note:
        reflection.critique ||
        (stats.total === 0
          ? DEFAULT_STRATEGY.note
          : `Tuned from ${stats.total} outcomes (accept ${(stats.acceptRate * 100).toFixed(0)}%).`),
      at: Date.now(),
    };

    await this.saveStrategy(uid, next);
    await this.writeReflection(uid, reflection, stats, next);
    if (reflection.skill && reflection.skill.name && reflection.skill.steps?.length) {
      await this.saveSkill(reflection.skill);
    }
    return next;
  }

  /** LLM-grounded self-grade; falls back to the deterministic heuristic with no LLM. */
  private async llmReflect(
    uid: string,
    prev: DiscoveryStrategy,
    stats: OutcomeStats,
    episodes: HermesEpisode[],
    baselineNovelty: number
  ): Promise<Reflection> {
    const fallback: Reflection = {
      score: stats.acceptRate,
      critique:
        stats.total === 0
          ? "No feedback yet — keeping a balanced, exploratory strategy."
          : `Accept rate ${(stats.acceptRate * 100).toFixed(0)}% over ${stats.total} suggestions; adjusting explore to ${(baselineNovelty * 100).toFixed(0)}%.`,
      adjustments: { noveltyExplore: baselineNovelty },
    };
    if (!this.llm) return fallback;

    const epLines = episodes
      .map((e) => `- ${e.task} "${e.topic ?? ""}" v${e.strategyVersion}: ${Object.entries(e.metrics).map(([k, v]) => `${k}=${v}`).join(", ")}`)
      .join("\n")
      .slice(0, 2000);

    const prompt =
      `You are Hermes, the self-improvement module of a learning agent. Review recent discovery performance and propose how to improve the next strategy version.\n\n` +
      `Current strategy v${prev.version}: explore=${prev.noveltyExplore}, preferred=[${prev.preferred.join(", ")}], avoid=[${prev.avoid.join(", ")}].\n` +
      `Suggestion accept rate: ${(stats.acceptRate * 100).toFixed(0)}% over ${stats.total} outcomes.\n` +
      `Recent episodes:\n${epLines || "(none yet)"}\n\n` +
      `Respond with ONLY a JSON object:\n` +
      `{"score":0..1,"critique":"1-2 sentences","adjustments":{"noveltyExplore":0..1,"preferred":["..."],"avoid":["..."],"sourceMix":["..."]},"skill":{"name":"short-name","when":"trigger","steps":["..."]}}\n` +
      `"skill" is optional — include it only if you learned a concrete, reusable tactic. Keep arrays short.`;

    try {
      const text = await this.llm.complete(prompt, {
        system: "You output only valid JSON. Be concise and grounded in the data provided.",
        maxTokens: 700,
        temperature: 0.4,
        json: true,
      });
      const parsed = parseJsonFromText<Partial<Reflection>>(text, {});
      return {
        score: typeof parsed.score === "number" ? parsed.score : fallback.score,
        critique: parsed.critique || fallback.critique,
        adjustments: parsed.adjustments ?? fallback.adjustments,
        skill: parsed.skill,
      };
    } catch {
      return fallback;
    }
  }

  /** A read-only snapshot of the agent's current self-knowledge (for UIs/APIs). */
  async summary(uid: string): Promise<{
    strategy: DiscoveryStrategy;
    skills: HermesSkill[];
    reflections: Array<{ score: number; strategyVersion: number; at: number }>;
    episodes: number;
  }> {
    const [strategy, episodes] = await Promise.all([
      this.currentStrategy(uid),
      this.recentEpisodes(uid, 100),
    ]);

    const skillPaths = await this.vault.list("skills");
    const skills: HermesSkill[] = [];
    for (const p of skillPaths) {
      const note = await this.vault.read(p);
      if (!note) continue;
      const steps = note.content
        .split(/\r?\n/)
        .map((l) => l.match(/^\d+\.\s+(.*)$/)?.[1])
        .filter((x): x is string => !!x);
      skills.push({
        name: String(note.frontmatter.name ?? p),
        when: String(note.frontmatter.when ?? ""),
        steps,
        version: Number(note.frontmatter.version ?? 1),
        at: Number(note.frontmatter.at ?? note.updatedAt),
      });
    }

    const reflectionPaths = (await this.vault.list(`reflections/${slug(uid)}`)).slice(-10).reverse();
    const reflections: Array<{ score: number; strategyVersion: number; at: number }> = [];
    for (const p of reflectionPaths) {
      const note = await this.vault.read(p);
      if (!note) continue;
      reflections.push({
        score: Number(note.frontmatter.score ?? 0),
        strategyVersion: Number(note.frontmatter.strategyVersion ?? 0),
        at: Number(note.frontmatter.at ?? note.updatedAt),
      });
    }

    return { strategy, skills, reflections, episodes: episodes.length };
  }

  private async writeReflection(
    uid: string,
    r: Reflection,
    stats: OutcomeStats,
    next: DiscoveryStrategy
  ): Promise<void> {
    const body =
      `# Reflection — ${new Date().toISOString()}\n\n` +
      `**Self-grade:** ${(r.score * 100).toFixed(0)}%\n\n` +
      `**Critique:** ${r.critique}\n\n` +
      `**Outcomes:** ${stats.accepts}/${stats.total} accepted (${(stats.acceptRate * 100).toFixed(0)}%)\n\n` +
      `**New strategy:** v${next.version}, explore ${(next.noveltyExplore * 100).toFixed(0)}%` +
      (r.skill ? `\n\n**Learned skill:** ${r.skill.name}` : "") +
      "\n";
    await this.vault.write(this.reflectionPath(uid), body, {
      frontmatter: { uid, score: Number(r.score.toFixed(2)), strategyVersion: next.version, at: Date.now() },
    });
  }
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
}

/** Convenience factory. */
export function getHermes(redis?: RedisLike): Hermes {
  return new Hermes({ redis });
}
