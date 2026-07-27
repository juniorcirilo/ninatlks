import { Injectable, NotFoundException, Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { PhoneNumbers } from '../../database/entities/voice/phone_numbers.entity';
import { TwilioConfigService } from './twilio-config.service';
import {
  TwilioNumbersService,
  AvailableNumberQuery,
} from './twilio-numbers.service';
import { TwilioError } from './twilio-client.service';

/**
 * Ported from supabase/functions/twilio-numbers-{owned,search,buy,import}.
 * Admin-role authorization (spends money / rewires webhooks) is enforced by
 * RolesGuard('admin') at the controller — the originals checked this
 * manually via user_roles.
 */
@Injectable({ scope: Scope.REQUEST })
export class TwilioPhoneNumbersService {
  constructor(
    private readonly tx: TenantTxHost,
    private readonly twilioConfig: TwilioConfigService,
    private readonly twilioNumbers: TwilioNumbersService,
    private readonly config: ConfigService,
  ) {}

  private webhookUrls() {
    const base = this.config.get<string>('PUBLIC_API_URL')!.replace(/\/$/, '');
    return {
      voiceUrl: `${base}/webhooks/twilio/incoming`,
      smsUrl: `${base}/webhooks/twilio/sms-incoming`,
      statusCallback: `${base}/webhooks/twilio/status`,
    };
  }

  async listOwned(accountId: string) {
    const creds = await this.twilioConfig.loadAccountCreds(accountId);
    const numbers = await this.twilioNumbers.listOwnedNumbers(creds);

    const existing = await this.tx.manager.find(PhoneNumbers, {
      where: { accountId },
      select: { e164: true },
    });
    const importedSet = new Set(existing.map((r) => r.e164));

    return numbers.map((n) => ({
      sid: n.sid,
      phone_number: n.phone_number,
      friendly_name: n.friendly_name,
      capabilities: n.capabilities,
      already_imported: importedSet.has(n.phone_number),
    }));
  }

  async search(accountId: string, query: AvailableNumberQuery) {
    const creds = await this.twilioConfig.loadAccountCreds(accountId);
    const rows = await this.twilioNumbers.searchAvailableNumbers(creds, query);
    await this.logProvisioning(
      accountId,
      null,
      `search:${query.countryCode}/${query.type ?? 'Local'}`,
      'search',
      query,
      { count: rows.length, sample: rows.slice(0, 3) },
      200,
    );
    return rows;
  }

  async buy(
    accountId: string,
    input: {
      phoneNumber: string;
      friendlyName?: string;
      inboxId?: string | null;
      pinnedPersonaId?: string | null;
      inboundBehavior?: string;
      bundleSid?: string;
      addressSid?: string;
    },
  ) {
    const { voiceUrl, smsUrl, statusCallback } = this.webhookUrls();
    const creds = await this.twilioConfig.loadAccountCreds(accountId);

    let bought;
    try {
      bought = await this.twilioNumbers.buyNumber(creds, {
        phoneNumber: input.phoneNumber,
        friendlyName: input.friendlyName ?? `Nina Talks ${input.phoneNumber}`,
        voiceUrl,
        voiceMethod: 'POST',
        smsUrl,
        smsMethod: 'POST',
        statusCallback,
        bundleSid: input.bundleSid,
        addressSid: input.addressSid,
      });
    } catch (err) {
      await this.logProvisioning(
        accountId,
        null,
        input.phoneNumber,
        'buy',
        input,
        {
          error: err instanceof Error ? err.message : String(err),
        },
        err instanceof TwilioError ? err.status : 502,
      );
      throw err;
    }

    const phoneNumber = this.tx.manager.create(PhoneNumbers, {
      accountId,
      e164: bought.phoneNumber,
      friendlyName: bought.friendlyName,
      provider: 'twilio',
      providerConfig: {
        twilio_sid: bought.sid,
        capabilities: bought.capabilities,
        voice_url: voiceUrl,
        sms_url: smsUrl,
      },
      inboxId: input.inboxId ?? null,
      pinnedPersonaId: input.pinnedPersonaId ?? null,
      inboundBehavior: input.inboundBehavior ?? 'ai_answer',
      outboundEnabled: true,
      enabled: true,
    });

    let saved;
    try {
      saved = await this.tx.manager.save(PhoneNumbers, phoneNumber);
    } catch (err) {
      // Best-effort release to avoid paying for a number we can't track.
      await this.twilioNumbers
        .releaseNumber(creds, bought.sid)
        .catch(() => undefined);
      throw err;
    }

    await this.logProvisioning(
      accountId,
      saved.id,
      bought.phoneNumber,
      'buy',
      input,
      bought.raw,
      201,
    );
    return { phone_number: saved, twilio: bought };
  }

  async importExisting(
    accountId: string,
    input: {
      phoneNumber: string;
      pinnedPersonaId?: string | null;
      inboxId?: string | null;
      inboundBehavior?: string;
    },
  ) {
    const { voiceUrl, smsUrl, statusCallback } = this.webhookUrls();
    const creds = await this.twilioConfig.loadAccountCreds(accountId);

    const existing = await this.twilioNumbers.findOwnedNumberByE164(
      creds,
      input.phoneNumber,
    );
    if (!existing) {
      throw new NotFoundException(
        `Número ${input.phoneNumber} não encontrado na conta Twilio. Confere se comprou / tá ativo.`,
      );
    }

    const updated = await this.twilioNumbers.configureNumber(
      creds,
      existing.sid,
      {
        voiceUrl,
        voiceMethod: 'POST',
        smsUrl,
        smsMethod: 'POST',
        statusCallback,
      },
    );

    const existingRow = await this.tx.manager.findOne(PhoneNumbers, {
      where: { accountId, e164: input.phoneNumber },
    });

    const baseRow = {
      accountId,
      e164: updated.phone_number,
      friendlyName: updated.friendly_name ?? `Nina Talks ${input.phoneNumber}`,
      provider: 'twilio',
      providerConfig: {
        twilio_sid: updated.sid,
        capabilities: updated.capabilities,
        voice_url: voiceUrl,
        sms_url: smsUrl,
      },
      inboxId: input.inboxId ?? null,
      pinnedPersonaId: input.pinnedPersonaId ?? null,
      inboundBehavior: input.inboundBehavior ?? 'ai_answer',
      outboundEnabled: true,
      enabled: true,
    };

    let saved: PhoneNumbers;
    if (existingRow) {
      await this.tx.manager.update(
        PhoneNumbers,
        { id: existingRow.id },
        baseRow,
      );
      saved = { ...existingRow, ...baseRow };
    } else {
      const created = this.tx.manager.create(PhoneNumbers, baseRow);
      saved = await this.tx.manager.save(PhoneNumbers, created);
    }

    await this.logProvisioning(
      accountId,
      saved.id,
      updated.phone_number,
      'import',
      input,
      updated,
      200,
    );
    return { phone_number: saved, twilio: updated };
  }

  private async logProvisioning(
    accountId: string,
    phoneNumberId: string | null,
    e164: string,
    action: string,
    request: unknown,
    response: unknown,
    httpStatus: number,
  ): Promise<void> {
    await this.tx.manager.query(
      `INSERT INTO public.twilio_number_provisioning
         (account_id, phone_number_id, e164, action, request, response, http_status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
      [
        accountId,
        phoneNumberId,
        e164,
        action,
        JSON.stringify(request),
        JSON.stringify(response),
        httpStatus,
      ],
    );
  }
}
