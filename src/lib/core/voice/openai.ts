import type { TTSOptions, TTSResult, VoiceProvider } from "./types";

/**
 * OpenAI adapter: gpt-4o-mini-tts (speak) + Whisper (transcribe). Works with any
 * OpenAI-compatible gateway via OPENAI_BASE_URL.
 */
export class OpenAIVoice implements VoiceProvider {
  readonly name = "openai";
  readonly canTTS = true;
  readonly canSTT = true;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly ttsModel: string;
  private readonly ttsVoice: string;
  private readonly sttModel: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    this.ttsModel = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
    this.ttsVoice = process.env.OPENAI_TTS_VOICE || "alloy";
    this.sttModel = process.env.OPENAI_STT_MODEL || "whisper-1";
  }

  async tts(text: string, opts: TTSOptions = {}): Promise<TTSResult> {
    const res = await fetch(`${this.baseUrl}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.ttsModel,
        voice: opts.voice || this.ttsVoice,
        input: text,
        response_format: "mp3",
      }),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`openai tts ${res.status}: ${detail.slice(0, 200)}`);
    }
    return { stream: res.body, contentType: "audio/mpeg" };
  }

  async stt(audio: ArrayBuffer, contentType: string): Promise<string> {
    const ext = contentType.includes("wav") ? "wav" : contentType.includes("mp3") ? "mp3" : "webm";
    const form = new FormData();
    form.append("file", new Blob([audio], { type: contentType }), `audio.${ext}`);
    form.append("model", this.sttModel);
    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`openai stt ${res.status}: ${detail.slice(0, 200)}`);
    }
    const json = await res.json();
    return String(json?.text ?? "").trim();
  }
}
