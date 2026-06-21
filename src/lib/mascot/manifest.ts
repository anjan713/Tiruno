// Single source of truth mapping mascot states -> assets.
// Mirrors docs/mascot-assets.md + docs/mascot-animation.md state machine.

export type PoseName =
  | "idle"
  | "wave"
  | "happy"
  | "faint"
  | "thinking"
  | "listening"
  | "tired"
  | "cheer"
  | "levelup"
  | "shrug"
  | "walk"
  | "talking";

export type ClipName =
  | "idle_loop"
  | "talking_loop"
  | "celebrate_loop"
  | "faint_loop"
  | "generating_loop"
  | "walk_loop";

export type SfxName =
  | "ding"
  | "boing"
  | "fanfare"
  | "level_chime"
  | "whoosh"
  | "error";

export type FxName =
  | "confetti"
  | "xp_burst"
  | "heart_shatter"
  | "streak_flame"
  | "ring_fill"
  | "sparkle";

export type MascotState =
  | "idle"
  | "greet"
  | "onboarding"
  | "talking"
  | "listening"
  | "thinking"
  | "generating"
  | "correct"
  | "wrong"
  | "complete"
  | "perfect"
  | "levelUp"
  | "streakUp"
  | "outOfHearts"
  | "streakRisk"
  | "error"
  | "empty"
  | "roaming";

export interface MascotStateDef {
  /** Preferred looping clip (transparent webm/webp). */
  clip?: ClipName;
  /** Static pose fallback / reduced-motion. */
  pose: PoseName;
  /** Sound effect to fire on enter. */
  sfx?: SfxName;
  /** Visual FX hook. */
  fx?: FxName;
  /** Optional speech-bubble line. */
  line?: string;
}

export const MASCOT_BASE = "/mascot";

export const MASCOT: Record<MascotState, MascotStateDef> = {
  idle: { clip: "idle_loop", pose: "idle" },
  greet: { pose: "wave", sfx: "level_chime", line: "Hi! I'm Tiru." },
  onboarding: { pose: "wave", sfx: "level_chime", line: "What brings you here?" },
  talking: { clip: "talking_loop", pose: "talking" },
  listening: { pose: "listening", line: "I'm listening…" },
  thinking: { clip: "generating_loop", pose: "thinking" },
  generating: { clip: "generating_loop", pose: "thinking", line: "Building your path…" },
  correct: { pose: "happy", sfx: "ding", fx: "xp_burst", line: "Nice!" },
  wrong: { clip: "faint_loop", pose: "faint", sfx: "boing", fx: "heart_shatter", line: "Oops — let's try again!" },
  complete: { clip: "celebrate_loop", pose: "cheer", sfx: "fanfare", fx: "confetti", line: "Lesson complete!" },
  perfect: { clip: "celebrate_loop", pose: "cheer", sfx: "fanfare", fx: "confetti", line: "Flawless! No hearts lost!" },
  levelUp: { pose: "levelup", sfx: "level_chime", fx: "ring_fill", line: "Level up!" },
  streakUp: { pose: "cheer", sfx: "whoosh", fx: "streak_flame", line: "Streak extended!" },
  outOfHearts: { pose: "tired", sfx: "error", line: "Out of hearts — refill to keep going." },
  streakRisk: { pose: "tired", line: "Don't break your streak!" },
  error: { pose: "shrug", sfx: "error", line: "Hmm, let's retry." },
  empty: { pose: "shrug", line: "Let's find something to learn." },
  roaming: { clip: "walk_loop", pose: "walk" },
};

export const poseWebp = (n: PoseName) => `${MASCOT_BASE}/poses/${n}.webp`;
export const posePng = (n: PoseName) => `${MASCOT_BASE}/poses/${n}.png`;
export const clipWebm = (n: ClipName) => `${MASCOT_BASE}/clips/${n}.webm`;
export const clipWebp = (n: ClipName) => `${MASCOT_BASE}/clips/${n}.webp`;
export const clipPoster = (n: ClipName) => `${MASCOT_BASE}/clips/${n}.poster.png`;
export const sfxUrl = (n: SfxName) => `${MASCOT_BASE}/sfx/${n}.mp3`;
