import {
  normalizeE164,
  isCentralOnlyPersona,
  recordSalesRepPendencia,
  resolveTransferDestination,
  transferDepartamento,
  type Departamento,
} from '../../sales-reps/sales-reps.util';
import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import {
  finalizeOutboundVoiceCall,
  callElevenLabsOutbound,
  buildFollowupSystemPrompt,
} from './el-outbound-cron.util';
import {
  DEFAULT_ALLOWED_HOURS_LOCAL,
  DEFAULT_MAX_ATTEMPTS_PER_DAY,
  DEFAULT_MIN_MINUTES_BETWEEN_ATTEMPTS,
} from '../../voice/voice-guard.service';
import {
  applyCampaignDisposition,
  dispositionFromTwilioStatus,
} from '../../voice/campaign-disposition.util';

/**
 * Motivo do adiamento em português, pra aparecer na tela da campanha. Sem
 * isto o contato bloqueado é indistinguível de um que ainda não chegou a vez.
 */
function blockReasonMessage(reason?: string): string {
  switch (reason) {
    case 'max_attempts_today':
      return 'Limite de tentativas por dia atingido para este número';
    case 'too_soon':
      return 'Aguardando o intervalo mínimo desde a última tentativa';
    case 'outside_allowed_hours':
      return 'Fora da janela de horário permitida para discagem';
    case 'outside_allowed_day':
      return 'Hoje não é um dia permitido para discagem';
    case 'rpc_error':
      return 'Falha ao checar as regras de compliance';
    default:
      return reason
        ? `Bloqueado pelas regras de compliance (${reason})`
        : 'Bloqueado pelas regras de compliance';
  }
}

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
  contact_name: string | null;
  contact_timezone: string | null;
  company_display_name: string | null;
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

    // Promove campanhas agendadas cuja hora chegou. Sem isto, 'scheduled' era
    // um status que existia no check constraint mas nada produzia nem
    // consumia, e o filtro de status='running' logo abaixo ignorava a
    // campanha pra sempre — agendar não disparava nunca.
    // SELECT antes do UPDATE em vez de UPDATE ... RETURNING: o retorno de
    // query() para UPDATE com RETURNING não é a lista de linhas (vinha
    // `[linhas, afetadas]`), então `.length` dava 2 e `.id` undefined — o log
    // anunciava "promoveu 2 campanhas: , " a cada minuto sem promover nada.
    const due = await this.dataSource.query<{ id: string; name: string }[]>(
      `SELECT id, name FROM voice_campaigns
        WHERE status = 'scheduled' AND scheduled_at IS NOT NULL
          AND scheduled_at <= now()`,
    );
    if (due.length > 0) {
      await this.dataSource.query(
        `UPDATE voice_campaigns
            SET status = 'running', started_at = coalesce(started_at, now())
          WHERE id = ANY($1)`,
        [due.map((c) => c.id)],
      );
      this.logger.log(
        `promoveu ${due.length} campanha(s) agendada(s) para running: ${due
          .map((c) => `${c.name} (${c.id})`)
          .join(', ')}`,
      );
    }

    await this.reconcileStuckContacts();

    const pending = await this.dataSource.query<PendingRow[]>(
      `SELECT vcc.id, vcc.campaign_id, vcc.account_id, vcc.contact_id, vcc.phone_number,
              vcc.variables, vcc.attempts,
              c.name AS contact_name,
              c.timezone AS contact_timezone,
              cs.company_name AS company_display_name,
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
         LEFT JOIN company_settings cs ON cs.account_id = vcc.account_id
        WHERE vcc.status = 'queued' AND vcc.dispatch_after <= now()
          -- No WHERE, não em memória depois do LIMIT: criar campanha já insere
          -- todo mundo 'queued' com dispatch_after = now() antes de alguém
          -- apertar "iniciar" (campaigns.service.ts), e a ordem é
          -- dispatch_after ASC. Filtrando só em JS, um rascunho antigo com 20+
          -- contatos ocupava a janela inteira pra sempre — e nada reescreve o
          -- dispatch_after deles, porque são descartados antes de qualquer
          -- update. Efeito: nenhuma campanha em execução voltava a discar.
          AND vc.status = 'running'
        ORDER BY vcc.dispatch_after ASC
        LIMIT $1`,
      [DISPATCH_BATCH],
    );

    if (pending.length === 0) return { dispatched: 0, skipped: 0, scanned: 0 };

    const byCampaign = new Map<string, PendingRow[]>();
    for (const r of pending) {
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
            `UPDATE voice_campaign_contacts
                SET dispatch_after = $2, last_error = $3
              WHERE id = $1`,
            [row.id, nextTry, `Cota da campanha atingida (${quota.reason})`],
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
          // Grava também o motivo. O original (e este port até aqui) só
          // reescrevia dispatch_after, então o contato voltava pra fila em
          // silêncio: na tela ele aparecia "Na fila" indefinidamente, sem
          // nada que explicasse por que não discava. O motivo do bloqueio só
          // existia em call_attempts_log, que a UI não lê.
          await this.dataSource.query(
            `UPDATE voice_campaign_contacts
                SET dispatch_after = $2, last_error = $3
              WHERE id = $1`,
            [
              row.id,
              new Date(Date.now() + delayMs),
              blockReasonMessage(compliance.reason),
            ],
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
      `voice-campaign-dispatch complete: scanned=${pending.length} dispatched=${dispatched} skipped=${skipped}`,
    );
    return { dispatched, skipped, scanned: pending.length };
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

    // Sem janela na campanha nem na conta, herda o mesmo padrão do caminho de
    // ligação avulsa (seg-sex 8-21, sáb 9-18, dom não disca). Antes caía em
    // `null`, que virava jsonb 'null' e bloqueava tudo — ver
    // DEFAULT_ALLOWED_HOURS_LOCAL. "Sem restrição" seria pior que o bug:
    // campanha discando de madrugada.
    const allowedHoursLocal =
      row.campaign_allowed_hours_local ??
      accCompliance.allowed_hours_local ??
      DEFAULT_ALLOWED_HOURS_LOCAL;
    const maxAttempts =
      row.campaign_max_attempts_per_day ??
      accCompliance.max_attempts_per_day_per_contact ??
      DEFAULT_MAX_ATTEMPTS_PER_DAY;
    const minMinutes =
      row.campaign_min_minutes_between_attempts ??
      accCompliance.min_minutes_between_attempts ??
      DEFAULT_MIN_MINUTES_BETWEEN_ATTEMPTS;

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
      const result = rows[0]?.is_phone_allowed_to_call ?? {
        allowed: false,
        reason: 'rpc_error',
      };
      // Números de teste pulam janela/limite/intervalo — nunca DNC. Sem isso,
      // validar uma campanha exige esperar o próprio teto diário do número de
      // quem está testando; os contatos reais da campanha continuam sob a
      // política normal da conta.
      const testNumbers = Array.isArray(accCompliance.test_numbers)
        ? (accCompliance.test_numbers as string[])
        : [];
      if (!result.allowed && result.reason !== 'dnc' && testNumbers.includes(row.phone_number)) {
        return { allowed: true };
      }
      return result;
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

  /**
   * Fecha contatos que ficaram em voo sem nunca receber desfecho.
   *
   * O desfecho normal chega por evento — webhook de status da Twilio ou
   * finalização da conversa na ElevenLabs. Evento se perde: provedor não
   * chama, o processo reinicia no meio, ou (como aconteceu aqui) a ligação foi
   * finalizada por uma versão do código que ainda não sabia propagar para a
   * campanha. Sem esta varredura o contato fica 'placed' pra sempre: o
   * dispatcher só olha 'queued', então ele nunca mais é tocado nem redisca.
   *
   * Duas fontes de verdade, nesta ordem:
   *  1. a voice_call ligada já está em estado terminal → deriva dela;
   *  2. não há ligação terminal mas o disparo foi há muito tempo → considera
   *     que não completou. STUCK_TIMEOUT_MIN é folgado de propósito, bem acima
   *     de max_call_duration_sec, pra nunca cortar ligação em andamento.
   */
  private async reconcileStuckContacts(): Promise<void> {
    const STUCK_TIMEOUT_MIN = 30;
    const stuck = await this.dataSource.query<
      {
        id: string;
        call_status: string | null;
        duration_seconds: number | null;
        minutes_in_flight: number;
      }[]
    >(
      `SELECT vcc.id,
              vc.status AS call_status,
              vc.duration_seconds,
              extract(epoch from (now() - coalesce(vcc.dispatched_at, vcc.updated_at))) / 60
                AS minutes_in_flight
         FROM voice_campaign_contacts vcc
         LEFT JOIN voice_calls vc ON vc.id = vcc.voice_call_id
        WHERE vcc.status IN ('placed','ringing','connected')
          AND (
            vc.status IN ('completed','failed','busy','no_answer','canceled')
            OR coalesce(vcc.dispatched_at, vcc.updated_at) < now() - ($1 || ' minutes')::interval
          )
        LIMIT 200`,
      [STUCK_TIMEOUT_MIN],
    );
    if (stuck.length === 0) return;

    for (const row of stuck) {
      const duration = row.duration_seconds ?? 0;
      const disposition = row.call_status
        ? dispositionFromTwilioStatus(row.call_status, duration)
        : 'nao_completou';
      await applyCampaignDisposition(
        this.dataSource,
        row.id,
        disposition ?? 'nao_completou',
        duration,
      );
    }
    this.logger.log(
      `reconciliou ${stuck.length} contato(s) parado(s) em voo sem desfecho`,
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

  /**
   * Destino de transferência da ligação, segregado por departamento (ver
   * `resolveTransferDestination`): COMERCIAL → vendedor do lead → atendente padrão comercial
   * → número da campanha/persona (legado); FINANCEIRO → SEMPRE o atendente padrão financeiro,
   * sem fallback (cobrança nunca vai para vendedor). Pendências registradas para o time
   * cadastrar. Nunca lança: falha aqui não pode impedir a ligação.
   */
  private async resolveTransferTarget(
    row: PendingRow,
    departamento: Departamento,
    persona: { name?: string | null; config?: Record<string, unknown> | null },
  ): Promise<{
    phone: string | null;
    atendenteNome: string | null;
    vendedorNome: string | null;
  }> {
    try {
      const centralOnly = departamento === 'COMERCIAL' && isCentralOnlyPersona(persona);
      const vars = (row.variables ?? {}) as Record<string, unknown>;
      // `vendedor_responsavel` (carteira/lista, editável pelo time) vence `vendedor_nome`
      // (vendedor da cotação no ERP): um contato pode ter as duas chaves com valores
      // diferentes, e a edição deliberada na lista é a intenção do operador.
      let leadVendedor = ['vendedor_responsavel', 'vendedor_nome', 'vendedor']
        .map((k) => vars[k])
        .find((v) => typeof v === 'string' && v.trim() !== '') as string | undefined;
      if (!leadVendedor && !centralOnly && row.contact_id && departamento === 'COMERCIAL') {
        const co = await this.dataSource.query<{ vendedor_nome_erp: string | null }[]>(
          `SELECT co.vendedor_nome_erp FROM contacts c
             JOIN companies co ON co.id = c.company_id
            WHERE c.id = $1 LIMIT 1`,
          [row.contact_id],
        );
        leadVendedor = co[0]?.vendedor_nome_erp ?? undefined;
      }

      const dest = await resolveTransferDestination(this.dataSource, {
        accountId: row.account_id,
        departamento,
        centralOnly,
        vendedorNome: leadVendedor,
      });

      let phone = dest.phone;
      let atendenteNome = dest.atendenteNome;
      // Legado (só COMERCIAL): sem vendedor e sem atendente padrão, usa o número da
      // campanha — ou o da campanha mais recente da mesma persona (o mesmo que o sync grava
      // como padrão no agente). FINANCEIRO nunca cai aqui.
      if (!phone && departamento === 'COMERCIAL') {
        const camp = await this.dataSource.query<
          { escalation_target_number: string | null }[]
        >(
          `SELECT escalation_target_number FROM voice_campaigns WHERE id = $1 LIMIT 1`,
          [row.campaign_id],
        );
        phone = normalizeE164(camp[0]?.escalation_target_number);
        if (!phone) {
          const persona = await this.dataSource.query<
            { escalation_target_number: string | null }[]
          >(
            `SELECT escalation_target_number FROM voice_campaigns
              WHERE persona_id = $1 AND account_id = $2
                AND COALESCE(btrim(escalation_target_number), '') <> ''
              ORDER BY (status = 'running') DESC, updated_at DESC LIMIT 1`,
            [row.campaign_persona_id, row.account_id],
          );
          phone = normalizeE164(persona[0]?.escalation_target_number);
        }
        if (phone) atendenteNome = 'nossa central de atendimento';
      }

      if (dest.pendencia) {
        await recordSalesRepPendencia(this.dataSource, {
          accountId: row.account_id,
          departamento,
          key: dest.pendencia.key,
          // 'sem_atendente_padrao' é do departamento, não de um vendedor específico —
          // leadVendedor aqui é só o vendedor do lead que gerou a tentativa, e mostrar
          // o nome dele nessa pendência confundiria (parece que é um problema "do
          // vendedor X", quando na verdade falta cadastrar o padrão do departamento).
          vendedorNome:
            dest.pendencia.reason === 'sem_atendente_padrao' ? null : (leadVendedor ?? null),
          reason: dest.pendencia.reason,
          campaignId: row.campaign_id,
          fallbackNumber: phone,
        });
      }
      return {
        phone,
        atendenteNome,
        // centralOnly: não expõe o vendedor do lead como {{vendedor_nome}} — a IA
        // sempre fala "central comercial", nunca o nome de quem perdeu a venda.
        vendedorNome: centralOnly ? null : dest.vendedorNome ?? leadVendedor ?? null,
      };
    } catch (err) {
      this.logger.error(
        `resolveTransferTarget falhou campaign=${row.campaign_id}: ${(err as Error).message}`,
      );
      return { phone: null, atendenteNome: null, vendedorNome: null };
    }
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
        config: Record<string, unknown> | null;
        first_message: string | null;
      }[]
    >(
      `SELECT elevenlabs_agent_id, name, system_prompt, voice_clone_id, config, first_message FROM agent_personas WHERE id = $1 LIMIT 1`,
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

    const departamento = transferDepartamento({
      persona: { name: persona.name, config: persona.config },
      campaignKind: row.campaign_campaign_kind,
    });
    const transfer = await this.resolveTransferTarget(row, departamento, {
      name: persona.name,
      config: persona.config,
    });

    const dynamicVariables: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(row.variables ?? {}).map(([k, v]) => [k, String(v)]),
      ),
      campaign_id: row.campaign_id,
      campaign_contact_id: row.id,
      call_purpose:
        row.campaign_campaign_kind === 'cobranca' ? 'cobranca' : 'followup',
      agent_name: persona.name ?? 'Nina',
      // Sem isso, {{lead_name}}/{{company_name}} nunca resolviam em ligação de
      // campanha (só no caminho de ligação avulsa, voice-el-outbound.service.ts)
      // — o agente falava o texto cru do prompt ("Posso falar com o(a) Lead?")
      // em vez do nome do contato.
      lead_name: (row.contact_name ?? '').split(' ')[0] || '',
      company_name: row.company_display_name ?? 'nossa empresa',
      voice_call_id: voiceCallId,
      // Destino da transfer_to_number (phone_dynamic_variable no agente) e como a IA o cita.
      // telefone_atendente SEMPRE precisa estar presente (mesmo vazio): o tool
      // transfer_to_number do agente sincronizado referencia essa dynamic
      // variable por nome (phone_dynamic_variable), e se ela não vier no payload
      // da ligação a ElevenLabs aborta a conversa inteira com "Dynamic variable
      // 'telefone_atendente' is not available" assim que o agente tenta usá-la —
      // não é só question de sobrescrever um placeholder, é a chamada inteira caindo.
      atendente_departamento: departamento,
      telefone_atendente: transfer.phone ?? '',
      ...(transfer.atendenteNome ? { atendente_nome: transfer.atendenteNome } : {}),
      // Compat com o agente comercial já sincronizado ({{vendedor_nome}}/telefone_vendedor).
      // FINANCEIRO não recebe nada de vendedor: nunca pode transbordar para o comercial.
      ...(departamento === 'COMERCIAL' && transfer.phone
        ? { telefone_vendedor: transfer.phone }
        : {}),
      ...(departamento === 'COMERCIAL' && transfer.vendedorNome
        ? { vendedor_nome: transfer.vendedorNome }
        : {}),
    };
    const outcomesBlock = await this.buildOutcomesPromptBlock(
      row.account_id,
      row.campaign_campaign_kind ?? 'sdr',
    );
    const systemPrompt = `${buildFollowupSystemPrompt(persona.system_prompt, departamento)}${outcomesBlock}`;

    const el = await callElevenLabsOutbound({
      elKey,
      agentId: persona.elevenlabs_agent_id,
      elPhoneId: phoneRow.elevenlabs_phone_number_id,
      toNumber,
      // Sem opening_script na campanha, usa o first_message configurado no
      // agente (com identificação/empresa) — nunca um "Olá, tudo bem?" genérico,
      // que fazia o lead desconfiar e desligar sem o agente nunca se identificar.
      firstMessage:
        row.campaign_opening_script ?? persona.first_message ?? 'Olá, tudo bem?',
      systemPrompt,
      voiceCloneId: persona.voice_clone_id,
      dynamicVariables,
    });
    await finalizeOutboundVoiceCall(this.dataSource, voiceCallId, el);

    await this.dataSource.query(
      // last_error = null: se o contato estava adiado por compliance, o motivo
      // gravado lá vira mentira no instante em que ele finalmente disca.
      `UPDATE voice_campaign_contacts
         SET status = 'placed', attempts = $2, last_attempt_at = now(), voice_call_id = $3,
             dispatched_at = now(), last_error = null
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
