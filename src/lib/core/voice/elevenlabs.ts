import type { TTSOptions, TTSResult, VoiceProvider } from "./types";

/**
 * ElevenLabs adapter: high-quality TTS only. STT throws (pair it with another
 * provider for speech-in, or rely on the browser WebSpeech fallback).
 */
export class ElevenLabsVoice implements VoiceProvider {
  readonly name = "elevenlabs";
  readonly canTTS = true;
  readonly canSTT = false;
  private readonly apiKey: string;
  private readonly voiceId: string;
  private readonly model: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    // Default to "Rachel" — a widely-available stock voice.
    this.voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
    this.model = process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5";
  }

  async tts(text: string, opts: TTSOptions = {}): Promise<TTSResult> {
    const voice = opts.voice || this.voiceId;
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: this.model }),
      }
    );
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`elevenlabs tts ${res.status}: ${detail.slice(0, 200)}`);
    }
    return { stream: res.body, contentType: "audio/mpeg" };
  }

  async stt(): Promise<string> {
    throw new Error("ElevenLabs adapter does not support STT");
  }
}
