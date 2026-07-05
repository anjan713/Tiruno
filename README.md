# Tiruno

A playful, **mascot-led** learning app (Duolingo-style) starring **Tiru** the brown bear.
Responsive shell (three-pane on desktop · bottom tab nav on mobile), gamified units (XP · streak · hearts · Skill Score),
a full mascot animation system, and sound. **Mock data first** — the experience is the product.

> Built per the planning docs in `docs/` (gitignored). This README covers the running app.

## Stack
- **Next.js 15** (App Router, TypeScript) + **React 19**
- **Tailwind CSS** (custom token-based design system, light/dark)
- **GSAP-ready** motion + CSS keyframes, **canvas-confetti** for celebrations
- **Howler** for SFX, **Zustand** (persisted) for game state
- **lucide-react** icons, fonts: **Baloo 2** (display) + **Nunito** (body)

## Run
```bash
npm install
npm run dev      # http://localhost:3000  (zero config — no keys, no infra)
npm run worker   # agent worker (research, narration, Hermes) — needs Redis
npm run build    # production build (type-checks everything)
```

### Quick start with Docker (recommended)
One command brings up **Redis Stack** (vector search) + **Ollama** (local, free
embeddings) and auto-pulls the embedding model — then run the app/worker on the host
(they use your Claude subscription via the `claude` CLI login):
```bash
npm run infra        # docker compose up -d  → Redis :6379 (+ UI :8001), Ollama :11434
cp .env.example .env.local   # already points at the local infra
npm run dev          # http://localhost:3000
npm run worker       # background agent worker
```
`npm run infra:down` stops it; `npm run infra:reset` also wipes the volumes.
Embeddings run on **Ollama `mxbai-embed-large`** (1024-dim) — fully local and free;
if Ollama is unreachable, retrieval falls back to a built-in hashing embedder.

## Providers & configuration
Tiruno is built around **pluggable providers** — reasoning, voice, storage,
memory, embeddings, and summarisation each sit behind a small interface with
swappable adapters, auto-selected from env vars. It runs with **zero keys and
zero infrastructure**, then lights up as you add credentials.

- Copy `.env.example` → `.env.local` and set only what you need.
- Full matrix, run modes, and adapter contracts: **[`PROVIDERS.md`](./PROVIDERS.md)**.

Quick options:
- **Claude subscription (no API key):** `claude login` then `LLM_PROVIDER=claude-agent` (leave `ANTHROPIC_API_KEY` unset).
- **Hosted API:** set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.
- **Fully local:** `npm run infra` (Redis Stack + Ollama via Docker) — embeddings + vector search with no keys.

Agent memory and self-improvement live as **living markdown** in the Vault
(`TIRUNO_VAULT_DIR`, default `./vault`) — open it in Obsidian to watch Tiru's
discovery strategy, skills, and reflections evolve (`src/lib/core/hermes`).

## Routes
| Route | What |
|---|---|
| `/onboarding` | Role picker (Student/Professional) → Canvas sync / interests → SSE-style "Tiru is building" reveal |
| `/learn` | Winding skill tree; mascot anchors at your active node; start sheet |
| `/lesson/[id]` | Full-screen MCQ focus player — feedback sheet, citations, hearts, keyboard (1–4 / Enter), completion celebration |
| `/article/[id]` | Narrated article unit — TTS-style narration, mid-narration **Ask Tiru** Q&A, comprehension checkpoints |
| `/review` | Spaced-repetition session; completing refills hearts |
| `/profile` | XP/level/streak/accuracy, per-topic Skill Score, badges |

## Mascot system
- `src/lib/mascot/manifest.ts` — single source of truth: **state → clip/pose/sfx/fx** (mirrors `docs/mascot-assets.md`).
- `src/components/mascot/Mascot.tsx` — renders transparent **WebM** clip → animated **WebP** (Safari) → static **pose** fallback; honors `prefers-reduced-motion`.
- `src/components/mascot/MascotProvider.tsx` — director: SFX + confetti + **center-stage takeovers** for milestones.
- Desktop delighter: **cursor-lean** (`useCursorLean`).

## Assets
Web-ready assets live in `public/` (optimized from the source masters in the gitignored `resource /`):
```
public/mascot/poses/*.webp + .png      public/mascot/clips/*.webm + .webp + .poster.png
public/mascot/sfx/*.mp3 (+ .ogg)       public/art/{badges,empty,hero,bg}/*.webp
```
Re-generate the optimized copies with `cwebp`/`ffmpeg`/`sips` (see `docs/mascot-assets.md`).

## Accessibility & polish
- WCAG-minded contrast in both themes, visible focus rings, full keyboard lesson play.
- `prefers-reduced-motion` freezes clips/confetti to static poses; global **sound mute** in the left nav (top bar on mobile, where the left nav is hidden).
- 3D pressable buttons, spring pops, XP/ring count-ups, streak flame, confetti on completion.

## Status
Phases 0–2 (asset pipeline + UI/UX + gamification, all mock). Voice (Deepgram) narration, the agent
worker, and live grounding are Phase 3–5 (see `docs/phases.md`).
