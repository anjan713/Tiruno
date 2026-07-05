// Voice provider registry — env-driven selection.
//
// Override with VOICE_PROVIDER=deepgram|openai|elevenlabs. Auto-detection:
//   DEEPGRAM_API_KEY    -> deepgram  (TTS + STT)
//   OPENAI_API_KEY      -> openai    (TTS + STT)
//   ELEVENLABS_API_KEY  -> elevenlabs (TTS only)
//   (none)              -> null      (client falls back to browser WebSpeech)

import { DeepgramVoice } from "./deepgram";
import { OpenAIVoice } from "./openai";
import { ElevenLabsVoice } from "./elevenlabs";
import type { VoiceProvider } from "./types";

export type { VoiceProvider, TTSResult, TTSOptions } from "./types";
export { TTS_CHAR_LIMIT } from "./types";

export type VoiceProviderName = "deepgram" | "openai" | "elevenlabs" | "none";

export function voiceProviderName(): VoiceProviderName {
  const override = (process.env.VOICE_PROVIDER || "").toLowerCase();
  if (override === "deepgram" || override === "openai" || override === "elevenlabs") return override;
  if (process.env.DEEPGRAM_API_KEY) return "deepgram";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs";
  return "none";
}

/** Active voice provider, or null when none is configured. */
export function getVoiceProvider(): VoiceProvider | null {
  switch (voiceProviderName()) {
    case "deepgram":
      return new DeepgramVoice(process.env.DEEPGRAM_API_KEY!);
    case "openai":
      return new OpenAIVoice(process.env.OPENAI_API_KEY!);
    case "elevenlabs":
      return new ElevenLabsVoice(process.env.ELEVENLABS_API_KEY!);
    default:
      return null;
  }
}
