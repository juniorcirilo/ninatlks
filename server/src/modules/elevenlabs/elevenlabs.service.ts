import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { AgentPersonas } from '../../database/entities/personas/agent_personas.entity';
import { ElevenLabsConfigService } from './elevenlabs-config.service';
import {
  ElevenLabsVoicesService,
  Voice,
  SubscriptionInfo,
  VoiceSettings,
} from './elevenlabs-voices.service';

const MAX_PREVIEW_CHARS = 500;

/** Ported from supabase/functions/elevenlabs-{voices,preview}. */
@Injectable({ scope: Scope.REQUEST })
export class ElevenLabsService {
  constructor(
    private readonly tx: TenantTxHost,
    private readonly config: ElevenLabsConfigService,
    private readonly voices: ElevenLabsVoicesService,
  ) {}

  async listVoicesAndSubscription(
    accountId: string,
    include: string,
  ): Promise<{ voices?: Voice[]; subscription?: SubscriptionInfo }> {
    const creds = await this.config.loadAccountCreds(accountId);
    const out: { voices?: Voice[]; subscription?: SubscriptionInfo } = {};
    if (include.includes('voices'))
      out.voices = await this.voices.listVoices(creds);
    if (include.includes('subscription'))
      out.subscription = await this.voices.getSubscription(creds);
    return out;
  }

  async updateVoiceSettings(
    accountId: string,
    voiceId: string,
    settings: VoiceSettings,
  ) {
    const creds = await this.config.loadAccountCreds(accountId);
    return this.voices.updateVoiceSettings(creds, voiceId, settings);
  }

  /** Admin-only at the controller (RolesGuard) — also scrubs the voice from any persona referencing it. */
  async deleteVoice(accountId: string, voiceId: string) {
    const creds = await this.config.loadAccountCreds(accountId);
    await this.voices.deleteVoice(creds, voiceId);
    await this.tx.manager
      .createQueryBuilder()
      .update(AgentPersonas)
      .set({ voiceCloneId: null, voiceProvider: null })
      .where('voice_clone_id = :voiceId AND account_id = :accountId', {
        voiceId,
        accountId,
      })
      .execute();
    return { deleted: voiceId };
  }

  async preview(
    accountId: string,
    input: {
      text: string;
      voiceId: string;
      voiceSettings?: VoiceSettings;
      modelId?: string;
      languageCode?: string;
    },
  ): Promise<Buffer> {
    const text = input.text.slice(0, MAX_PREVIEW_CHARS).trim();
    const creds = await this.config.loadAccountCreds(accountId);
    const buf = await this.voices.synthesize(creds, {
      voiceId: input.voiceId,
      text,
      voiceSettings: input.voiceSettings,
      outputFormat: 'mp3_44100_128',
      modelId: input.modelId,
      languageCode: input.languageCode,
    });

    await this.tx.manager.query(
      `INSERT INTO public.elevenlabs_usage_log (account_id, voice_id, character_count, model_id, purpose)
       VALUES ($1, $2, $3, $4, 'preview')`,
      [
        accountId,
        input.voiceId,
        text.length,
        input.modelId ?? 'eleven_multilingual_v2',
      ],
    );

    return buf;
  }
}
