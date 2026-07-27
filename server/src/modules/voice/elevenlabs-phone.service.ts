import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import {
  ElevenLabsClientService,
  ElevenLabsError,
} from '../elevenlabs/elevenlabs-client.service';
import { ElevenLabsConfigService } from '../elevenlabs/elevenlabs-config.service';
import { TwilioConfigService } from '../twilio/twilio-config.service';

interface OwnedPhoneNumber {
  id: string;
  account_id: string;
  e164: string;
  friendly_name: string | null;
  pinned_persona_id: string | null;
  elevenlabs_phone_number_id: string | null;
  provider_config: Record<string, unknown>;
}

/**
 * Ported from supabase/functions/elevenlabs-phone-register/index.ts.
 * Registers a Twilio phone number with ElevenLabs's native Twilio
 * integration and assigns it to the pinned persona's synced EL agent —
 * after this, inbound+outbound for the number goes through EL's own
 * STT/LLM/TTS stack instead of our TwiML/ConversationRelay path.
 */
@Injectable({ scope: Scope.REQUEST })
export class ElevenLabsPhoneService {
  constructor(
    private readonly tx: TenantTxHost,
    private readonly elConfig: ElevenLabsConfigService,
    private readonly elClient: ElevenLabsClientService,
    private readonly twilioConfig: TwilioConfigService,
  ) {}

  async register(accountId: string, phoneNumberId: string) {
    const rows = await this.tx.manager.query<OwnedPhoneNumber[]>(
      `SELECT id, account_id, e164, friendly_name, pinned_persona_id,
              elevenlabs_phone_number_id, provider_config
         FROM phone_numbers WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [phoneNumberId, accountId],
    );
    const pn = rows[0];
    if (!pn) throw new NotFoundException('phone number not found');

    if (!pn.pinned_persona_id) {
      throw new BadRequestException('número precisa de uma persona pinada');
    }
    const personaRows = await this.tx.manager.query<
      { elevenlabs_agent_id: string | null }[]
    >(`SELECT elevenlabs_agent_id FROM agent_personas WHERE id = $1 LIMIT 1`, [
      pn.pinned_persona_id,
    ]);
    const agentId = personaRows[0]?.elevenlabs_agent_id ?? null;
    if (!agentId) {
      throw new BadRequestException(
        "pinned persona must have an ElevenLabs agent (click 'Sincronizar com EL' on the agent first)",
      );
    }

    const elCreds = await this.elConfig.loadAccountCreds(accountId);
    const twilioCreds = await this.twilioConfig.loadAccountCreds(accountId);
    if (!twilioCreds.authToken) {
      throw new BadRequestException(
        'Twilio Auth Token não configurado para esta conta',
      );
    }

    let elPhoneId = pn.elevenlabs_phone_number_id;
    if (!elPhoneId) {
      try {
        const created = await this.elClient.request<{
          phone_number_id: string;
        }>({
          method: 'POST',
          path: '/v1/convai/phone-numbers/create',
          credentials: elCreds,
          json: {
            phone_number: pn.e164,
            label: pn.friendly_name ?? `Nexus ${pn.e164}`,
            provider: 'twilio',
            sid: twilioCreds.accountSid,
            token: twilioCreds.authToken,
          },
        });
        elPhoneId = created.phone_number_id;
      } catch (err) {
        if (err instanceof ElevenLabsError) {
          throw new BadGatewayException(
            `EL phone create failed: ${err.message}`,
          );
        }
        throw err;
      }
    }

    try {
      await this.elClient.request({
        method: 'PATCH',
        path: `/v1/convai/phone-numbers/${elPhoneId}`,
        credentials: elCreds,
        json: { agent_id: agentId },
      });
    } catch (err) {
      if (err instanceof ElevenLabsError) {
        throw new BadGatewayException(`EL phone assign failed: ${err.message}`);
      }
      throw err;
    }

    const newConfig = {
      ...(pn.provider_config ?? {}),
      elevenlabs_phone_number_id: elPhoneId,
      elevenlabs_agent_id: agentId,
    };
    await this.tx.manager.query(
      `UPDATE phone_numbers SET elevenlabs_phone_number_id = $2, provider_config = $3::jsonb, updated_at = now()
       WHERE id = $1`,
      [pn.id, elPhoneId, JSON.stringify(newConfig)],
    );

    return {
      ok: true,
      phone_number_id: pn.id,
      elevenlabs_phone_number_id: elPhoneId,
      elevenlabs_agent_id: agentId,
    };
  }
}
