import {
  BadRequestException,
  ConflictException,
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
  /** Contatos aguardando discagem (status = queued). Calculado ao vivo. */
  queued_count: number;
  /** Chamadas em toque agora (status = placed | ringing). Calculado ao vivo. */
  ringing_count: number;
  /** Chamadas em curso agora (status = connected). Calculado ao vivo. */
  in_progress_count: number;
  created_at: Date;
  scheduled_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  min_minutes_between_attempts: number | null;
  max_attempts_per_day: number | null;
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
  outcome: string | null;
  call_duration_sec: number | null;
  dispatch_after: Date | null;
}

export interface ContactListRow {
  id: string;
  name: string;
  description: string | null;
  campaign_kind: string | null;
  /** Agente escolhido ao criar a lista — decide os campos do formulário manual. */
  persona_id: string | null;
  /** Nome do agente de `persona_id`, pra mostrar/filtrar sem outro round-trip. */
  persona_name: string | null;
  is_dynamic: boolean;
  member_count: number;
  valid_phone_count: number;
  filters: Record<string, unknown>;
  created_at: Date;
  /** Chave da lista no sistema de origem; null em lista criada dentro do produto. */
  external_key: string | null;
  /** 'aberta' | 'finalizada' — ver OperationalListSyncRun20260923010000. */
  status: string;
  /** Número sequencial só em lista gerada por sincronização (nome "#<numero> <agente>"); null em lista manual. */
  list_number: number | null;
  /**
   * Nomes das variáveis que os contatos desta lista trazem do sistema de
   * origem. É o que a pessoa precisa saber na hora de escrever a abertura da
   * campanha — sem isso ela não tem como adivinhar que existe {{valor_titulo}}.
   */
  variable_keys: string[];
}

export interface EnrollmentBatchRow {
  id: string;
  status: string;
  contact_count: number;
  source: string | null;
  created_at: Date;
  decided_at: Date | null;
  decided_by_name: string | null;
  still_pending: number;
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

const LIVE_COUNTERS = `
  (SELECT COUNT(*) FROM voice_campaign_contacts WHERE campaign_id = vc.id AND status = 'queued')::int AS queued_count,
  (SELECT COUNT(*) FROM voice_campaign_contacts WHERE campaign_id = vc.id AND status IN ('placed','ringing'))::int AS ringing_count,
  (SELECT COUNT(*) FROM voice_campaign_contacts WHERE campaign_id = vc.id AND status = 'connected')::int AS in_progress_count`;

const CAMPAIGN_COLUMNS = `vc.id, vc.name, vc.status, vc.campaign_kind, vc.total_contacts, vc.placed_count,
  vc.connected_count, vc.escalated_count, vc.voicemail_count, vc.failed_count, vc.created_at,
  vc.scheduled_at, vc.started_at, vc.finished_at, vc.min_minutes_between_attempts,
  vc.max_attempts_per_day, ${LIVE_COUNTERS}`;

@Injectable({ scope: Scope.REQUEST })
export class CampaignsService {
  constructor(private readonly tx: TenantTxHost) {}

  async list(accountId: string): Promise<CampaignRow[]> {
    return this.tx.manager.query<CampaignRow[]>(
      `SELECT ${CAMPAIGN_COLUMNS}
       FROM public.voice_campaigns vc
       WHERE vc.account_id = $1
       ORDER BY vc.created_at DESC LIMIT 200`,
      [accountId],
    );
  }

  async get(accountId: string, id: string): Promise<CampaignDetailRow> {
    const rows = await this.tx.manager.query<CampaignDetailRow[]>(
      `SELECT ${CAMPAIGN_COLUMNS}, vc.opening_script, vc.from_number
       FROM public.voice_campaigns vc
       WHERE vc.id = $1 AND vc.account_id = $2`,
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
      `SELECT id, to_number, status, attempts, last_attempt_at, last_error, voice_call_id,
              outcome, call_duration_sec, dispatch_after
       FROM public.voice_campaign_contacts
       WHERE campaign_id = $1 AND account_id = $2
       ORDER BY id DESC LIMIT 500`,
      [campaignId, accountId],
    );
  }

  /**
   * Recoloca na fila os contatos que falharam de vez (status = 'failed'),
   * com um ciclo novo de tentativas, e desconta o contador de falhas da
   * campanha (incrementado em bump_voice_campaign_totals quando o contato
   * esgotou as tentativas). Reabre a campanha se ela já tinha terminado.
   */
  async retryFailedContacts(
    accountId: string,
    campaignId: string,
    rowId?: string,
  ): Promise<{ ok: true; requeued: number }> {
    const camp = await this.tx.manager.query<{ status: string }[]>(
      `SELECT status FROM public.voice_campaigns WHERE id = $1 AND account_id = $2`,
      [campaignId, accountId],
    );
    if (!camp[0]) throw new NotFoundException('campanha não encontrada');
    if (camp[0].status === 'canceled') {
      throw new BadRequestException('campanha encerrada — crie uma nova');
    }

    // 'failed' (esgotou as tentativas) e 'queued' com erro (aguardando o
    // próximo retry agendado) são reenfileirados para agora.
    const rows = await this.tx.manager.query<
      { id: string; was_failed: boolean }[]
    >(
      `UPDATE public.voice_campaign_contacts vcc
          SET status = 'queued', attempts = 0, last_error = NULL,
              error_message = NULL, dispatch_after = now(), finished_at = NULL
         FROM (SELECT id, status = 'failed' AS was_failed
                 FROM public.voice_campaign_contacts
                WHERE campaign_id = $1 AND account_id = $2
                  AND ($3::text IS NULL OR id::text = $3)
                  AND (status = 'failed'
                       OR (status = 'queued' AND last_error IS NOT NULL))) old
        WHERE vcc.id = old.id
        RETURNING vcc.id, old.was_failed`,
      [campaignId, accountId, rowId ?? null],
    );
    const requeued = rows.length;
    const wereFailed = rows.filter((r) => r.was_failed).length;
    if (requeued > 0) {
      await this.tx.manager.query(
        `UPDATE public.voice_campaigns
            SET failed_count = GREATEST(failed_count - $3, 0),
                status = CASE WHEN status = 'completed' THEN 'running' ELSE status END,
                finished_at = CASE WHEN status = 'completed' THEN NULL ELSE finished_at END
          WHERE id = $1 AND account_id = $2`,
        [campaignId, accountId, wereFailed],
      );
    }
    return { ok: true, requeued };
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

  /**
   * Lotes de inscrição da campanha — os pendentes são a fila de aprovação, os
   * decididos ficam como histórico de quem liberou o quê e quando.
   */
  async listEnrollmentBatches(
    accountId: string,
    campaignId: string,
  ): Promise<EnrollmentBatchRow[]> {
    return this.tx.manager.query<EnrollmentBatchRow[]>(
      `SELECT b.id, b.status, b.contact_count, b.source, b.created_at,
              b.decided_at, p.name AS decided_by_name,
              (SELECT count(*)::int FROM public.voice_campaign_contacts vcc
                WHERE vcc.enrollment_batch_id = b.id
                  AND vcc.status = 'pending_approval') AS still_pending
         FROM public.campaign_enrollment_batches b
         LEFT JOIN public.profiles p ON p.id = b.decided_by_id
        WHERE b.account_id = $1 AND b.campaign_id = $2
        ORDER BY b.created_at DESC
        LIMIT 50`,
      [accountId, campaignId],
    );
  }

  /**
   * Amostra dos contatos de um lote pendente. Aprovar às cegas um lote de
   * "1.284 contatos" não é aprovação nenhuma — quem decide precisa ver quem
   * está lá dentro e com que dados a agente vai ligar.
   */
  async previewEnrollmentBatch(
    accountId: string,
    batchId: string,
  ): Promise<unknown[]> {
    return this.tx.manager.query(
      `SELECT c.name, c.external_id, vcc.phone_number, vcc.variables
         FROM public.voice_campaign_contacts vcc
         JOIN public.contacts c ON c.id = vcc.contact_id
        WHERE vcc.enrollment_batch_id = $2
          AND vcc.account_id = $1
          AND vcc.status = 'pending_approval'
        ORDER BY c.name NULLS LAST
        LIMIT 25`,
      [accountId, batchId],
    );
  }

  async decideEnrollmentBatch(
    accountId: string,
    campaignId: string,
    batchId: string,
    userId: string,
    decision: 'approve' | 'reject',
  ): Promise<{ ok: boolean; reason?: string }> {
    // Confere dono antes de chamar a função: campaign_approve_batch é
    // SECURITY DEFINER (precisa ser, porque a ingestão a alcança sem sessão) e
    // portanto não valida conta sozinha. Sem esta checagem, um id de lote de
    // outro tenant seria aceito.
    const owned = await this.tx.manager.query<{ id: string }[]>(
      `SELECT id FROM public.campaign_enrollment_batches
        WHERE id = $1 AND account_id = $2 AND campaign_id = $3`,
      [batchId, accountId, campaignId],
    );
    if (!owned.length) throw new NotFoundException('Lote não encontrado');

    const fn =
      decision === 'approve'
        ? 'public.campaign_approve_batch'
        : 'public.campaign_reject_batch';
    const rows = await this.tx.manager.query<
      { result: { ok: boolean; reason?: string } }[]
    >(`SELECT ${fn}($1, $2) AS result`, [batchId, userId]);
    return rows[0]?.result ?? { ok: false, reason: 'rpc_error' };
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
      // variable_keys sai de uma amostra dos 50 primeiros membros, não da lista
      // inteira: numa carga do ERP todo mundo traz o mesmo conjunto de chaves,
      // então varrer 10 mil contatos para descobrir isso seria caro à toa.
      `SELECT cl.id, cl.name, cl.description, cl.campaign_kind, cl.persona_id, cl.is_dynamic, cl.member_count, cl.filters, cl.created_at,
              cl.external_key, cl.status, cl.list_number,
              p.name AS persona_name,
              (SELECT COUNT(*)::int
               FROM public.contact_list_members clm
               JOIN public.contacts c ON c.id = clm.contact_id
               WHERE clm.list_id = cl.id AND c.blocked = false AND c.phone_number IS NOT NULL
              ) AS valid_phone_count,
              coalesce((
                SELECT array_agg(DISTINCT k ORDER BY k)
                FROM (
                  SELECT c.custom_attributes -> 'ingest_variables' AS vars
                  FROM public.contact_list_members clm
                  JOIN public.contacts c ON c.id = clm.contact_id
                  WHERE clm.list_id = cl.id
                    AND c.custom_attributes ? 'ingest_variables'
                  LIMIT 50
                ) sample,
                LATERAL jsonb_object_keys(sample.vars) AS k
              ), ARRAY[]::text[]) AS variable_keys
       FROM public.contact_lists cl
       LEFT JOIN public.agent_personas p ON p.id = cl.persona_id
       WHERE cl.account_id = $1
       ORDER BY cl.created_at DESC`,
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
      scheduledAt?: string;
      minMinutesBetweenAttempts?: number;
      maxAttemptsPerDay?: number;
      autoEnrollMode?: 'off' | 'approval';
    },
  ): Promise<{ id: string; contactCount: number; scheduledAt: string | null }> {
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

    // Agendamento no passado não faz sentido e silenciosamente nunca
    // dispararia (o tick só promove com scheduled_at <= now(), então uma data
    // vencida promoveria de imediato sem o usuário ter pedido isso).
    let scheduledAt: Date | null = null;
    if (dto.scheduledAt) {
      const parsed = new Date(dto.scheduledAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Data de agendamento inválida');
      }
      if (parsed.getTime() <= Date.now()) {
        throw new BadRequestException(
          'A data de disparo precisa estar no futuro',
        );
      }
      scheduledAt = parsed;
    }
    const status = scheduledAt ? 'scheduled' : 'draft';

    const campaignRows = await this.tx.manager.query<{ id: string }[]>(
      `INSERT INTO public.voice_campaigns
         (account_id, name, campaign_kind, status, mode, persona_id, voice_id, from_number,
          phone_number_id, opening_script, max_concurrent, retry_attempts, retry_delay_minutes,
          record_call, language_code, script_mode, scheduled_at, min_minutes_between_attempts,
          max_attempts_per_day, source_list_id, auto_enroll_mode)
       VALUES ($1,$2,$3,$12,'conversational',$4,$5,$6,$7,$8,$9,$10,30,$11,'pt-BR','conversational',$13,$14,$15,$16,$17)
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
        status,
        scheduledAt,
        dto.minMinutesBetweenAttempts ?? null,
        dto.maxAttemptsPerDay ?? null,
        // source_list_id fica gravado nos dois modos: mesmo em 'off' é a
        // resposta para "de onde vieram estes contatos?" três semanas depois.
        dto.listId,
        dto.autoEnrollMode ?? 'off',
      ],
    );
    const campaignId = campaignRows[0].id;

    // As variáveis de operação do contato (valor do título, vencimento,
    // número do orçamento — gravadas em custom_attributes.ingest_variables
    // pela carga do ERP) viajam junto. O campo `variables` ficava sempre em
    // '{}': o dispatcher já as repassa como dynamic_variables para a
    // ElevenLabs e o webhook de personalização já as injeta na conversa, então
    // o único elo faltando era este — a agente ligava sem saber do que estava
    // falando. Contato sem carga externa continua com '{}'.
    const memberRows = await this.tx.manager.query<
      {
        contact_id: string;
        phone_number: string;
        variables: Record<string, unknown> | null;
      }[]
    >(
      `SELECT clm.contact_id, c.phone_number,
              public.contact_erp_variables(c.id) AS variables
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
         VALUES ($1,$2,$3,$4,$4,'queued',$5::jsonb)`,
        [
          accountId,
          campaignId,
          m.contact_id,
          m.phone_number,
          JSON.stringify(m.variables ?? {}),
        ],
      );
    }

    await this.tx.manager.query(
      `UPDATE public.voice_campaigns SET total_contacts = $2 WHERE id = $1`,
      [campaignId, memberRows.length],
    );

    return {
      id: campaignId,
      contactCount: memberRows.length,
      scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
    };
  }

  async update(
    accountId: string,
    id: string,
    dto: {
      name?: string;
      openingScript?: string | null;
      maxConcurrent?: number;
      retryAttempts?: number;
      recordCall?: boolean;
      scheduledAt?: string | null;
      minMinutesBetweenAttempts?: number;
      maxAttemptsPerDay?: number;
    },
  ): Promise<{ ok: true; status: string; scheduledAt: string | null }> {
    const rows = await this.tx.manager.query<
      { status: string; scheduled_at: Date | null }[]
    >(
      `SELECT status, scheduled_at FROM public.voice_campaigns
        WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [id, accountId],
    );
    const current = rows[0];
    if (!current) throw new NotFoundException('campanha não encontrada');

    const sets: string[] = [];
    const params: unknown[] = [id, accountId];
    const push = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (dto.name !== undefined) push('name', dto.name);
    if (dto.openingScript !== undefined)
      push('opening_script', dto.openingScript || null);
    if (dto.maxConcurrent !== undefined)
      push('max_concurrent', dto.maxConcurrent);
    if (dto.retryAttempts !== undefined)
      push('retry_attempts', dto.retryAttempts);
    if (dto.recordCall !== undefined) push('record_call', dto.recordCall);
    if (dto.minMinutesBetweenAttempts !== undefined)
      push('min_minutes_between_attempts', dto.minMinutesBetweenAttempts);
    if (dto.maxAttemptsPerDay !== undefined)
      push('max_attempts_per_day', dto.maxAttemptsPerDay);

    // O status acompanha o agendamento, mas só entre draft e scheduled: uma
    // campanha já rodando, pausada ou concluída não volta pra agendada só
    // porque alguém mexeu na data.
    let nextScheduled: Date | null = current.scheduled_at;
    if (dto.scheduledAt !== undefined) {
      if (dto.scheduledAt === null) {
        nextScheduled = null;
        push('scheduled_at', null);
        if (current.status === 'scheduled') push('status', 'draft');
      } else {
        const parsed = new Date(dto.scheduledAt);
        if (Number.isNaN(parsed.getTime()))
          throw new BadRequestException('Data de agendamento inválida');
        if (parsed.getTime() <= Date.now())
          throw new BadRequestException(
            'A data de disparo precisa estar no futuro',
          );
        nextScheduled = parsed;
        push('scheduled_at', parsed);
        if (current.status === 'draft' || current.status === 'scheduled')
          push('status', 'scheduled');
      }
    }

    if (sets.length === 0) {
      throw new BadRequestException('Nenhum campo para atualizar');
    }

    const updated = await this.tx.manager.query<
      { status: string; scheduled_at: Date | null }[]
    >(
      `UPDATE public.voice_campaigns
          SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $1 AND account_id = $2
        RETURNING status, scheduled_at`,
      params,
    );
    return {
      ok: true,
      status: updated[0].status,
      scheduledAt: updated[0].scheduled_at
        ? new Date(updated[0].scheduled_at).toISOString()
        : null,
    };
  }

  async remove(
    accountId: string,
    id: string,
  ): Promise<{ ok: true; deletedContacts: number }> {
    const rows = await this.tx.manager.query<{ status: string }[]>(
      `SELECT status FROM public.voice_campaigns
        WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [id, accountId],
    );
    if (!rows.length) throw new NotFoundException('campanha não encontrada');
    // Excluir no meio da discagem deixaria ligações em voo sem campanha de
    // destino pra registrar o resultado. Pausar primeiro é uma ação do próprio
    // usuário, então é ele que decide interromper.
    if (rows[0].status === 'running') {
      throw new ConflictException(
        'Campanha em andamento. Pause ou cancele antes de excluir.',
      );
    }

    const queued = await this.tx.manager.query<{ count: string }[]>(
      `SELECT count(*) FROM public.voice_campaign_contacts WHERE campaign_id = $1`,
      [id],
    );
    // voice_campaign_contacts cai por ON DELETE CASCADE; o histórico em
    // voice_calls não tem FK pra cá, então as ligações já feitas continuam
    // consultáveis em Ligações depois da exclusão.
    await this.tx.manager.query(
      `DELETE FROM public.voice_campaigns WHERE id = $1 AND account_id = $2`,
      [id, accountId],
    );
    return { ok: true, deletedContacts: Number(queued[0]?.count ?? 0) };
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
