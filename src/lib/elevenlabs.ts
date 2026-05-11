import { supabase } from "@/integrations/supabase/client";

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

export async function fetchVoicesAndQuota(): Promise<VoicesAndSubscription> {
  // Supabase client's `invoke` ignores `method: "GET"` and sends POST, which
  // elevenlabs-voices rejects with 405. Use fetch directly so we control the
  // verb. Also bubbles up the real status code instead of the generic
  // "Failed to send a request to the Edge Function" message.
  const sess = await supabase.auth.getSession();
  const token = sess.data.session?.access_token;
  if (!token) throw new Error("Você precisa estar logado");
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-voices?include=voices,subscription`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j.error ?? text;
    } catch {
      /* plain text */
    }
    throw new Error(`${res.status}: ${msg.slice(0, 200)}`);
  }
  return (await res.json()) as VoicesAndSubscription;
}

export async function previewVoice(input: {
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
}): Promise<Blob> {
  const sess = await supabase.auth.getSession();
  const token = sess.data.session?.access_token;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-preview`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: token ? `Bearer ${token}` : "",
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
    },
    body: JSON.stringify({
      text: input.text,
      voice_id: input.voiceId,
      voice_settings: input.voiceSettings,
      model_id: input.modelId,
      language_code: input.languageCode,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`preview failed: ${resp.status} ${txt.slice(0, 200)}`);
  }
  return resp.blob();
}

export async function updateVoiceSettings(
  voiceId: string,
  settings: {
    stability: number;
    similarity_boost: number;
    style: number;
    use_speaker_boost: boolean;
  },
) {
  const { data, error } = await supabase.functions.invoke("elevenlabs-voices", {
    method: "PATCH" as any,
    body: { voice_id: voiceId, settings },
  });
  if (error) throw error;
  return data;
}

export async function deleteVoice(voiceId: string) {
  const { data, error } = await supabase.functions.invoke("elevenlabs-voices", {
    method: "DELETE" as any,
    body: { voice_id: voiceId },
  });
  if (error) throw error;
  return data;
}
