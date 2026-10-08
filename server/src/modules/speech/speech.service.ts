import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface Transcription {
  text: string;
  language?: string;
  duration?: number;
}

/**
 * Cliente do serviço próprio de STT/TTS (/srv/containers/tts-stt:
 * faster-whisper + Piper, API compatível com a da OpenAI). Sem `STT_URL`
 * o recurso fica desligado e as chamadas devolvem null.
 */
@Injectable()
export class SpeechService {
  private readonly logger = new Logger(SpeechService.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string | null {
    return this.config.get<string>('STT_URL')?.replace(/\/$/, '') || null;
  }

  get enabled(): boolean {
    return !!this.baseUrl;
  }

  private headers(): Record<string, string> {
    const key = this.config.get<string>('STT_API_KEY');
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  /** Áudio → texto. null = recurso desligado, falha ou fala não reconhecida. */
  async transcribe(
    audio: Buffer,
    mime = 'audio/ogg',
    language?: string,
  ): Promise<Transcription | null> {
    if (!this.baseUrl) return null;
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: mime }),
      'audio',
    );
    const lang = language ?? this.config.get<string>('STT_LANGUAGE');
    if (lang) form.append('language', lang);
    try {
      const res = await fetch(`${this.baseUrl}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: this.headers(),
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const out = (await res.json()) as Transcription;
      return out.text?.trim() ? out : null;
    } catch (err) {
      this.logger.warn(`transcribe: ${(err as Error).message}`);
      return null;
    }
  }

  /** Texto → áudio ogg/opus (nota de voz). Lança erro se o serviço falhar. */
  async synthesize(text: string, voice?: string): Promise<Buffer> {
    if (!this.baseUrl) throw new Error('TTS não configurado (STT_URL)');
    const res = await fetch(`${this.baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({
        input: text,
        voice: voice || this.config.get<string>('TTS_VOICE') || undefined,
        response_format: 'opus',
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
