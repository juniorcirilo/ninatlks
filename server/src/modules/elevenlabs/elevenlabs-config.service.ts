import { Injectable, Scope } from '@nestjs/common';
import { SecretsService } from '../secrets/secrets.service';
import {
  ElevenLabsError,
  ElevenLabsCredentials,
} from './elevenlabs-client.service';

/** Ported from resolveCredentialsForAccount (Vault → env fallback). */
@Injectable({ scope: Scope.REQUEST })
export class ElevenLabsConfigService {
  constructor(private readonly secrets: SecretsService) {}

  async loadAccountCreds(accountId: string): Promise<ElevenLabsCredentials> {
    const key =
      (await this.secrets.getInternal(accountId, 'elevenlabs', 'api_key')) ||
      process.env.ELEVENLABS_API_KEY ||
      '';
    if (!key) {
      throw new ElevenLabsError(
        503,
        'ElevenLabs API key não configurada para esta conta. Vá em Configurações → Integrações.',
      );
    }
    return { apiKey: key };
  }
}
