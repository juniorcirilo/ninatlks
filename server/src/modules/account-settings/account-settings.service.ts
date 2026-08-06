import { Injectable, Scope } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { Accounts } from '../../database/entities/accounts/accounts.entity';
import { AccountUsers } from '../../database/entities/accounts/account_users.entity';
import { Inboxes } from '../../database/entities/voice/inboxes.entity';

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type HourRange = [number, number] | null;

export interface DialingSettings {
  timezone: string;
  allowed_hours_local: Record<DayKey, HourRange>;
  max_attempts_per_day: number;
  min_minutes_between_attempts: number;
  /** Números (E.164) isentos de janela/limite diário/intervalo — só pra teste, nunca pula DNC. */
  test_numbers: string[];
}

export const DEFAULT_DIALING_SETTINGS: DialingSettings = {
  timezone: 'America/Sao_Paulo',
  allowed_hours_local: {
    mon: [9, 18],
    tue: [9, 18],
    wed: [9, 18],
    thu: [9, 18],
    fri: [9, 18],
    sat: null,
    sun: null,
  },
  max_attempts_per_day: 3,
  min_minutes_between_attempts: 60,
  test_numbers: [],
};

const AVAIL_ENUM_MAP: Record<0 | 1 | 2, 'offline' | 'online' | 'busy'> = {
  0: 'offline',
  1: 'online',
  2: 'busy',
};
const AVAIL_REVERSE: Record<string, 0 | 1 | 2> = {
  offline: 0,
  online: 1,
  busy: 2,
};

@Injectable({ scope: Scope.REQUEST })
export class AccountSettingsService {
  constructor(private readonly tx: TenantTxHost) {}

  async fetchAccount(accountId: string) {
    return this.tx.manager.findOne(Accounts, {
      where: { id: accountId },
      select: {
        id: true,
        name: true,
        supportEmail: true,
        internalAttributes: true,
        dialingSettings: true,
        featureFlags: true,
      },
    });
  }

  async updateAccountSettings(
    accountId: string,
    patch: { name?: string; supportEmail?: string },
  ): Promise<void> {
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.supportEmail !== undefined)
      update.supportEmail = patch.supportEmail;
    if (Object.keys(update).length === 0) return;
    await this.tx.manager
      .createQueryBuilder()
      .update(Accounts)
      .set(update)
      .where('id = :accountId', { accountId })
      .execute();
  }

  async fetchDialingSettings(accountId: string): Promise<DialingSettings> {
    const account = await this.tx.manager.findOne(Accounts, {
      where: { id: accountId },
      select: { dialingSettings: true },
    });
    const raw = (account?.dialingSettings ?? {}) as Partial<DialingSettings>;
    return {
      ...DEFAULT_DIALING_SETTINGS,
      ...raw,
      allowed_hours_local: {
        ...DEFAULT_DIALING_SETTINGS.allowed_hours_local,
        ...(raw.allowed_hours_local ?? {}),
      },
    };
  }

  async updateDialingSettings(
    accountId: string,
    next: DialingSettings,
  ): Promise<void> {
    // O dispatcher de campanha (voice-campaign-dispatch.processor.ts) não lê
    // dialing_settings — ele lê internal_attributes.compliance.test_numbers.
    // Sem esse espelhamento, um número marcado como teste aqui segue sendo
    // bloqueado normalmente nas campanhas.
    const account = await this.tx.manager.findOne(Accounts, {
      where: { id: accountId },
      select: { internalAttributes: true },
    });
    const attrs = account?.internalAttributes ?? {};
    const compliance = (attrs.compliance ?? {}) as Record<string, unknown>;
    const nextInternalAttributes = {
      ...attrs,
      compliance: { ...compliance, test_numbers: next.test_numbers },
    };

    await this.tx.manager
      .createQueryBuilder()
      .update(Accounts)
      .set({
        dialingSettings: next,
        internalAttributes: nextInternalAttributes,
      } as Record<string, unknown>)
      .where('id = :accountId', { accountId })
      .execute();
  }

  async ensureWebhookSecret(accountId: string): Promise<string> {
    const account = await this.tx.manager.findOne(Accounts, {
      where: { id: accountId },
      select: { internalAttributes: true },
    });
    const attrs = account?.internalAttributes ?? {};
    const existing =
      typeof attrs.webhookSecret === 'string' ? attrs.webhookSecret : null;
    if (existing && existing.length >= 32) return existing;

    const secret = randomBytes(32).toString('hex');
    const next = { ...attrs, webhookSecret: secret };
    await this.tx.manager
      .createQueryBuilder()
      .update(Accounts)
      .set({ internalAttributes: next })
      .where('id = :accountId', { accountId })
      .execute();
    return secret;
  }

  async setMyAvailability(
    accountId: string,
    userId: string,
    availability: 0 | 1 | 2,
  ): Promise<void> {
    await this.tx.manager
      .createQueryBuilder()
      .update(AccountUsers)
      .set({ availability: AVAIL_ENUM_MAP[availability], activeAt: new Date() })
      .where('account_id = :accountId AND user_id = :userId', {
        accountId,
        userId,
      })
      .execute();
  }

  async getMyAvailability(
    accountId: string,
    userId: string,
  ): Promise<0 | 1 | 2> {
    const row = await this.tx.manager.findOne(AccountUsers, {
      where: { accountId, userId },
      select: { availability: true },
    });
    if (!row) return 0;
    return AVAIL_REVERSE[row.availability] ?? 0;
  }

  async listInboxes(accountId: string) {
    return this.tx.manager.find(Inboxes, {
      where: { accountId },
      select: { id: true, name: true, channelType: true },
      order: { name: 'ASC' },
    });
  }
}
