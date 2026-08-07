import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
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

  constructor(private readonly dataSource: DataSource) {
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
