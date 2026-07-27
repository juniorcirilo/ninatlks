import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';

export interface CampaignRow {
  id: string;
  name: string;
  status: string;
  campaign_kind: string | null;
  total_contacts: number;
  placed_count: number;
  connected_count: number;
  escalated_count: number;
  voicemail_count: number;
  failed_count: number;
  created_at: Date;
  scheduled_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
}

export interface CampaignDetailRow extends CampaignRow {
  opening_script: string | null;
  from_number: string;
}

export interface CampaignContactRow {
  id: string;
  to_number: string;
  status: string;
  attempts: number;
  last_attempt_at: Date | null;
  last_error: string | null;
  voice_call_id: string | null;
}

export interface ContactListRow {
  id: string;
  name: string;
  description: string | null;
  campaign_kind: string | null;
  is_dynamic: boolean;
  member_count: number;
  filters: Record<string, unknown>;
  created_at: Date;
}

export interface RetentionRuleRow {
  id: string;
  name: string;
  enabled: boolean;
  inactive_days: number;
  required_stage_id: string | null;
  required_tag_ids: string[];
  target_campaign_id: string | null;
  max_enrolls_per_run: number;
  last_run_at: Date | null;
  last_enrolled_count: number;
  created_at: Date;
}

export interface PersonaLite {
  id: string;
  name: string;
  voice_clone_id: string | null;
  status: string;
  enabled: boolean;
}

export interface PhoneNumberLite {
  id: string;
  e164: string;
  friendly_name: string | null;
  outbound_enabled: boolean;
  enabled: boolean;
}

const CAMPAIGN_COLUMNS = `id, name, status, campaign_kind, total_contacts, placed_count,
  connected_count, escalated_count, voicemail_count, failed_count, created_at,
  scheduled_at, started_at, finished_at`;

@Injectable({ scope: Scope.REQUEST })
export class CampaignsService {
  constructor(private readonly tx: TenantTxHost) {}

  async list(accountId: string): Promise<CampaignRow[]> {
    return this.tx.manager.query<CampaignRow[]>(
      `SELECT ${CAMPAIGN_COLUMNS}
       FROM public.voice_campaigns
       WHERE account_id = $1
       ORDER BY created_at DESC LIMIT 200`,
      [accountId],
    );
  }

  async get(accountId: string, id: string): Promise<CampaignDetailRow> {
    const rows = await this.tx.manager.query<CampaignDetailRow[]>(
      `SELECT ${CAMPAIGN_COLUMNS}, opening_script, from_number
       FROM public.voice_campaigns
       WHERE id = $1 AND account_id = $2`,
      [id, accountId],
    );
    if (!rows.length) throw new NotFoundException('campaign not found');
    return rows[0];
  }

  /** Ported from supabase/functions/voice-campaign-export. */
  async exportCsv(
    accountId: string,
    campaignId: string,
  ): Promise<{ filename: string; csv: string }> {
    const campaignRows = await this.tx.manager.query<
      { id: string; name: string }[]
    >(
      `SELECT id, name FROM voice_campaigns WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [campaignId, accountId],
    );
    const campaign = campaignRows[0];
    if (!campaign) throw new NotFoundException('campaign not found');

    const rows = await this.tx.manager.query<
      {
        phone_number: string;
        status: string;
        attempts: number;
        last_error: string | null;
        contact_name: string | null;
        contact_email: string | null;
        call_status: string | null;
        outcome_category: string | null;
        outcome_summary: string | null;
        outcome_confidence: number | null;
        duration_seconds: number | null;
        started_at: Date | null;
        ended_at: Date | null;
      }[]
    >(
      `SELECT vcc.phone_number, vcc.status, vcc.attempts, vcc.last_error,
              c.name AS contact_name, c.email AS contact_email,
              vc.status AS call_status, vc.outcome_category, vc.outcome_summary,
              vc.outcome_confidence, vc.duration_seconds, vc.started_at, vc.ended_at
       FROM voice_campaign_contacts vcc
       LEFT JOIN contacts c ON c.id = vcc.contact_id
       LEFT JOIN voice_calls vc ON vc.id = vcc.voice_call_id
       WHERE vcc.campaign_id = $1
       ORDER BY vcc.phone_number ASC`,
      [campaignId],
    );

    const header = [
      'phone_number',
      'contact_name',
      'contact_email',
      'campaign_status',
      'call_status',
      'outcome_category',
      'outcome_summary',
      'outcome_confidence',
      'duration_sec',
      'started_at',
      'ended_at',
      'attempts',
      'last_error',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.phone_number,
          r.contact_name,
          r.contact_email,
          r.status,
          r.call_status,
          r.outcome_category,
          r.outcome_summary,
          r.outcome_confidence,
          r.duration_seconds,
          r.started_at ? new Date(r.started_at).toISOString() : null,
          r.ended_at ? new Date(r.ended_at).toISOString() : null,
          r.attempts,
          r.last_error,
        ]
          .map((v) => this.csvEscape(v))
          .join(','),
      );
    }

    const slug = campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const date = new Date().toISOString().slice(0, 10);
    return {
      filename: `campanha-${slug}-${date}.csv`,
      csv: '﻿' + lines.join('\n'),
    };
  }

  private csvEscape(v: string | number | null): string {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  async listContacts(
    accountId: string,
    campaignId: string,
  ): Promise<CampaignContactRow[]> {
    return this.tx.manager.query<CampaignContactRow[]>(
      `SELECT id, to_number, status, attempts, last_attempt_at, last_error, voice_call_id
       FROM public.voice_campaign_contacts
       WHERE campaign_id = $1 AND account_id = $2
       ORDER BY id DESC LIMIT 500`,
      [campaignId, accountId],
    );
  }

  async updateStatus(
    accountId: string,
    id: string,
    status: string,
  ): Promise<void> {
    const setParts = ['status = $3'];
    if (status === 'running') setParts.push('started_at = now()');
    if (status === 'completed' || status === 'canceled')
      setParts.push('finished_at = now()');
    await this.tx.manager.query(
      `UPDATE public.voice_campaigns SET ${setParts.join(', ')}
       WHERE id = $1 AND account_id = $2`,
      [id, accountId, status],
    );
  }

  async listPersonas(accountId: string): Promise<PersonaLite[]> {
    return this.tx.manager.query<PersonaLite[]>(
      `SELECT id, name, voice_clone_id, status, enabled
       FROM public.agent_personas
       WHERE account_id = $1 AND enabled = true AND status IN ('active','draft','training')
       ORDER BY name`,
      [accountId],
    );
  }

  async listPhoneNumbers(accountId: string): Promise<PhoneNumberLite[]> {
    return this.tx.manager.query<PhoneNumberLite[]>(
      `SELECT id, e164, friendly_name, outbound_enabled, enabled
       FROM public.phone_numbers
       WHERE account_id = $1 AND enabled = true AND outbound_enabled = true
       ORDER BY e164`,
      [accountId],
    );
  }

  async listContactLists(accountId: string): Promise<ContactListRow[]> {
    return this.tx.manager.query<ContactListRow[]>(
      `SELECT id, name, description, campaign_kind, is_dynamic, member_count, filters, created_at
       FROM public.contact_lists
       WHERE account_id = $1
       ORDER BY created_at DESC`,
      [accountId],
    );
  }

  async create(
    accountId: string,
    dto: {
      name: string;
      campaignKind: string;
      listId: string;
      personaId: string;
      phoneId: string;
      openingScript?: string;
      maxConcurrent?: number;
      retryAttempts?: number;
      recordCall?: boolean;
    },
  ): Promise<{ id: string; contactCount: number }> {
    const personaRows = await this.tx.manager.query<
      { voice_clone_id: string | null }[]
    >(
      `SELECT voice_clone_id FROM public.agent_personas WHERE id = $1 AND account_id = $2`,
      [dto.personaId, accountId],
    );
    const phoneRows = await this.tx.manager.query<{ e164: string }[]>(
      `SELECT e164 FROM public.phone_numbers WHERE id = $1 AND account_id = $2`,
      [dto.phoneId, accountId],
    );
    if (!phoneRows.length)
      throw new NotFoundException('phone number not found');

    const campaignRows = await this.tx.manager.query<{ id: string }[]>(
      `INSERT INTO public.voice_campaigns
         (account_id, name, campaign_kind, status, mode, persona_id, voice_id, from_number,
          phone_number_id, opening_script, max_concurrent, retry_attempts, retry_delay_minutes,
          record_call, language_code, script_mode)
       VALUES ($1,$2,$3,'draft','conversational',$4,$5,$6,$7,$8,$9,$10,30,$11,'pt-BR','conversational')
       RETURNING id`,
      [
        accountId,
        dto.name,
        dto.campaignKind,
        dto.personaId,
        personaRows[0]?.voice_clone_id ?? null,
        phoneRows[0].e164,
        dto.phoneId,
        dto.openingScript ?? null,
        dto.maxConcurrent ?? 3,
        dto.retryAttempts ?? 1,
        dto.recordCall ?? true,
      ],
    );
    const campaignId = campaignRows[0].id;

    const memberRows = await this.tx.manager.query<
      { contact_id: string; phone_number: string }[]
    >(
      `SELECT clm.contact_id, c.phone_number
       FROM public.contact_list_members clm
       JOIN public.contacts c ON c.id = clm.contact_id
       WHERE clm.list_id = $1 AND clm.account_id = $2
         AND c.blocked = false AND c.phone_number IS NOT NULL`,
      [dto.listId, accountId],
    );

    if (!memberRows.length) {
      throw new BadRequestException('Nenhum contato válido na lista');
    }

    for (const m of memberRows) {
      await this.tx.manager.query(
        `INSERT INTO public.voice_campaign_contacts
           (account_id, campaign_id, contact_id, to_number, phone_number, status, variables)
         VALUES ($1,$2,$3,$4,$4,'queued','{}')`,
        [accountId, campaignId, m.contact_id, m.phone_number],
      );
    }

    await this.tx.manager.query(
      `UPDATE public.voice_campaigns SET total_contacts = $2 WHERE id = $1`,
      [campaignId, memberRows.length],
    );

    return { id: campaignId, contactCount: memberRows.length };
  }

  // ── Retention rules ──────────────────────────────────────────────
  async listRetentionRules(accountId: string): Promise<RetentionRuleRow[]> {
    return this.tx.manager.query<RetentionRuleRow[]>(
      `SELECT id, name, enabled, inactive_days, required_stage_id, required_tag_ids,
              target_campaign_id, max_enrolls_per_run, last_run_at, last_enrolled_count, created_at
       FROM public.retention_rules
       WHERE account_id = $1
       ORDER BY created_at DESC`,
      [accountId],
    );
  }

  async upsertRetentionRule(
    accountId: string,
    id: string | undefined,
    rule: {
      name: string;
      enabled?: boolean;
      inactiveDays?: number;
      requiredStageId?: string | null;
      requiredTagIds?: string[];
      targetCampaignId?: string | null;
      maxEnrollsPerRun?: number;
    },
  ): Promise<void> {
    if (id) {
      await this.tx.manager.query(
        `UPDATE public.retention_rules
         SET name = $3, enabled = $4, inactive_days = $5, required_stage_id = $6,
             required_tag_ids = $7, target_campaign_id = $8, max_enrolls_per_run = $9
         WHERE id = $1 AND account_id = $2`,
        [
          id,
          accountId,
          rule.name,
          rule.enabled ?? true,
          rule.inactiveDays ?? 60,
          rule.requiredStageId ?? null,
          rule.requiredTagIds ?? [],
          rule.targetCampaignId ?? null,
          rule.maxEnrollsPerRun ?? 50,
        ],
      );
    } else {
      await this.tx.manager.query(
        `INSERT INTO public.retention_rules
           (account_id, name, enabled, inactive_days, required_stage_id, required_tag_ids,
            target_campaign_id, max_enrolls_per_run)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          accountId,
          rule.name,
          rule.enabled ?? true,
          rule.inactiveDays ?? 60,
          rule.requiredStageId ?? null,
          rule.requiredTagIds ?? [],
          rule.targetCampaignId ?? null,
          rule.maxEnrollsPerRun ?? 50,
        ],
      );
    }
  }

  async deleteRetentionRule(accountId: string, id: string): Promise<void> {
    await this.tx.manager.query(
      `DELETE FROM public.retention_rules WHERE id = $1 AND account_id = $2`,
      [id, accountId],
    );
  }
}
