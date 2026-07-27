import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import {
  finalizeOutboundVoiceCall,
  callElevenLabsOutbound,
  buildFollowupSystemPrompt,
} from './el-outbound-cron.util';

const DISPATCH_BATCH = 20;
const DEFAULT_CONCURRENT_PER_CAMPAIGN = 5;
const IN_FLIGHT_STATUSES = ['placed', 'ringing', 'connected', 'escalated'];

interface PendingRow {
  id: string;
  campaign_id: string;
  account_id: string;
  contact_id: string;
  phone_number: string;
  variables: Record<string, unknown>;
  attempts: number;
  contact_timezone: string | null;
  campaign_status: string;
  campaign_persona_id: string | null;
  campaign_voice_id: string | null;
  campaign_phone_number_id: string | null;
  campaign_script_mode: string;
  campaign_opening_script: string | null;
  campaign_max_call_duration_sec: number;
  campaign_record_call: boolean;
  campaign_max_concurrent: number;
  campaign_retry_attempts: number;
  campaign_retry_delay_minutes: number;
  campaign_campaign_kind: string;
  campaign_allowed_hours_local: Record<string, unknown> | null;
  campaign_max_attempts_per_day: number | null;
  campaign_min_minutes_between_attempts: number | null;
  campaign_from_number: string;
}

const KIND_LABEL: Record<string, string> = {
  sdr: 'SDR / Prospecção',
  cobranca: 'Cobrança / Recuperação',
  pos_venda: 'Pós-venda / CSAT',
  retencao: 'Retenção / Reativação',
  custom: 'Operação customizada',
};

/**
 * Ported from supabase/functions/voice-campaign-dispatch/index.ts —
 * campaign-scale auto-dialer. Runs every minute (matches
 * voice-campaign-dispatch-every-minute in the original cron, minus the
 * duplicate hardcoded-Supabase-URL variant that was dead weight — see
 * jobs.module.ts). DataSource direct, cross-account cron.
 */
@Processor('voice-campaign-dispatch')
export class VoiceCampaignDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(VoiceCampaignDispatchProcessor.name);

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async process(
    job: Job,
  ): Promise<{ dispatched: number; skipped: number; scanned: number }> {
    this.logger.log(`running voice-campaign-dispatch (job ${job.id})`);

    const pending = await this.dataSource.query<PendingRow[]>(
      `SELECT vcc.id, vcc.campaign_id, vcc.account_id, vcc.contact_id, vcc.phone_number,
              vcc.variables, vcc.attempts,
              c.timezone AS contact_timezone,
              vc.status AS campaign_status, vc.persona_id AS campaign_persona_id,
              vc.voice_id AS campaign_voice_id, vc.phone_number_id AS campaign_phone_number_id,
              vc.script_mode AS campaign_script_mode, vc.opening_script AS campaign_opening_script,
              vc.max_call_duration_sec AS campaign_max_call_duration_sec,
              vc.record_call AS campaign_record_call, vc.max_concurrent AS campaign_max_concurrent,
              vc.retry_attempts AS campaign_retry_attempts,
              vc.retry_delay_minutes AS campaign_retry_delay_minutes,
              vc.campaign_kind AS campaign_campaign_kind,
              vc.allowed_hours_local AS campaign_allowed_hours_local,
              vc.max_attempts_per_day AS campaign_max_attempts_per_day,
              vc.min_minutes_between_attempts AS campaign_min_minutes_between_attempts,
              vc.from_number AS campaign_from_number
         FROM voice_campaign_contacts vcc
         JOIN voice_campaigns vc ON vc.id = vcc.campaign_id
         LEFT JOIN contacts c ON c.id = vcc.contact_id
        WHERE vcc.status = 'queued' AND vcc.dispatch_after <= now()
        ORDER BY vcc.dispatch_after ASC
        LIMIT $1`,
      [DISPATCH_BATCH],
    );

    const ready = pending.filter((r) => r.campaign_status === 'running');
    if (ready.length === 0) return { dispatched: 0, skipped: 0, scanned: 0 };

    const byCampaign = new Map<string, PendingRow[]>();
    for (const r of ready) {
      const list = byCampaign.get(r.campaign_id) ?? [];
      list.push(r);
      byCampaign.set(r.campaign_id, list);
    }

    let dispatched = 0;
    let skipped = 0;

    for (const [campaignId, rows] of byCampaign) {
      const inflightRows = await this.dataSource.query<{ count: string }[]>(
        `SELECT count(*) FROM voice_campaign_contacts WHERE campaign_id = $1 AND status = ANY($2)`,
        [campaignId, IN_FLIGHT_STATUSES],
      );
      const inflight = parseInt(inflightRows[0]?.count ?? '0', 10);
      const cap =
        rows[0]?.campaign_max_concurrent ?? DEFAULT_CONCURRENT_PER_CAMPAIGN;
      const slots = Math.max(0, cap - inflight);
      const take = rows.slice(0, slots);
      if (take.length === 0) {
        skipped += rows.length;
        continue;
      }

      const quota = await this.checkCampaignQuota(campaignId);
      if (!quota.allowed) {
        const delayMin = quota.reason?.endsWith('_day_cap')
          ? 60
          : quota.reason?.endsWith('_week_cap')
            ? 60 * 6
            : 60 * 12;
        const nextTry = new Date(Date.now() + delayMin * 60 * 1000);
        for (const row of take) {
          await this.logAttempt(row, `blocked_${quota.reason}`);
          await this.dataSource.query(
            `UPDATE voice_campaign_contacts SET dispatch_after = $2 WHERE id = $1`,
            [row.id, nextTry],
          );
        }
        skipped += take.length;
        continue;
      }

      for (const row of take) {
        const compliance = await this.checkCompliance(row);
        if (!compliance.allowed) {
          await this.logAttempt(row, `blocked_${compliance.reason}`);

          if (compliance.reason === 'dnc') {
            await this.dataSource.query(
              `UPDATE voice_campaign_contacts SET status = 'failed', last_error = 'blocked by DNC list', finished_at = now() WHERE id = $1`,
              [row.id],
            );
            await this.dataSource.query(
              `SELECT public.bump_voice_campaign_totals($1, 0, 0, 0, 0, 1)`,
              [row.campaign_id],
            );
            skipped++;
            continue;
          }

          const delayMs =
            compliance.reason === 'too_soon' ? 15 * 60 * 1000 : 30 * 60 * 1000;
          await this.dataSource.query(
            `UPDATE voice_campaign_contacts SET dispatch_after = $2 WHERE id = $1`,
            [row.id, new Date(Date.now() + delayMs)],
          );
          skipped++;
          continue;
        }

        try {
          await this.dispatchOne(row);
          dispatched++;
        } catch (err) {
          const maxAttempts = row.campaign_retry_attempts + 1;
          const nextAttempts = row.attempts + 1;
          const errMsg = (err as Error).message;

          if (nextAttempts < maxAttempts) {
            const nextRetry = new Date(
              Date.now() + row.campaign_retry_delay_minutes * 60 * 1000,
            );
            await this.dataSource.query(
              `UPDATE voice_campaign_contacts
                 SET status = 'queued', attempts = $2, last_error = $3, dispatch_after = $4, last_attempt_at = now()
               WHERE id = $1`,
              [row.id, nextAttempts, errMsg, nextRetry],
            );
          } else {
            await this.dataSource.query(
              `UPDATE voice_campaign_contacts SET status = 'failed', attempts = $2, last_error = $3, finished_at = now() WHERE id = $1`,
              [row.id, nextAttempts, errMsg],
            );
            await this.dataSource.query(
              `SELECT public.bump_voice_campaign_totals($1, 0, 0, 0, 0, 1)`,
              [row.campaign_id],
            );
          }
          this.logger.warn(
            `dispatch failed campaign=${row.campaign_id} contact=${row.contact_id}: ${errMsg}`,
          );
        }
      }

      await this.maybeCompleteCampaign(campaignId);
    }

    this.logger.log(
      `voice-campaign-dispatch complete: scanned=${ready.length} dispatched=${dispatched} skipped=${skipped}`,
    );
    return { dispatched, skipped, scanned: ready.length };
  }

  private async checkCompliance(
    row: PendingRow,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const timezone = row.contact_timezone ?? 'America/Sao_Paulo';
    const accRows = await this.dataSource.query<
      { internal_attributes: Record<string, unknown> }[]
    >(`SELECT internal_attributes FROM accounts WHERE id = $1 LIMIT 1`, [
      row.account_id,
    ]);
    const accCompliance = (accRows[0]?.internal_attributes?.compliance ??
      {}) as Record<string, unknown>;

    const allowedHoursLocal =
      row.campaign_allowed_hours_local ??
      accCompliance.allowed_hours_local ??
      null;
    const maxAttempts =
      row.campaign_max_attempts_per_day ??
      accCompliance.max_attempts_per_day_per_contact ??
      2;
    const minMinutes =
      row.campaign_min_minutes_between_attempts ??
      accCompliance.min_minutes_between_attempts ??
      120;

    try {
      const rows = await this.dataSource.query<
        { is_phone_allowed_to_call: { allowed: boolean; reason?: string } }[]
      >(
        `SELECT public.is_phone_allowed_to_call($1, $2, $3, $4::jsonb, $5, $6) AS is_phone_allowed_to_call`,
        [
          row.account_id,
          row.phone_number,
          timezone,
          JSON.stringify(allowedHoursLocal),
          maxAttempts,
          minMinutes,
        ],
      );
      return (
        rows[0]?.is_phone_allowed_to_call ?? {
          allowed: false,
          reason: 'rpc_error',
        }
      );
    } catch {
      return { allowed: false, reason: 'rpc_error' };
    }
  }

  private async checkCampaignQuota(
    campaignId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const rows = await this.dataSource.query<
        { voice_campaign_quota_check: { allowed: boolean; reason?: string } }[]
      >(
        `SELECT public.voice_campaign_quota_check($1, 'call') AS voice_campaign_quota_check`,
        [campaignId],
      );
      return rows[0]?.voice_campaign_quota_check ?? { allowed: true };
    } catch {
      // Fail-open on RPC error so a quota glitch doesn't halt all dispatch (matches original).
      return { allowed: true };
    }
  }

  private async logAttempt(row: PendingRow, outcome: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO call_attempts_log (account_id, contact_id, phone_number, campaign_id, outcome)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        row.account_id,
        row.contact_id,
        row.phone_number,
        row.campaign_id,
        outcome,
      ],
    );
  }

  private async maybeCompleteCampaign(campaignId: string): Promise<void> {
    const rows = await this.dataSource.query<{ count: string }[]>(
      `SELECT count(*) FROM voice_campaign_contacts WHERE campaign_id = $1 AND status = ANY($2)`,
      [campaignId, ['queued', ...IN_FLIGHT_STATUSES]],
    );
    if (parseInt(rows[0]?.count ?? '0', 10) > 0) return;
    await this.dataSource.query(
      `UPDATE voice_campaigns SET status = 'completed', finished_at = now() WHERE id = $1 AND status = 'running'`,
      [campaignId],
    );
  }

  private async dispatchOne(row: PendingRow): Promise<void> {
    if (!row.campaign_phone_number_id)
      throw new Error('campaign has no phone_number_id');
    const phoneRows = await this.dataSource.query<
      { e164: string; elevenlabs_phone_number_id: string | null }[]
    >(
      `SELECT e164, elevenlabs_phone_number_id FROM phone_numbers WHERE id = $1 LIMIT 1`,
      [row.campaign_phone_number_id],
    );
    const phoneRow = phoneRows[0];
    if (!phoneRow?.elevenlabs_phone_number_id) {
      throw new Error(
        "número Twilio não está ativado com ElevenLabs — abre /phone-numbers e clica 'Ativar IA'",
      );
    }

    const personaRows = await this.dataSource.query<
      {
        elevenlabs_agent_id: string | null;
        name: string | null;
        system_prompt: string | null;
        voice_clone_id: string | null;
      }[]
    >(
      `SELECT elevenlabs_agent_id, name, system_prompt, voice_clone_id FROM agent_personas WHERE id = $1 LIMIT 1`,
      [row.campaign_persona_id],
    );
    const persona = personaRows[0];
    if (!persona?.elevenlabs_agent_id) {
      throw new Error(
        "persona da campanha não está sincronizada com EL — abre /agents e clica 'Sincronizar com EL'",
      );
    }

    const toNumber = row.phone_number.startsWith('+')
      ? row.phone_number
      : `+${row.phone_number.replace(/\D/g, '')}`;

    const callRows = await this.dataSource.query<{ id: string }[]>(
      `INSERT INTO voice_calls
         (account_id, phone_number_id, persona_id, direction, status, provider,
          from_number, to_number, started_at, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, 'outbound', 'queued', 'twilio', $4, $5, now(), $6::jsonb, now(), now())
       RETURNING id`,
      [
        row.account_id,
        row.campaign_phone_number_id,
        row.campaign_persona_id,
        phoneRow.e164,
        toNumber,
        JSON.stringify({
          campaign_id: row.campaign_id,
          campaign_contact_id: row.id,
          campaign_kind: row.campaign_campaign_kind ?? 'sdr',
          voice_id: row.campaign_voice_id,
          variables: row.variables,
          opening_script: row.campaign_opening_script,
          engine: 'elevenlabs',
        }),
      ],
    );
    const voiceCallId = callRows[0].id;

    const elKeyRows = await this.dataSource.query<
      { decrypted_secret: string }[]
    >(
      `SELECT vs.decrypted_secret
       FROM public.account_secrets s
       JOIN vault.decrypted_secrets vs ON vs.id = s.vault_secret_id
       WHERE s.account_id = $1 AND s.provider = 'elevenlabs' AND s.key_name = 'api_key'`,
      [row.account_id],
    );
    const elKey =
      elKeyRows[0]?.decrypted_secret || process.env.ELEVENLABS_API_KEY || '';
    if (!elKey) throw new Error('ELEVENLABS_API_KEY not configured');

    const dynamicVariables: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(row.variables ?? {}).map(([k, v]) => [k, String(v)]),
      ),
      campaign_id: row.campaign_id,
      campaign_contact_id: row.id,
      call_purpose: 'followup',
      agent_name: persona.name ?? 'Nina',
      voice_call_id: voiceCallId,
    };
    const outcomesBlock = await this.buildOutcomesPromptBlock(
      row.account_id,
      row.campaign_campaign_kind ?? 'sdr',
    );
    const systemPrompt = `${buildFollowupSystemPrompt(persona.system_prompt)}${outcomesBlock}`;

    const el = await callElevenLabsOutbound({
      elKey,
      agentId: persona.elevenlabs_agent_id,
      elPhoneId: phoneRow.elevenlabs_phone_number_id,
      toNumber,
      firstMessage: row.campaign_opening_script ?? 'Olá, tudo bem?',
      systemPrompt,
      voiceCloneId: persona.voice_clone_id,
      dynamicVariables,
    });
    await finalizeOutboundVoiceCall(this.dataSource, voiceCallId, el);

    await this.dataSource.query(
      `UPDATE voice_campaign_contacts
         SET status = 'placed', attempts = $2, last_attempt_at = now(), voice_call_id = $3, dispatched_at = now()
       WHERE id = $1`,
      [row.id, row.attempts + 1, voiceCallId],
    );
    await this.dataSource.query(
      `SELECT public.bump_voice_campaign_totals($1, 1, 0, 0, 0, 0)`,
      [row.campaign_id],
    );
    await this.logAttempt(row, 'placed');
  }

  private async buildOutcomesPromptBlock(
    accountId: string,
    kind: string,
  ): Promise<string> {
    const rows = await this.dataSource.query<
      { code: string; label: string; description: string | null }[]
    >(
      `SELECT code, label, description FROM call_outcomes_catalog
       WHERE campaign_kind = $1 AND (account_id = $2 OR account_id IS NULL)
       ORDER BY position ASC`,
      [kind, accountId],
    );
    if (rows.length === 0) return '';

    const seen = new Set<string>();
    const items: string[] = [];
    for (const r of rows) {
      if (seen.has(r.code)) continue;
      seen.add(r.code);
      items.push(
        `- \`${r.code}\` — ${r.label}${r.description ? `: ${r.description}` : ''}`,
      );
    }

    return `\n\n# DESFECHOS POSSÍVEIS — ${KIND_LABEL[kind] ?? kind.toUpperCase()}\nClassifique mentalmente a ligação em UM destes desfechos (use exatamente o código quando reportar via ferramenta):\n${items.join('\n')}`;
  }
}
