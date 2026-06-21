"use client";

let current: HTMLAudioElement | null = null;

const TTS_MIME = "audio/mpeg";

/**
 * Fetch Deepgram TTS for `text` and return an <audio> element that is already playing.
 * Streams the audio through MediaSource so playback begins on the first chunk instead of
 * waiting for the whole file to download (this is what removed the answer lag). Falls back
 * to buffered blob playback when MediaSource/MP3 streaming isn't supported.
 */
export async function speak(text: string): Promise<HTMLAudioElement> {
  stopSpeaking();
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`TTS failed (${res.status})`);

  const canStream =
    typeof MediaSource !== "undefined" &&
    MediaSource.isTypeSupported(TTS_MIME) &&
    !!res.body;

  if (canStream) {
    try {
      return streamSpeech(res.body as ReadableStream<Uint8Array>);
    } catch {
      /* fall through to buffered playback */
    }
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
  current = audio;
  await audio.play().catch(() => {});
  return audio;
}

/** Progressively append streamed audio chunks to a MediaSource and start playing at once. */
function streamSpeech(stream: ReadableStream<Uint8Array>): HTMLAudioElement {
  const mediaSource = new MediaSource();
  const url = URL.createObjectURL(mediaSource);
  const audio = new Audio();
  audio.src = url;
  current = audio;
  audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });

  mediaSource.addEventListener("sourceopen", () => {
    let sb: SourceBuffer;
    try {
      sb = mediaSource.addSourceBuffer(TTS_MIME);
    } catch {
      return;
    }
    const reader = stream.getReader();
    let finished = false;

    const endStream = () => {
      try {
        if (mediaSource.readyState === "open") mediaSource.endOfStream();
      } catch {
        /* ignore */
      }
    };

    const pump = (): void => {
      if (finished || sb.updating) return;
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            finished = true;
            if (!sb.updating) endStream();
            return;
          }
          if (value) sb.appendBuffer(value as unknown as BufferSource);
          else pump();
        })
        .catch(() => {
          finished = true;
          endStream();
        });
    };

    sb.addEventListener("updateend", () => {
      if (finished) endStream();
      else pump();
    });
    pump();
  });

  audio.play().catch(() => {});
  return audio;
}

export function stopSpeaking() {
  if (current) {
    current.pause();
    current.currentTime = 0;
    current = null;
  }
}

/** Push-to-talk recorder using MediaRecorder. */
export class PushToTalk {
  private rec?: MediaRecorder;
  private chunks: Blob[] = [];
  private stream?: MediaStream;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec.start();
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const rec = this.rec;
      if (!rec) return resolve(new Blob());
      rec.onstop = () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        resolve(new Blob(this.chunks, { type: rec.mimeType || "audio/webm" }));
      };
      rec.stop();
    });
  }
}

export interface VoiceListenerHandlers {
  /** Fired once the user is confirmed to be speaking (use this to interrupt Tiru). */
  onSpeechStart?: () => void;
  /** Fired with the recorded utterance once the user goes quiet. */
  onResult?: (blob: Blob) => void;
  onError?: (err: unknown) => void;
}

export interface VoiceListenerConfig {
  /** RMS level (0..1) above which audio counts as speech. */
  threshold?: number;
  /** Sustained loud time (ms) required before a barge-in is confirmed. */
  speechMinMs?: number;
  /** Sustained quiet time (ms) after speech that ends the utterance. */
  silenceMs?: number;
}

/**
 * Hands-free barge-in listener. Keeps the mic open and watches the input level
 * with an AnalyserNode. When the user starts talking it fires `onSpeechStart`
 * (so the caller can stop Tiru), records until they go quiet, then hands the
 * clip back via `onResult`. Browser echo-cancellation keeps Tiru's own voice
 * from triggering it.
 */
export class VoiceListener {
  private stream?: MediaStream;
  private ctx?: AudioContext;
  private analyser?: AnalyserNode;
  private source?: MediaStreamAudioSourceNode;
  private rec?: MediaRecorder;
  private chunks: Blob[] = [];
  private data: Uint8Array = new Uint8Array(0);
  private raf = 0;
  private running = false;
  private enabled = false;
  private speaking = false;
  private loudSince = 0;
  private quietSince = 0;
  private readonly cfg: Required<VoiceListenerConfig>;

  constructor(private readonly handlers: VoiceListenerHandlers, config: VoiceListenerConfig = {}) {
    this.cfg = {
      threshold: config.threshold ?? 0.06,
      speechMinMs: config.speechMinMs ?? 180,
      silenceMs: config.silenceMs ?? 800,
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const Ctx: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    await this.ctx.resume().catch(() => {});
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser);
    this.data = new Uint8Array(this.analyser.fftSize);
    this.running = true;
    this.loop();
  }

  /** Toggle whether new utterances are detected. Does not tear down the mic. */
  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) this.loudSince = 0;
  }

  /** Force the current utterance to end now (e.g. a manual "done" button). */
  endUtterance(): void {
    if (this.speaking) this.finishUtterance();
  }

  private rms(): number {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.data as unknown as Uint8Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.data.length);
  }

  private startRec(): void {
    if (!this.stream) return;
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec.start();
  }

  private finishUtterance(): void {
    this.speaking = false;
    this.quietSince = 0;
    this.loudSince = 0;
    const rec = this.rec;
    if (!rec || rec.state === "inactive") {
      this.handlers.onResult?.(new Blob());
      return;
    }
    rec.onstop = () => this.handlers.onResult?.(new Blob(this.chunks, { type: rec.mimeType || "audio/webm" }));
    try {
      rec.stop();
    } catch {
      this.handlers.onResult?.(new Blob());
    }
  }

  private loop = (): void => {
    if (!this.running) return;
    const now = performance.now();
    const loud = this.rms() > this.cfg.threshold;

    if (!this.speaking) {
      if (this.enabled && loud) {
        if (!this.loudSince) this.loudSince = now;
        if (now - this.loudSince >= this.cfg.speechMinMs) {
          this.speaking = true;
          this.quietSince = 0;
          this.startRec();
          this.handlers.onSpeechStart?.();
        }
      } else {
        this.loudSince = 0;
      }
    } else if (loud) {
      this.quietSince = 0;
    } else {
      if (!this.quietSince) this.quietSince = now;
      if (now - this.quietSince >= this.cfg.silenceMs) this.finishUtterance();
    }

    this.raf = requestAnimationFrame(this.loop);
  };

  stop(): void {
    this.running = false;
    this.enabled = false;
    this.speaking = false;
    cancelAnimationFrame(this.raf);
    try {
      if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    } catch {
      /* ignore */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = undefined;
    this.ctx = undefined;
    this.analyser = undefined;
    this.source = undefined;
    this.rec = undefined;
  }
}

export async function transcribe(blob: Blob): Promise<string> {
  const res = await fetch("/api/stt", {
    method: "POST",
    headers: { "Content-Type": blob.type || "audio/webm" },
    body: blob,
  });
  if (!res.ok) throw new Error(`STT failed (${res.status})`);
  const json = await res.json();
  return (json?.transcript ?? "").trim();
}
