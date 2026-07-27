import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { VoiceCalls } from '../../database/entities/voice/voice_calls.entity';

/**
 * Raw voice_calls reads (no join) — ported from src/lib/voice.ts's
 * fetchVoiceCalls/fetchVoiceCall (`select("*")`), distinct from
 * modules/calls/CallsService which joins in the contact name for the
 * calls-history page.
 */
@Injectable({ scope: Scope.REQUEST })
export class VoiceCallsService {
  constructor(private readonly tx: TenantTxHost) {}

  async list(accountId: string, limit = 50): Promise<VoiceCalls[]> {
    return this.tx.manager.find(VoiceCalls, {
      where: { accountId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async get(accountId: string, id: string): Promise<VoiceCalls | null> {
    return this.tx.manager.findOne(VoiceCalls, { where: { accountId, id } });
  }
}
