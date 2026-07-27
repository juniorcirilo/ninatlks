import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { ElevenLabsClientService } from '../elevenlabs/elevenlabs-client.service';
import { ElevenLabsConfigService } from '../elevenlabs/elevenlabs-config.service';

/**
 * Ported from supabase/functions/voice-clone/index.ts. Instant Voice Clone
 * via ElevenLabs, gated by the account's voice_clone_enabled feature flag.
 * Admin-only (enforced at controller level via RolesGuard).
 */
@Injectable({ scope: Scope.REQUEST })
export class VoiceCloneService {
  constructor(
    private readonly tx: TenantTxHost,
    private readonly elConfig: ElevenLabsConfigService,
    private readonly elClient: ElevenLabsClientService,
  ) {}

  async clone(
    accountId: string,
    personaId: string,
    file: { audioBase64: string; filename: string; mimeType: string },
  ): Promise<{ voiceId: string; personaId: string; provider: string }> {
    const personaRows = await this.tx.manager.query<
      { id: string; name: string }[]
    >(
      `SELECT id, name FROM agent_personas WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [personaId, accountId],
    );
    const persona = personaRows[0];
    if (!persona) throw new NotFoundException('persona not found');

    const accRows = await this.tx.manager.query<
      { feature_flags: Record<string, unknown> }[]
    >(`SELECT feature_flags FROM accounts WHERE id = $1 LIMIT 1`, [accountId]);
    if (accRows[0]?.feature_flags?.voice_clone_enabled !== true) {
      throw new ForbiddenException(
        'Voice clone está desativado nesta conta. Ative a flag voice_clone_enabled.',
      );
    }

    const creds = await this.elConfig.loadAccountCreds(accountId);

    const buffer = Buffer.from(file.audioBase64, 'base64');
    const form = new FormData();
    form.append(
      'name',
      `${persona.name} (Nexus persona ${persona.id.slice(0, 8)})`,
    );
    form.append('description', `Voice clone for Nexus persona ${persona.id}`);
    form.append(
      'files',
      new Blob([new Uint8Array(buffer)], {
        type: file.mimeType || 'audio/mpeg',
      }),
      file.filename || 'sample.mp3',
    );

    // ElevenLabsError propagates as-is — ProviderErrorFilter maps it to the
    // right HTTP status.
    const result = await this.elClient.request<{ voice_id: string }>({
      method: 'POST',
      path: '/v1/voices/add',
      credentials: creds,
      form,
    });

    await this.tx.manager.query(
      `UPDATE agent_personas SET voice_provider = 'elevenlabs', voice_clone_id = $2, updated_at = now()
       WHERE id = $1`,
      [persona.id, result.voice_id],
    );

    return {
      voiceId: result.voice_id,
      personaId: persona.id,
      provider: 'elevenlabs',
    };
  }
}
