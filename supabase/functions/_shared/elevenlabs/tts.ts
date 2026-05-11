// Text-to-speech — non-streaming (buffered mp3) and streaming variants.

import { elevenRequest, type ElevenLabsCredentials } from "./client.ts";
import type { VoiceSettings } from "./voices.ts";

export type OutputFormat =
  | "mp3_22050_32"
  | "mp3_44100_32"
  | "mp3_44100_64"
  | "mp3_44100_96"
  | "mp3_44100_128"
  | "pcm_16000"
  | "pcm_22050"
  | "pcm_24000"
  | "pcm_44100"
  | "ulaw_8000";

export interface SynthOptions {
  voiceId: string;
  text: string;
  modelId?: string;                 // default eleven_multilingual_v2
  outputFormat?: OutputFormat;      // default mp3_44100_128
  voiceSettings?: VoiceSettings;
  languageCode?: string;            // force language for multilingual voices
  previousText?: string;            // conditioning for continuity
  nextText?: string;
  seed?: number;                    // deterministic output when supported
}

/**
 * Non-streaming: returns an mp3 (or whatever output_format asks for) as a Blob.
 * Good for preview buttons and short messages under ~1000 chars.
 */
export async function synthesize(
  creds: ElevenLabsCredentials,
  opts: SynthOptions,
): Promise<Blob> {
  const resp = (await elevenRequest({
    method: "POST",
    path: `/v1/text-to-speech/${opts.voiceId}`,
    credentials: creds,
    query: { output_format: opts.outputFormat ?? "mp3_44100_128" },
    json: {
      text: opts.text,
      model_id: opts.modelId ?? "eleven_multilingual_v2",
      voice_settings: opts.voiceSettings,
      language_code: opts.languageCode,
      previous_text: opts.previousText,
      next_text: opts.nextText,
      seed: opts.seed,
    },
    raw: true,
  })) as unknown as Response;
  return resp.blob();
}

/**
 * Streaming: returns a ReadableStream of audio bytes for real-time playback.
 * Used by voice-runtime for <800ms first-byte latency.
 */
export async function synthesizeStream(
  creds: ElevenLabsCredentials,
  opts: SynthOptions,
): Promise<ReadableStream<Uint8Array>> {
  const resp = (await elevenRequest({
    method: "POST",
    path: `/v1/text-to-speech/${opts.voiceId}/stream`,
    credentials: creds,
    query: { output_format: opts.outputFormat ?? "mp3_44100_128" },
    json: {
      text: opts.text,
      model_id: opts.modelId ?? "eleven_flash_v2_5",
      voice_settings: opts.voiceSettings,
      language_code: opts.languageCode,
      previous_text: opts.previousText,
      next_text: opts.nextText,
      seed: opts.seed,
    },
    raw: true,
  })) as unknown as Response;
  if (!resp.body) throw new Error("no response body for stream");
  return resp.body;
}
