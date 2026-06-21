import { Howl, Howler } from "howler";
import { sfxUrl, type SfxName } from "@/lib/mascot/manifest";

const SFX_NAMES: SfxName[] = ["ding", "boing", "fanfare", "level_chime", "whoosh", "error"];

let cache: Partial<Record<SfxName, Howl>> = {};
let loaded = false;
let muted = false;

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  for (const name of SFX_NAMES) {
    cache[name] = new Howl({
      src: [sfxUrl(name), `/mascot/sfx/${name}.ogg`],
      volume: name === "fanfare" ? 0.6 : 0.5,
      preload: true,
    });
  }
}

export function setSfxMuted(value: boolean) {
  muted = value;
  if (typeof window !== "undefined") Howler.mute(value);
}

export function isSfxMuted() {
  return muted;
}

export function playSfx(name?: SfxName) {
  if (!name || muted || typeof window === "undefined") return;
  ensureLoaded();
  const h = cache[name];
  if (h) {
    try {
      h.play();
    } catch {
      /* autoplay can be blocked until first gesture; ignore */
    }
  }
}

/** Call once after a user gesture to unlock the audio context. */
export function primeAudio() {
  ensureLoaded();
}
