import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { EvolutionClientService } from '../../evolution/evolution-client.service';
import { renderTemplate } from '../../../common/template.util';
import {
  resolveOutboundPhoneAndPersona,
  resolveElevenLabsApiKey,
  callElevenLabsOutbound,
  buildFollowupSystemPrompt,
  createOutboundVoiceCallRow,
  finalizeOutboundVoiceCall,
} from './el-outbound-cron.util';

interface CadenceDueItem {
  execution_id: string;
  account_id: string;
  cadence_id: string;
  contact_id: string;
  current_step: number;
  step_definition: {
    channel?: string;
    offset_hours?: number;
    template_key?: string;
    message?: string;
  } | null;
}

const STALE_RUNNING_MINUTES = 20;

/**
 * Ported from supabase/functions/cadence-tick/index.ts. Only channel=voice
 * is implemented (matches the original — WhatsApp/email steps are marked
 * skipped-but-advanced so they don't block the cadence, same as upstream).
 *
 * A execução de um step de voz NÃO avança aqui mais — só marca
 * `waiting_call_id`/status='running' e some da fila do cadence_due até
 * `call-finalize.service.ts` (que sabe se a ligação foi atendida) chamar
 * `cadence_advance` com o desfecho real. O `sweepStaleRunning` abaixo é a
 * rede de segurança caso essa ligação nunca finalize.
 */
@Processor('cadence-tick')
export class CadenceTickProcessor extends WorkerHost {
  private readonly logger = new Logger(CadenceTickProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly evolutionClient: EvolutionClientService,
  ) {
    super();
  }

  async process(job: Job): Promise<{
    checked: number;
    advanced: number;
    waiting: number;
    failed: number;
    skipped: number;
    staleRecovered: number;
  }> {
    this.logger.log(`running cadence-tick (job ${job.id})`);
    const items = await this.dataSource.query<CadenceDueItem[]>(
      `SELECT execution_id, account_id, cadence_id, contact_id, current_step, step_definition
       FROM public.cadence_due($1)`,
      [50],
    );

    let advanced = 0;
    let waiting = 0;
    let failed = 0;
    let skipped = 0;

    for (const it of items) {
      if (!it.step_definition) {
        await this.dataSource.query(
          `SELECT public.cadence_advance($1, true, NULL)`,
          [it.execution_id],
        );
        advanced++;
        continue;
      }
      const channel = it.step_definition.channel ?? 'voice';
      try {
        if (channel === 'voice') {
          const callId = await dispatchVoiceFollowup(this.dataSource, it);
          await this.dataSource.query(
            `SELECT public.cadence_mark_waiting_call($1, $2)`,
            [it.execution_id, callId],
          );
          waiting++;
          continue;
        }
        if (channel === 'whatsapp') {
          // Fire-and-forget: avança assim que a mensagem é enviada, não
          // espera resposta do contato (diferente de voz, que espera o
          // desfecho real via waiting_call_id). Se o contato responder, cai
          // no pipeline normal de inbound/auto-reply, sem reabrir a cadência.
          await dispatchWhatsappFollowup(this.dataSource, this.evolutionClient, it);
          await this.dataSource.query(
            `SELECT public.cadence_advance($1, true, NULL)`,
            [it.execution_id],
          );
          advanced++;
          continue;
        }
        skipped++;
        await this.dataSource.query(
          `SELECT public.cadence_advance($1, true, NULL)`,
          [it.execution_id],
        );
        advanced++;
      } catch (err) {
        await this.dataSource.query(
          `SELECT public.cadence_advance($1, false, $2)`,
          [it.execution_id, (err as Error).message.slice(0, 500)],
        );
        failed++;
      }
    }

    const staleRecovered = await this.sweepStaleRunning();

    this.logger.log(
      `cadence-tick complete: checked=${items.length} advanced=${advanced} waiting=${waiting} failed=${failed} skipped=${skipped} staleRecovered=${staleRecovered}`,
    );
    return { checked: items.length, advanced, waiting, failed, skipped, staleRecovered };
  }

  /**
   * Execuções presas em 'running' por mais de STALE_RUNNING_MINUTES: a
   * ligação nunca finalizou (webhook da EL perdido e o retry de
   * voice-call-finalize-pending — a cada 2min, calls presas há >90s —
   * também não pegou). Força o avanço como falha em vez de deixar a
   * cadência parada pra sempre.
   */
  private async sweepStaleRunning(): Promise<number> {
    const stale = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM public.follow_up_executions WHERE status = 'running' AND updated_at < now() - ($1 || ' minutes')::interval`,
      [String(STALE_RUNNING_MINUTES)],
    );
    for (const row of stale) {
      await this.dataSource.query(
        `SELECT public.cadence_advance($1, false, $2)`,
        [row.id, 'call result timeout'],
      );
    }
    return stale.length;
  }
}

async function dispatchVoiceFollowup(
  dataSource: DataSource,
  it: CadenceDueItem,
): Promise<string> {
  const contactRows = await dataSource.query<
    {
      id: string;
      name: string | null;
      phone_number: string | null;
      blocked: boolean | null;
    }[]
  >(
    `SELECT id, name, phone_number, blocked FROM contacts WHERE id = $1 LIMIT 1`,
    [it.contact_id],
  );
  const contact = contactRows[0];
  if (!contact?.phone_number) throw new Error('contact has no phone');
  if (contact.blocked) throw new Error('contact blocked');

  const { phone, personaId, persona } = await resolveOutboundPhoneAndPersona(
    dataSource,
    it.account_id,
  );
  const elKey = await resolveElevenLabsApiKey(dataSource, it.account_id);

  const callId = await createOutboundVoiceCallRow(dataSource, {
    accountId: it.account_id,
    phoneId: phone.id,
    personaId,
    fromNumber: phone.e164,
    toNumber: contact.phone_number,
    metadata: {
      source: 'cadence-tick',
      cadence_id: it.cadence_id,
      cadence_execution_id: it.execution_id,
      cadence_step: it.current_step,
      call_purpose: 'followup',
    },
  });

  const leadName = (contact.name ?? '').split(' ')[0] || 'olá';
  const dynamicVariables: Record<string, string> = {
    call_purpose: 'followup',
    lead_name: leadName,
    agent_name: persona.name ?? 'Nina',
    voice_call_id: callId,
  };
  const firstMessage = `Oi ${leadName}, é a Nina. Estou retomando contato sobre nossa última conversa. Tem um minutinho?`;

  const el = await callElevenLabsOutbound({
    elKey,
    agentId: persona.elevenlabs_agent_id!,
    elPhoneId: phone.elevenlabs_phone_number_id!,
    toNumber: contact.phone_number,
    firstMessage,
    systemPrompt: buildFollowupSystemPrompt(persona.system_prompt),
    voiceCloneId: persona.voice_clone_id,
    dynamicVariables,
  });
  await finalizeOutboundVoiceCall(dataSource, callId, el);
  return callId;
}

interface WhatsappStepResolution {
  account_id: string;
  contact_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_identifier: string | null;
  contact_blocked: boolean;
  inbox_id: string | null;
  channel_config: {
    evolution_url?: string;
    evolution_api_key?: string;
    evolution_instance_name?: string;
  } | null;
  facts: Record<string, string>;
}

async function dispatchWhatsappFollowup(
  dataSource: DataSource,
  evolutionClient: EvolutionClientService,
  it: CadenceDueItem,
): Promise<void> {
  const template = (it.step_definition?.message ?? '').trim();
  if (!template) throw new Error('whatsapp step has no message');

  const [row] = await dataSource.query<
    { cadence_whatsapp_step_resolve: WhatsappStepResolution | null }[]
  >(`SELECT public.cadence_whatsapp_step_resolve($1) AS cadence_whatsapp_step_resolve`, [
    it.execution_id,
  ]);
  const resolved = row?.cadence_whatsapp_step_resolve;
  if (!resolved) throw new Error('could not resolve contact/account for cadence execution');
  if (resolved.contact_blocked) throw new Error('contact blocked');

  const cfg = resolved.channel_config;
  if (!cfg?.evolution_url || !cfg.evolution_api_key || !cfg.evolution_instance_name) {
    throw new Error('account has no whatsapp channel configured');
  }
  if (!resolved.inbox_id) throw new Error('whatsapp channel has no inbox');

  let targetNumber = resolved.contact_phone ?? '';
  if (!targetNumber && resolved.contact_identifier) {
    const m = /evolution:whatsapp:([^@:]+)/.exec(resolved.contact_identifier);
    if (m) targetNumber = m[1];
  }
  if (!targetNumber) throw new Error('contact has no phone');

  const message = renderTemplate(template, {
    nome: (resolved.contact_name ?? '').split(' ')[0] || '',
    nome_completo: resolved.contact_name ?? '',
    ...resolved.facts,
  });
  if (!message.trim()) throw new Error('rendered whatsapp message is empty');

  await evolutionClient.sendText({
    url: cfg.evolution_url,
    apiKey: cfg.evolution_api_key,
    instanceName: cfg.evolution_instance_name,
    number: targetNumber,
    text: message,
  });

  await dataSource.query(`SELECT public.cadence_whatsapp_record_message($1, $2, $3, $4, $5)`, [
    resolved.account_id,
    resolved.inbox_id,
    resolved.contact_id,
    message,
    it.execution_id,
  ]);
}
