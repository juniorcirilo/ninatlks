import { Injectable } from '@nestjs/common';
import {
  ElevenLabsClientService,
  ElevenLabsCredentials,
} from './elevenlabs-client.service';

export interface VoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
}

export interface Voice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
  settings?: VoiceSettings;
  description?: string;
}

export interface SubscriptionInfo {
  tier: string;
  character_count: number;
  character_limit: number;
  voice_limit: number;
  voice_slots_used?: number;
  next_character_count_reset_unix: number;
  can_use_instant_voice_cloning: boolean;
  status: string;
}

/** Ported from supabase/functions/_shared/elevenlabs/{voices,usage}.ts. */
@Injectable()
export class ElevenLabsVoicesService {
  constructor(private readonly client: ElevenLabsClientService) {}

  async listVoices(credentials: ElevenLabsCredentials): Promise<Voice[]> {
    const resp = await this.client.request<{ voices: Voice[] }>({
      method: 'GET',
      path: '/v1/voices',
      credentials,
    });
    return resp.voices ?? [];
  }

  async getSubscription(
    credentials: ElevenLabsCredentials,
  ): Promise<SubscriptionInfo> {
    return this.client.request<SubscriptionInfo>({
      method: 'GET',
      path: '/v1/user/subscription',
      credentials,
    });
  }

  async updateVoiceSettings(
    credentials: ElevenLabsCredentials,
    voiceId: string,
    settings: VoiceSettings,
  ): Promise<{ status: string }> {
    return this.client.request({
      method: 'POST',
      path: `/v1/voices/${voiceId}/settings/edit`,
      credentials,
      json: settings,
    });
  }

  async deleteVoice(
    credentials: ElevenLabsCredentials,
    voiceId: string,
  ): Promise<void> {
    await this.client.request({
      method: 'DELETE',
      path: `/v1/voices/${voiceId}`,
      credentials,
    });
  }

  async synthesize(
    credentials: ElevenLabsCredentials,
    opts: {
      voiceId: string;
      text: string;
      modelId?: string;
      outputFormat?: string;
      voiceSettings?: VoiceSettings;
      languageCode?: string;
    },
  ): Promise<Buffer> {
    const resp = await this.client.request<Response>({
      method: 'POST',
      path: `/v1/text-to-speech/${opts.voiceId}`,
      credentials,
      query: { output_format: opts.outputFormat ?? 'mp3_44100_128' },
      json: {
        text: opts.text,
        model_id: opts.modelId ?? 'eleven_multilingual_v2',
        voice_settings: opts.voiceSettings,
        language_code: opts.languageCode,
      },
      raw: true,
    });
    const arrayBuffer = await resp.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
