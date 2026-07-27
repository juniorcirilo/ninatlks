import { apiClient, ApiError } from "@/lib/api-client";

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  preview_url?: string;
  labels?: Record<string, string>;
  description?: string;
}

export interface ElevenSubscription {
  tier: string;
  character_count: number;
  character_limit: number;
  voice_limit: number;
  voice_slots_used?: number;
  next_character_count_reset_unix: number;
  can_use_instant_voice_cloning: boolean;
  status: string;
}

export interface VoicesAndSubscription {
  voices: ElevenLabsVoice[];
  subscription: ElevenSubscription;
}

export async function fetchVoicesAndQuota(accountId: string): Promise<VoicesAndSubscription> {
  return apiClient.get<VoicesAndSubscription>(
    `/accounts/${accountId}/elevenlabs/voices?include=voices,subscription`,
  );
}

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export async function previewVoice(
  accountId: string,
  input: {
    text: string;
    voiceId: string;
    voiceSettings?: {
      stability?: number;
      similarity_boost?: number;
      style?: number;
      use_speaker_boost?: boolean;
    };
    modelId?: string;
    languageCode?: string;
  },
): Promise<Blob> {
  const res = await fetch(`${API_URL}/accounts/${accountId}/elevenlabs/preview`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: input.text,
      voiceId: input.voiceId,
      voiceSettings: input.voiceSettings,
      modelId: input.modelId,
      languageCode: input.languageCode,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.message ?? `preview failed: ${res.status}`, body);
  }
  return res.blob();
}

export async function updateVoiceSettings(
  accountId: string,
  voiceId: string,
  settings: {
    stability: number;
    similarity_boost: number;
    style: number;
    use_speaker_boost: boolean;
  },
) {
  return apiClient.patch(`/accounts/${accountId}/elevenlabs/voices/${voiceId}/settings`, settings);
}

export async function deleteVoice(accountId: string, voiceId: string) {
  return apiClient.delete(`/accounts/${accountId}/elevenlabs/voices/${voiceId}`);
}
