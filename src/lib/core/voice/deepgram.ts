import type { TTSOptions, TTSResult, VoiceProvider } from "./types";

/** Deepgram adapter: Aura TTS (speak) + Nova STT (listen). */
export class DeepgramVoice implements VoiceProvider {
  readonly name = "deepgram";
  readonly canTTS = true;
  readonly canSTT = true;
  private readonly apiKey: string;
  private readonly ttsModel: string;
  private readonly sttModel: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.ttsModel = process.env.DEEPGRAM_TTS_MODEL || "aura-2-apollo-en";
    this.sttModel = process.env.DEEPGRAM_STT_MODEL || "nova-3";
  }

  async tts(text: string, opts: TTSOptions = {}): Promise<TTSResult> {
    const model = opts.voice || this.ttsModel;
    const res = await fetch(`https://api.deepgram.com/v1/speak?model=${model}&encoding=mp3`, {
      method: "POST",
      headers: { Authorization: `Token ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`deepgram tts ${res.status}: ${detail.slice(0, 200)}`);
    }
    return { stream: res.body, contentType: "audio/mpeg" };
  }

  async stt(audio: ArrayBuffer, contentType: string): Promise<string> {
    const res = await fetch(
      `https://api.deepgram.com/v1/listen?model=${this.sttModel}&smart_format=true&punctuate=true`,
      {
        method: "POST",
        headers: { Authorization: `Token ${this.apiKey}`, "Content-Type": contentType },
        body: audio,
      }
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`deepgram stt ${res.status}: ${detail.slice(0, 200)}`);
    }
    const json = await res.json();
    return String(json?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
  }
}
