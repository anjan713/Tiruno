# Tiruno

A playful, **mascot-led** learning app (Duolingo-style) starring **Tiru** the brown bear.
Desktop-first three-pane shell, gamified units (XP · streak · hearts · Skill Score),
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
npm run dev      # http://localhost:3000
npm run build    # production build (type-checks everything)
```

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
- `prefers-reduced-motion` freezes clips/confetti to static poses; global **sound mute** in the left nav.
- 3D pressable buttons, spring pops, XP/ring count-ups, streak flame, confetti on completion.

## Status
Phases 0–2 (asset pipeline + UI/UX + gamification, all mock). Voice (Deepgram) narration, the agent
worker, and live grounding are Phase 3–5 (see `docs/phases.md`).
