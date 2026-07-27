import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  FASE_TO_CATEGORY,
  STAGE_BY_CATEGORY,
  TEMPERATURE_BOOST,
  resolveContactIdFromCall,
  resolveStageIdByName,
  type OutcomeCategory,
} from './lead-resolve.util';
import {
  ConfirmMeetingDto,
  GetAvailabilityDto,
  QualifyLeadDto,
  RescheduleMeetingDto,
  ScheduleMeetingDto,
} from './dto/agent-tools.dto';

export interface ToolResponse {
  status: number;
  body: Record<string, unknown>;
}

function ok(body: Record<string, unknown>, status = 200): ToolResponse {
  return { status, body: { ok: true, ...body } };
}
function fail(
  error: string,
  status: number,
  extra: Record<string, unknown> = {},
): ToolResponse {
  return { status, body: { ok: false, error, ...extra } };
}

function formatPtBr(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(d);
}

function clampInt(n: unknown, min: number, max: number): number {
  const v = parseInt(String(n), 10);
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 && s.toLowerCase() !== 'null' ? s : null;
}

// contacts.last_sentiment has a CHECK constraint accepting only the English
// values below (migration 20260429140258) — the agent sends PT-BR
// (positivo/neutro/negativo), so it must be mapped before writing, or the
// UPDATE violates the constraint and fails for every qualify-lead call.
const SENTIMENT_MAP: Record<string, 'positive' | 'neutral' | 'negative'> = {
  positivo: 'positive',
  positive: 'positive',
  neutro: 'neutral',
  neutral: 'neutral',
  negativo: 'negative',
  negative: 'negative',
};

function mapSentiment(v: string): 'positive' | 'neutral' | 'negative' | null {
  return SENTIMENT_MAP[v.trim().toLowerCase()] ?? null;
}

// voice_calls.outcome_category has its own CHECK constraint whose value set
// doesn't match OutcomeCategory from lead-resolve.util.ts (e.g. no
// 'scheduled'/'qualified'/'callback') — map to the closest allowed value
// before writing, or the UPDATE violates the constraint.
const OUTCOME_CATEGORY_DB_MAP: Record<OutcomeCategory, string> = {
  scheduled: 'interested',
  qualified: 'interested',
  not_interested: 'not_interested',
  callback: 'callback_requested',
  no_answer: 'no_answer',
  voicemail: 'voicemail',
  wrong_number: 'wrong_number',
  escalated: 'escalated',
  other: 'other',
};

/**
 * Ported from supabase/functions/agent-tool-{confirm-meeting,get-availability,
 * qualify-lead,reschedule-meeting,schedule-meeting}/index.ts — function-calling
 * tools the ElevenLabs agent invokes DURING a live call. DataSource direct
 * (no user session — the caller is the ElevenLabs platform, authenticated by
 * shared secret via AgentToolsAuthGuard).
 */
@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger(AgentToolsService.name);

  constructor(private readonly dataSource: DataSource) {}

  async confirmMeeting(dto: ConfirmMeetingDto): Promise<ToolResponse> {
    const rows = await this.dataSource.query<
      { id: string; status: string; starts_at: string }[]
    >(
      `SELECT id, status, starts_at FROM scheduled_meetings WHERE id = $1 LIMIT 1`,
      [dto.meeting_id],
    );
    const meeting = rows[0];
    if (!meeting) return fail('meeting not found', 404);
    if (meeting.status !== 'scheduled') {
      return fail(`meeting status is ${meeting.status}, cannot confirm`, 409);
    }

    await this.dataSource.query(
      `UPDATE scheduled_meetings SET confirmed_at = now() WHERE id = $1`,
      [dto.meeting_id],
    );
    this.logger.log(`meeting=${dto.meeting_id} confirmed`);

    return ok({
      meeting_id: dto.meeting_id,
      confirmation_message: 'Tudo certo, confirmado. Até lá!',
    });
  }

  async getAvailability(dto: GetAvailabilityDto): Promise<ToolResponse> {
    const daysAhead = clampInt(dto.days_ahead ?? 14, 1, 30);
    const maxOptions = clampInt(dto.max_options ?? 4, 1, 10);

    const callRows = await this.dataSource.query<{ account_id: string }[]>(
      `SELECT account_id FROM voice_calls WHERE source_id = $1 LIMIT 1`,
      [dto.conversation_id],
    );
    const accountId = callRows[0]?.account_id;
    if (!accountId)
      return fail('voice_call not found for conversation_id', 404);

    const conditions: string[] = ['account_id = $1', 'active = true'];
    const params: unknown[] = [accountId];
    if (dto.doctor_id) {
      params.push(dto.doctor_id);
      conditions.push(`id = $${params.length}`);
    } else if (dto.specialty) {
      params.push(`%${dto.specialty}%`);
      conditions.push(`specialty ILIKE $${params.length}`);
    } else if (dto.doctor_name) {
      params.push(`%${dto.doctor_name}%`);
      conditions.push(`name ILIKE $${params.length}`);
    }

    const doctors = await this.dataSource.query<
      {
        id: string;
        name: string;
        specialty: string | null;
        modalities: string[];
        default_duration_minutes: number;
      }[]
    >(
      `SELECT id, name, specialty, modalities, default_duration_minutes FROM doctors WHERE ${conditions.join(' AND ')}`,
      params,
    );

    if (doctors.length === 0) {
      const filterDesc = dto.specialty
        ? `pra especialidade "${dto.specialty}"`
        : dto.doctor_name
          ? `pra ${dto.doctor_name}`
          : 'cadastrado';
      return ok({
        slots: [],
        friendly_message: `Não encontrei nenhum médico ${filterDesc} aqui na agenda. Posso te transferir pra recepção pra ela te ajudar?`,
      });
    }

    const doctorIds = doctors.map((d) => d.id);
    const horizon = new Date(Date.now() + daysAhead * 86400_000);
    const now = new Date();

    const [avail, blocks, meetings] = await Promise.all([
      this.dataSource.query<
        {
          doctor_id: string;
          weekday: number;
          start_time: string;
          end_time: string;
        }[]
      >(
        `SELECT doctor_id, weekday, start_time, end_time FROM doctor_availability WHERE doctor_id = ANY($1)`,
        [doctorIds],
      ),
      this.dataSource.query<
        { doctor_id: string; starts_at: string; ends_at: string }[]
      >(
        `SELECT doctor_id, starts_at, ends_at FROM doctor_blocks
         WHERE doctor_id = ANY($1) AND ends_at >= $2 AND starts_at < $3`,
        [doctorIds, now, horizon],
      ),
      this.dataSource.query<
        { doctor_id: string; starts_at: string; ends_at: string | null }[]
      >(
        `SELECT doctor_id, starts_at, ends_at FROM scheduled_meetings
         WHERE account_id = $1 AND doctor_id = ANY($2) AND status = 'scheduled' AND starts_at >= $3 AND starts_at < $4`,
        [accountId, doctorIds, now, horizon],
      ),
    ]);

    if (avail.length === 0) {
      return ok({
        slots: [],
        friendly_message:
          'A agenda do médico ainda não foi configurada aqui no sistema. Posso te transferir pra recepção?',
      });
    }

    const durationDefault = clampInt(dto.duration_minutes ?? 30, 15, 240);
    const slots = this.generateSlotsForDoctors({
      doctors,
      availability: avail,
      blocks,
      meetings,
      daysAhead,
      durationDefault,
    });

    if (slots.length === 0) {
      return ok({
        slots: [],
        friendly_message:
          'Não tenho horários livres nas próximas semanas pra esse médico. Posso te ligar de volta quando abrir vaga, ou te passar pra recepção?',
      });
    }

    const seenDays = new Set<string>();
    const picked: typeof slots = [];
    for (const s of slots) {
      const dayKey = s.starts_at.slice(0, 10) + ':' + s.doctor_id;
      if (seenDays.has(dayKey)) continue;
      seenDays.add(dayKey);
      picked.push(s);
      if (picked.length >= maxOptions) break;
    }

    const friendly =
      'Tenho estes horários: ' +
      picked.map((p, i) => `(${i + 1}) ${p.label}`).join('; ') +
      '. Qual encaixa melhor pra você?';

    return ok({ slots: picked, friendly_message: friendly });
  }

  private generateSlotsForDoctors(args: {
    doctors: {
      id: string;
      name: string;
      specialty: string | null;
      modalities: string[];
      default_duration_minutes: number;
    }[];
    availability: {
      doctor_id: string;
      weekday: number;
      start_time: string;
      end_time: string;
    }[];
    blocks: { doctor_id: string; starts_at: string; ends_at: string }[];
    meetings: {
      doctor_id: string;
      starts_at: string;
      ends_at: string | null;
    }[];
    daysAhead: number;
    durationDefault: number;
  }) {
    const {
      doctors,
      availability,
      blocks,
      meetings,
      daysAhead,
      durationDefault,
    } = args;
    const now = new Date();
    const out: Array<{
      doctor_id: string;
      doctor_name: string;
      specialty: string | null;
      modalities: string[];
      starts_at: string;
      ends_at: string;
      duration_min: number;
      label: string;
    }> = [];

    const availByDoctor = new Map<string, typeof availability>();
    for (const a of availability) {
      const arr = availByDoctor.get(a.doctor_id) ?? [];
      arr.push(a);
      availByDoctor.set(a.doctor_id, arr);
    }

    for (const doc of doctors) {
      const docAvail = availByDoctor.get(doc.id) ?? [];
      if (docAvail.length === 0) continue;
      const duration = doc.default_duration_minutes ?? durationDefault;

      for (let dayOffset = 0; dayOffset <= daysAhead; dayOffset++) {
        const d = new Date(now);
        d.setDate(d.getDate() + dayOffset);
        const weekday = d.getDay();
        const dayKey = d.toISOString().slice(0, 10);

        for (const a of docAvail) {
          if (a.weekday !== weekday) continue;
          const [sh, sm] = String(a.start_time).split(':').map(Number);
          const [eh, em] = String(a.end_time).split(':').map(Number);
          const slotStart = new Date(`${dayKey}T${pad(sh)}:${pad(sm)}:00`);
          const slotEnd = new Date(`${dayKey}T${pad(eh)}:${pad(em)}:00`);
          let cursor = new Date(slotStart);

          while (cursor.getTime() + duration * 60_000 <= slotEnd.getTime()) {
            const slotEndsAt = new Date(cursor.getTime() + duration * 60_000);
            if (cursor.getTime() <= now.getTime() + 30 * 60_000) {
              cursor = new Date(cursor.getTime() + duration * 60_000);
              continue;
            }
            const conflictMeeting = meetings.some(
              (m) =>
                m.doctor_id === doc.id &&
                new Date(m.starts_at).getTime() < slotEndsAt.getTime() &&
                (m.ends_at
                  ? new Date(m.ends_at).getTime()
                  : new Date(m.starts_at).getTime() + duration * 60_000) >
                  cursor.getTime(),
            );
            const conflictBlock = blocks.some(
              (b) =>
                b.doctor_id === doc.id &&
                new Date(b.starts_at).getTime() < slotEndsAt.getTime() &&
                new Date(b.ends_at).getTime() > cursor.getTime(),
            );
            if (!conflictMeeting && !conflictBlock) {
              out.push({
                doctor_id: doc.id,
                doctor_name: doc.name,
                specialty: doc.specialty,
                modalities: doc.modalities,
                starts_at: cursor.toISOString(),
                ends_at: slotEndsAt.toISOString(),
                duration_min: duration,
                label: `${formatPtBr(cursor)} com ${doc.name}${doc.specialty ? ` (${doc.specialty})` : ''}`,
              });
            }
            cursor = new Date(cursor.getTime() + duration * 60_000);
          }
        }
      }
    }

    out.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return out;
  }

  async qualifyLead(
    dto: QualifyLeadDto,
    conversationIdHeader: string | null,
  ): Promise<ToolResponse> {
    const conversationId = conversationIdHeader || dto.conversation_id || null;
    if (!conversationId) {
      return fail('x-conversation-id header or conversation_id required', 400);
    }

    const fasePipeline = (dto.fase_pipeline ?? '').trim();
    const sentimento = (dto.sentimento ?? '').trim();
    if (!fasePipeline || !sentimento) {
      return fail('fase_pipeline and sentimento are required', 400);
    }

    const callRows = await this.dataSource.query<
      {
        id: string;
        account_id: string;
        conversation_id: string | null;
        from_number: string | null;
        to_number: string | null;
        direction: string | null;
        metadata: Record<string, unknown> | null;
      }[]
    >(
      `SELECT id, account_id, conversation_id, from_number, to_number, direction, metadata
       FROM voice_calls WHERE source_id = $1 LIMIT 1`,
      [conversationId],
    );
    const call = callRows[0];
    if (!call) {
      this.logger.warn(
        `voice_call não encontrada p/ conversation_id=${conversationId}`,
      );
      return fail('call context not found', 404);
    }

    const contactId = await resolveContactIdFromCall(this.dataSource, call);
    if (!contactId) return fail('could not resolve contact', 500);

    const category = FASE_TO_CATEGORY[fasePipeline] ?? 'other';
    const stageInfo = STAGE_BY_CATEGORY[category];
    const stageId = await resolveStageIdByName(
      this.dataSource,
      call.account_id,
      stageInfo.stageName,
    );

    const tempBoost = TEMPERATURE_BOOST[dto.temperatura ?? ''] ?? 0;
    const score = Math.max(0, Math.min(100, stageInfo.score + tempBoost));

    const briefing = {
      dor: stringOrNull(dto.dor_principal),
      fit: this.composeFit(dto),
      objections: [] as string[],
      next_action:
        stringOrNull(dto.proxima_acao) ?? stringOrNull(dto.observacao),
    };

    const customExtras: Record<string, unknown> = {};
    if (stringOrNull(dto.empresa))
      customExtras.empresa = dto.empresa!.trim().slice(0, 200);
    if (stringOrNull(dto.cnpj))
      customExtras.cnpj = dto.cnpj!.replace(/\D/g, '').slice(0, 14);
    if (stringOrNull(dto.ferramenta_atual))
      customExtras.ferramenta_atual = dto
        .ferramenta_atual!.trim()
        .slice(0, 200);

    let customAttributes: Record<string, unknown> | undefined;
    if (Object.keys(customExtras).length > 0) {
      const existingRows = await this.dataSource.query<
        { custom_attributes: Record<string, unknown> }[]
      >(`SELECT custom_attributes FROM contacts WHERE id = $1 LIMIT 1`, [
        contactId,
      ]);
      customAttributes = {
        ...(existingRows[0]?.custom_attributes ?? {}),
        ...customExtras,
      };
    }

    const location =
      stringOrNull(dto.cidade) || stringOrNull(dto.uf)
        ? [stringOrNull(dto.cidade) ?? '', stringOrNull(dto.uf) ?? '']
            .filter(Boolean)
            .join('/')
            .slice(0, 200)
        : null;

    try {
      await this.dataSource.query(
        `UPDATE contacts SET
           score = $2,
           briefing = $3::jsonb,
           last_sentiment = COALESCE($4, last_sentiment),
           last_activity_at = now(),
           stage_id = COALESCE($5, stage_id),
           name = COALESCE($6, name),
           email = COALESCE($7, email),
           phone_number = COALESCE($8, phone_number),
           location = COALESCE($9, location),
           custom_attributes = COALESCE($10::jsonb, custom_attributes),
           updated_at = now()
         WHERE id = $1`,
        [
          contactId,
          score,
          JSON.stringify(briefing),
          mapSentiment(sentimento),
          stageId,
          stringOrNull(dto.nome)?.slice(0, 200) ?? null,
          stringOrNull(dto.email)?.toLowerCase().slice(0, 200) ?? null,
          stringOrNull(dto.telefone)?.slice(0, 32) ?? null,
          location,
          customAttributes ? JSON.stringify(customAttributes) : null,
        ],
      );
    } catch (err) {
      this.logger.error('contact update failed', err as Error);
      return fail('contact update failed', 500);
    }

    const classification = {
      source: 'agent_tool',
      category,
      fase_pipeline: fasePipeline,
      interesse: stringOrNull(dto.interesse),
      sentimento,
      temperatura: stringOrNull(dto.temperatura),
      motivo_descarte: stringOrNull(dto.motivo_descarte),
      proxima_acao: stringOrNull(dto.proxima_acao),
      score,
      briefing,
      classified_at: new Date().toISOString(),
    };
    const summary = this.composeSummary(dto, briefing);

    await this.dataSource.query(
      `UPDATE voice_calls SET
         outcome_category = $2, outcome_confidence = 0.95, outcome_summary = $3,
         outcome_classified_at = now(), classification = $4::jsonb
       WHERE id = $1`,
      [
        call.id,
        OUTCOME_CATEGORY_DB_MAP[category],
        summary,
        JSON.stringify(classification),
      ],
    );

    if (call.conversation_id) {
      await this.dataSource.query(
        `INSERT INTO conversation_outcomes (account_id, conversation_id, contact_id, outcome_type, confidence, source, observed_at, metadata, created_at)
         VALUES ($1, $2, $3, $4, 0.95, 'agent-tool-qualify-lead', now(), $5::jsonb, now())`,
        [
          call.account_id,
          call.conversation_id,
          contactId,
          category,
          JSON.stringify({ score, fase_pipeline: fasePipeline, sentimento }),
        ],
      );
    }

    if (dto.motivo_descarte === 'dnc' && stringOrNull(dto.telefone)) {
      await this.dataSource.query(
        `INSERT INTO dnc_list (account_id, phone_number, reason, source, notes, created_at, registered_at)
         VALUES ($1, $2, 'agent_dnc_request', 'agent-tool-qualify-lead', $3, now(), now())`,
        [call.account_id, dto.telefone!.trim(), stringOrNull(dto.observacao)],
      );
    }

    this.logger.log(
      `call=${call.id} contact=${contactId} fase=${fasePipeline} cat=${category} score=${score} stage=${stageId ?? '—'}`,
    );

    const firstName = stringOrNull(dto.nome)
      ? dto.nome!.trim().split(/\s+/)[0]
      : '';
    const mensagem = firstName
      ? `Anotei aqui, ${firstName}. Vamos seguir.`
      : 'Anotado. Vamos seguir.';

    return ok({
      contact_id: contactId,
      fase_pipeline: fasePipeline,
      score,
      confirmation_message: mensagem,
    });
  }

  private composeFit(dto: QualifyLeadDto): string | null {
    const parts: string[] = [];
    if (stringOrNull(dto.interesse)) parts.push(`interesse=${dto.interesse}`);
    if (stringOrNull(dto.temperatura))
      parts.push(`temperatura=${dto.temperatura}`);
    if (stringOrNull(dto.empresa)) parts.push(`empresa=${dto.empresa}`);
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  private composeSummary(
    dto: QualifyLeadDto,
    briefing: { dor: string | null; next_action: string | null },
  ): string {
    const parts: string[] = [];
    if (briefing.dor) parts.push(`Dor: ${briefing.dor}`);
    if (briefing.next_action)
      parts.push(`Próximo passo: ${briefing.next_action}`);
    if (stringOrNull(dto.observacao)) parts.push(dto.observacao!.trim());
    return parts.join(' · ').slice(0, 500) || 'Lead qualificado pelo agente';
  }

  async rescheduleMeeting(dto: RescheduleMeetingDto): Promise<ToolResponse> {
    const originalRows = await this.dataSource.query<
      {
        id: string;
        account_id: string;
        contact_id: string | null;
        attendee_user_id: string | null;
        doctor_id: string | null;
        modality: string | null;
        duration_minutes: number | null;
        briefing: Record<string, unknown> | null;
        sdr_call_id: string | null;
        invitee_name: string | null;
        invitee_email: string | null;
        invitee_phone: string | null;
        title: string | null;
      }[]
    >(
      `SELECT id, account_id, contact_id, attendee_user_id, doctor_id, modality, duration_minutes, briefing,
              sdr_call_id, invitee_name, invitee_email, invitee_phone, title
       FROM scheduled_meetings WHERE id = $1 LIMIT 1`,
      [dto.meeting_id],
    );
    const original = originalRows[0];
    if (!original) return fail('meeting not found', 404);

    if (dto.action === 'cancel') {
      await this.dataSource.query(
        `UPDATE scheduled_meetings SET status = 'canceled', cancellation_reason = $2, updated_at = now() WHERE id = $1`,
        [dto.meeting_id, dto.reason ?? 'lead solicitou cancelamento'],
      );
      this.logger.log(`cancel meeting=${dto.meeting_id}`);
      return ok({
        action: 'cancel',
        meeting_id: dto.meeting_id,
        confirmation_message:
          'Tudo bem, cancelei pra você. Se quiser remarcar depois, é só ligar de volta.',
      });
    }

    if (!dto.new_starts_at)
      return fail('new_starts_at required for reschedule', 400);
    const newStarts = new Date(dto.new_starts_at);
    if (Number.isNaN(newStarts.getTime()))
      return fail('invalid new_starts_at', 400);
    if (newStarts.getTime() < Date.now() + 5 * 60_000) {
      return fail('new_starts_at must be at least 5 min in the future', 400);
    }

    const durationMin = clampInt(
      dto.duration_minutes ?? original.duration_minutes ?? 30,
      15,
      240,
    );
    const newEnds = new Date(newStarts.getTime() + durationMin * 60_000);

    const conflictKey = original.doctor_id ? 'doctor_id' : 'attendee_user_id';
    const conflictVal = original.doctor_id ?? original.attendee_user_id;
    if (conflictVal) {
      const conflicts = await this.dataSource.query<{ id: string }[]>(
        `SELECT id FROM scheduled_meetings
         WHERE account_id = $1 AND ${conflictKey} = $2 AND status = 'scheduled'
           AND starts_at < $3 AND ends_at > $4 AND id != $5`,
        [original.account_id, conflictVal, newEnds, newStarts, dto.meeting_id],
      );
      if (conflicts.length > 0) {
        return fail('slot already booked', 409, {
          conflict_meeting_id: conflicts[0].id,
        });
      }
    }

    let newMeeting: { id: string; starts_at: string } | undefined;
    try {
      const rows = await this.dataSource.query<
        { id: string; starts_at: string }[]
      >(
        `INSERT INTO scheduled_meetings
           (account_id, contact_id, doctor_id, modality, provider, provider_event_id, title, starts_at, ends_at,
            duration_minutes, status, invitee_name, invitee_email, invitee_phone, attendee_user_id, briefing,
            sdr_call_id, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'internal', $5, $6, $7, $8, $9, 'scheduled', $10, $11, $12, $13, $14::jsonb,
                 $15, $16::jsonb, now(), now())
         RETURNING id, starts_at`,
        [
          original.account_id,
          original.contact_id,
          original.doctor_id,
          original.modality,
          `nina-resched-${dto.meeting_id}-${Date.now()}`,
          original.title,
          newStarts,
          newEnds,
          durationMin,
          original.invitee_name,
          original.invitee_email,
          original.invitee_phone,
          original.attendee_user_id,
          JSON.stringify(original.briefing ?? null),
          original.sdr_call_id,
          JSON.stringify({
            rescheduled_from: dto.meeting_id,
            reason: dto.reason ?? null,
            scheduled_via: 'agent_tool_reschedule',
          }),
        ],
      );
      newMeeting = rows[0];
    } catch (err) {
      this.logger.error('insert failed', err as Error);
      return fail('failed to create rescheduled meeting', 500);
    }
    if (!newMeeting) return fail('failed to create rescheduled meeting', 500);

    await this.dataSource.query(
      `UPDATE scheduled_meetings SET status = 'rescheduled', cancellation_reason = $2, updated_at = now() WHERE id = $1`,
      [dto.meeting_id, dto.reason ?? 'remarcada pelo lead'],
    );

    if (original.contact_id) {
      const stageId = await resolveStageIdByName(
        this.dataSource,
        original.account_id,
        'Reunião agendada',
      );
      if (stageId) {
        await this.dataSource.query(
          `UPDATE contacts SET stage_id = $2, updated_at = now() WHERE id = $1`,
          [original.contact_id, stageId],
        );
      }
    }

    this.logger.log(
      `reschedule old=${dto.meeting_id} new=${newMeeting.id} starts=${newStarts.toISOString()}`,
    );

    return ok({
      action: 'reschedule',
      old_meeting_id: dto.meeting_id,
      new_meeting_id: newMeeting.id,
      new_starts_at: newMeeting.starts_at,
      confirmation_message: `Remarcado. Vou anotar pra ${formatPtBr(newStarts)}.`,
    });
  }

  async scheduleMeeting(dto: ScheduleMeetingDto): Promise<ToolResponse> {
    const startsAt = new Date(dto.starts_at);
    if (Number.isNaN(startsAt.getTime())) return fail('invalid starts_at', 400);
    if (startsAt.getTime() < Date.now() + 5 * 60_000) {
      return fail('starts_at must be at least 5 min in the future', 400);
    }

    const callRows = await this.dataSource.query<
      {
        id: string;
        account_id: string;
        conversation_id: string | null;
        from_number: string | null;
        classification: Record<string, unknown> | null;
      }[]
    >(
      `SELECT id, account_id, conversation_id, from_number, classification FROM voice_calls WHERE source_id = $1 LIMIT 1`,
      [dto.conversation_id],
    );
    const call = callRows[0];
    if (!call) return fail('voice_call not found for conversation_id', 404);

    const doctorRows = await this.dataSource.query<
      {
        id: string;
        name: string;
        specialty: string | null;
        default_duration_minutes: number;
      }[]
    >(
      `SELECT id, name, specialty, default_duration_minutes FROM doctors
       WHERE id = $1 AND account_id = $2 AND active = true LIMIT 1`,
      [dto.doctor_id, call.account_id],
    );
    const doctor = doctorRows[0];
    if (!doctor) return fail('doctor not found in this clinic', 404);

    const durationMin = clampInt(
      dto.duration_minutes ?? doctor.default_duration_minutes ?? 30,
      15,
      240,
    );
    const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);

    const modality = ((): string | null => {
      const m = dto.modality?.toLowerCase();
      if (!m) return null;
      if (m.includes('tele') || m.includes('online') || m.includes('video'))
        return 'teleconsulta';
      return 'presencial';
    })();

    let contactId: string | null = null;
    if (call.conversation_id) {
      const convRows = await this.dataSource.query<
        { contact_id: string | null }[]
      >(`SELECT contact_id FROM conversations WHERE id = $1 LIMIT 1`, [
        call.conversation_id,
      ]);
      contactId = convRows[0]?.contact_id ?? null;
    }
    if (!contactId && call.from_number) {
      const cRows = await this.dataSource.query<{ id: string }[]>(
        `SELECT id FROM contacts WHERE account_id = $1 AND phone_number = $2 LIMIT 1`,
        [call.account_id, call.from_number],
      );
      contactId = cRows[0]?.id ?? null;
    }

    const conflicts = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM scheduled_meetings
       WHERE account_id = $1 AND doctor_id = $2 AND status = 'scheduled' AND starts_at < $3 AND ends_at > $4`,
      [call.account_id, dto.doctor_id, endsAt, startsAt],
    );
    if (conflicts.length > 0) {
      return fail('slot already booked for this doctor', 409, {
        conflict_meeting_id: conflicts[0].id,
      });
    }

    const briefing =
      (call.classification?.briefing as Record<string, unknown> | undefined) ??
      null;
    const summary =
      (call.classification?.summary as string | undefined) ?? null;
    const title = dto.title ?? `Consulta com ${doctor.name}`;

    let inviteeName: string | null = null;
    let inviteePhone: string | null = call.from_number ?? null;
    let inviteeEmail: string | null = null;
    if (contactId) {
      const cRows = await this.dataSource.query<
        {
          name: string | null;
          email: string | null;
          phone_number: string | null;
        }[]
      >(
        `SELECT name, email, phone_number FROM contacts WHERE id = $1 LIMIT 1`,
        [contactId],
      );
      inviteeName = cRows[0]?.name ?? null;
      inviteeEmail = cRows[0]?.email ?? null;
      inviteePhone = cRows[0]?.phone_number ?? inviteePhone;
    }

    let meeting: { id: string; starts_at: string; ends_at: string } | undefined;
    try {
      const rows = await this.dataSource.query<
        { id: string; starts_at: string; ends_at: string }[]
      >(
        `INSERT INTO scheduled_meetings
           (account_id, contact_id, doctor_id, provider, provider_event_id, title, starts_at, ends_at,
            duration_minutes, status, modality, invitee_name, invitee_email, invitee_phone, briefing, sdr_call_id,
            payload, created_at, updated_at)
         VALUES ($1, $2, $3, 'internal', $4, $5, $6, $7, $8, 'scheduled', $9, $10, $11, $12, $13::jsonb, $14,
                 $15::jsonb, now(), now())
         RETURNING id, starts_at, ends_at`,
        [
          call.account_id,
          contactId,
          dto.doctor_id,
          `nina-${call.id}-${Date.now()}`,
          title,
          startsAt,
          endsAt,
          durationMin,
          modality,
          inviteeName,
          inviteeEmail,
          inviteePhone,
          JSON.stringify(briefing),
          call.id,
          JSON.stringify({
            scheduled_via: 'agent_tool',
            agent_notes: dto.notes ?? null,
            summary,
            doctor_name: doctor.name,
            specialty: doctor.specialty,
          }),
        ],
      );
      meeting = rows[0];
    } catch (err) {
      this.logger.error('insert failed', err as Error);
      return fail('failed to create meeting', 500);
    }
    if (!meeting) return fail('failed to create meeting', 500);

    if (contactId) {
      const stageId = await resolveStageIdByName(
        this.dataSource,
        call.account_id,
        'Reunião agendada',
      );
      if (stageId) {
        await this.dataSource.query(
          `UPDATE contacts SET stage_id = $2, score = 95, updated_at = now() WHERE id = $1`,
          [contactId, stageId],
        );
      }
    }

    this.logger.log(
      `meeting=${meeting.id} doctor=${dto.doctor_id} contact=${contactId} starts=${startsAt.toISOString()}`,
    );

    return ok({
      meeting_id: meeting.id,
      starts_at: meeting.starts_at,
      ends_at: meeting.ends_at,
      doctor_name: doctor.name,
      modality,
      confirmation_message: `Consulta agendada para ${formatPtBr(startsAt)} com ${doctor.name}${modality ? ` (${modality})` : ''}.`,
    });
  }
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
