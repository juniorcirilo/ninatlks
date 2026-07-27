import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { PhoneNumbers } from '../../database/entities/voice/phone_numbers.entity';
import {
  CreatePhoneNumberDto,
  UpdatePhoneNumberDto,
} from './dto/phone-number.dto';

/** Ported from src/lib/voice.ts's phone_numbers CRUD helpers. */
@Injectable({ scope: Scope.REQUEST })
export class PhoneNumbersService {
  constructor(private readonly tx: TenantTxHost) {}

  async list(accountId: string): Promise<PhoneNumbers[]> {
    return this.tx.manager.find(PhoneNumbers, {
      where: { accountId },
      order: { createdAt: 'DESC' },
    });
  }

  async create(
    accountId: string,
    dto: CreatePhoneNumberDto,
  ): Promise<PhoneNumbers> {
    const entity = this.tx.manager.create(PhoneNumbers, {
      accountId,
      e164: dto.e164,
      friendlyName: dto.friendlyName ?? null,
      inboxId: dto.inboxId ?? null,
      pinnedPersonaId: dto.pinnedPersonaId ?? null,
      inboundBehavior: dto.inboundBehavior ?? 'ai_answer',
    });
    return this.tx.manager.save(PhoneNumbers, entity);
  }

  async update(
    id: string,
    dto: UpdatePhoneNumberDto,
  ): Promise<PhoneNumbers | null> {
    const updates: Record<string, unknown> = {};
    if (dto.friendlyName !== undefined) updates.friendlyName = dto.friendlyName;
    if (dto.inboxId !== undefined) updates.inboxId = dto.inboxId;
    if (dto.pinnedPersonaId !== undefined)
      updates.pinnedPersonaId = dto.pinnedPersonaId;
    if (dto.inboundBehavior !== undefined)
      updates.inboundBehavior = dto.inboundBehavior;
    if (dto.outboundEnabled !== undefined)
      updates.outboundEnabled = dto.outboundEnabled;
    if (dto.enabled !== undefined) updates.enabled = dto.enabled;

    await this.tx.manager.update(PhoneNumbers, { id }, updates);
    return this.tx.manager.findOne(PhoneNumbers, { where: { id } });
  }

  async remove(id: string): Promise<void> {
    await this.tx.manager.delete(PhoneNumbers, { id });
  }

  /** Used to route outbound dialing between the Twilio-direct and EL-native paths. */
  async hasElevenLabsRouting(accountId: string, id: string): Promise<boolean> {
    const row = await this.tx.manager.findOne(PhoneNumbers, {
      where: { accountId, id },
      select: { elevenlabsPhoneNumberId: true },
    });
    return !!row?.elevenlabsPhoneNumberId;
  }
}
