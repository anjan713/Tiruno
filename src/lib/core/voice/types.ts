// Voice provider contract — speech-out (TTS) and speech-in (STT).
//
// Adapters (Deepgram, OpenAI, ElevenLabs, …) implement this so the API routes
// never import a vendor directly. The browser WebSpeech fallback lives client
// side (see src/lib/voice/voice.ts) and kicks in when no server provider is set.

export interface TTSResult {
  /** Audio bytes as a stream so the client can start playback on first chunk. */
  stream: ReadableStream<Uint8Array>;
  /** MIME type of the audio, e.g. "audio/mpeg". */
  contentType: string;
}

export interface TTSOptions {
  /** Provider-specific voice/model id. Falls back to the provider default. */
  voice?: string;
}

export interface VoiceProvider {
  readonly name: string;
  readonly canTTS: boolean;
  readonly canSTT: boolean;
  /** Synthesize speech for `text`. Throws if the provider can't TTS. */
  tts(text: string, opts?: TTSOptions): Promise<TTSResult>;
  /** Transcribe `audio` (raw bytes). Throws if the provider can't STT. */
  stt(audio: ArrayBuffer, contentType: string): Promise<string>;
}

/** Max characters per TTS request (most providers cap this). */
export const TTS_CHAR_LIMIT = 1800;
