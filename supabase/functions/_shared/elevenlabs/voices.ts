// Voice library operations — list, get, preview, create (clone), delete.
// Reference: https://elevenlabs.io/docs/api-reference/voices

import { elevenRequest, type ElevenLabsCredentials } from "./client.ts";

export interface Voice {
  voice_id: string;
  name: string;
  category?: string;           // premade | cloned | generated
  labels?: Record<string, string>;
  preview_url?: string;
  settings?: VoiceSettings;
  description?: string;
  samples?: Array<{
    sample_id: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    hash: string;
  }>;
}

export interface VoiceSettings {
  stability?: number;           // 0..1
  similarity_boost?: number;    // 0..1
  style?: number;               // 0..1
  use_speaker_boost?: boolean;
}

export const DEFAULT_VOICE_SETTINGS: Required<VoiceSettings> = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
};

export async function listVoices(creds: ElevenLabsCredentials): Promise<Voice[]> {
  const resp = await elevenRequest<{ voices: Voice[] }>({
    method: "GET",
    path: "/v1/voices",
    credentials: creds,
  });
  return resp.voices ?? [];
}

export async function getVoice(creds: ElevenLabsCredentials, voiceId: string): Promise<Voice> {
  return elevenRequest<Voice>({
    method: "GET",
    path: `/v1/voices/${voiceId}`,
    credentials: creds,
  });
}

export async function getVoiceSettings(
  creds: ElevenLabsCredentials,
  voiceId: string,
): Promise<VoiceSettings> {
  return elevenRequest<VoiceSettings>({
    method: "GET",
    path: `/v1/voices/${voiceId}/settings`,
    credentials: creds,
  });
}

export async function updateVoiceSettings(
  creds: ElevenLabsCredentials,
  voiceId: string,
  settings: VoiceSettings,
): Promise<{ status: string }> {
  return elevenRequest({
    method: "POST",
    path: `/v1/voices/${voiceId}/settings/edit`,
    credentials: creds,
    json: settings,
  });
}

export async function deleteVoice(
  creds: ElevenLabsCredentials,
  voiceId: string,
): Promise<void> {
  await elevenRequest({
    method: "DELETE",
    path: `/v1/voices/${voiceId}`,
    credentials: creds,
  });
}

/**
 * Create a voice clone from one or more audio samples (Blob per sample).
 */
export async function createVoiceClone(
  creds: ElevenLabsCredentials,
  params: {
    name: string;
    description?: string;
    samples: Array<{ filename: string; blob: Blob }>;
    labels?: Record<string, string>;
  },
): Promise<{ voice_id: string }> {
  const fd = new FormData();
  fd.set("name", params.name);
  if (params.description) fd.set("description", params.description);
  if (params.labels) fd.set("labels", JSON.stringify(params.labels));
  for (const s of params.samples) {
    fd.append("files", s.blob, s.filename);
  }
  return elevenRequest({
    method: "POST",
    path: "/v1/voices/add",
    credentials: creds,
    form: fd,
  });
}

/**
 * Add a sample to an existing cloned voice (training reinforcement).
 */
export async function addSampleToVoice(
  creds: ElevenLabsCredentials,
  voiceId: string,
  sample: { filename: string; blob: Blob },
): Promise<void> {
  const fd = new FormData();
  fd.append("files", sample.blob, sample.filename);
  await elevenRequest({
    method: "POST",
    path: `/v1/voices/${voiceId}/samples`,
    credentials: creds,
    form: fd,
  });
}

export async function deleteSample(
  creds: ElevenLabsCredentials,
  voiceId: string,
  sampleId: string,
): Promise<void> {
  await elevenRequest({
    method: "DELETE",
    path: `/v1/voices/${voiceId}/samples/${sampleId}`,
    credentials: creds,
  });
}
