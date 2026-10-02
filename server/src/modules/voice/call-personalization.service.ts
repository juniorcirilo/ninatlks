import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildSystemPromptWithGuardrails } from './sdr-guardrails.util';
import { transferDepartamento } from '../sales-reps/sales-reps.util';

const PT_LANGUAGE = 'pt';
const PT_BR_LANGUAGE_INSTRUCTION =
  '\n\n# IDIOMA DA LIGAÇÃO\n- Fale exclusivamente em português do Brasil (PT-BR).\n- Use vocabulário, tratamento e pronúncia naturais do Brasil; nunca use português de Portugal.\n- A primeira fala deve ser em português brasileiro.\n- Nunca cumprimente nem responda em inglês.';

export interface PersonalizationPayload {
  caller_id?: string;
  agent_id?: string;
  called_number?: string;
  call_sid?: string;
  dynamic_variables?: Record<string, unknown>;
}

export interface PersonalizationResponse {
  conversation_config_override: {
    agent: {
      prompt: { prompt: string };
      first_message: string;
      language: string;
    };
  };
  dynamic_variables: Record<string, string>;
}

/**
 * Ported from supabase/functions/elevenlabs-personalization — webhook EL
 * calls at the start of every call (inbound and outbound) for live context
 * injection. DataSource direct (pure webhook, no session) — all table
 * access goes through SECURITY DEFINER wrappers (see
 * migrations/20260720210000-CallPersonalizationBypass.ts) since this is the
 * only call site and it never carries a tenant session. Response shape
 * (`conversation_config_override` + `dynamic_variables`, no envelope) is
 * strictly what ElevenLabs expects to configure the live call — must not
 * change without checking their platform docs.
 */
@Injectable()
export class CallPersonalizationService {
  private readonly logger = new Logger(CallPersonalizationService.name);

  constructor(private readonly dataSource: DataSource) {}

  private stringifyVar(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  }

  async personalize(
    payload: PersonalizationPayload,
  ): Promise<PersonalizationResponse> {
    const incomingVars = payload.dynamic_variables ?? {};
    const isOutbound = Boolean(
      incomingVars.campaign_contact_id ||
      incomingVars.meeting_id ||
      (incomingVars.call_purpose && incomingVars.call_purpose !== 'discovery'),
    );

    let accountId: string | null = null;
    let personaName = 'Nina';
    let personaSystemPrompt: string | null = null;
    let personaFirstMessage: string | null = null;

    if (payload.agent_id) {
      const rows = await this.dataSource.query<
        {
          account_id: string;
          name: string;
          system_prompt: string | null;
          first_message: string | null;
        }[]
      >(`SELECT * FROM public.personalization_get_persona_by_el_agent($1)`, [
        payload.agent_id,
      ]);
      const persona = rows[0];
      if (persona) {
        accountId = persona.account_id;
        personaName = persona.name ?? personaName;
        personaSystemPrompt = persona.system_prompt;
        personaFirstMessage = persona.first_message;
      }
    }

    const callerE164 = payload.caller_id ?? '';
    let contactName: string | null = null;
    let contactId: string | null = null;
    let contactScore: number | null = null;
    let openConvCount = 0;
    let lastSummary: string | null = null;

    if (accountId && callerE164) {
      const contactRows = await this.dataSource.query<
        {
          id: string;
          name: string | null;
          score: number | null;
          open_conversations: string;
          dossier_briefing: string | null;
        }[]
      >(`SELECT * FROM public.personalization_get_contact_context($1, $2)`, [
        accountId,
        callerE164,
      ]);
      const contact = contactRows[0];
      if (contact) {
        contactId = contact.id;
        contactName = contact.name;
        contactScore = contact.score;
        openConvCount = Number(contact.open_conversations ?? 0);
        lastSummary = contact.dossier_briefing ?? null;
      }
    }

    const negotiationVars: Record<string, string> = {};

    if (!isOutbound && accountId) {
      const settingsRows = await this.dataSource.query<
        { company_name: string | null; support_phone: string | null }[]
      >(`SELECT * FROM public.personalization_get_company_settings($1)`, [
        accountId,
      ]);
      const settings = settingsRows[0];

      negotiationVars.company_name = settings?.company_name ?? 'sua empresa';
      negotiationVars.agent_name = personaName;
      negotiationVars.support_phone = settings?.support_phone ?? '';
      negotiationVars.call_purpose = 'discovery';

      if (contactName) {
        negotiationVars.lead_name = contactName.split(' ')[0];
      }

      if (contactId) {
        const meetingRows = await this.dataSource.query<
          { id: string; starts_at: Date }[]
        >(`SELECT * FROM public.personalization_get_next_meeting($1, $2)`, [
          accountId,
          contactId,
        ]);
        const nextMeeting = meetingRows[0];
        if (nextMeeting) {
          negotiationVars.has_upcoming_meeting = 'sim';
          negotiationVars.upcoming_meeting_human = new Intl.DateTimeFormat(
            'pt-BR',
            {
              weekday: 'long',
              day: '2-digit',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'America/Sao_Paulo',
            },
          ).format(new Date(nextMeeting.starts_at));
        } else {
          negotiationVars.has_upcoming_meeting = 'não';
        }

        negotiationVars.lead_score = String(contactScore ?? 0);
      }
    }

    const dynamicVariables: Record<string, string> = {
      ...negotiationVars,
      ...Object.fromEntries(
        Object.entries(incomingVars).map(([k, v]) => [k, this.stringifyVar(v)]),
      ),
      agent_name: personaName,
      customer_name:
        contactName ??
        (incomingVars.lead_name as string | undefined) ??
        'cliente',
      caller_phone: callerE164,
      open_conversations: String(openConvCount),
      has_history: openConvCount > 0 ? 'sim' : 'não',
    };

    const contextLines: string[] = [];
    if (contactName) contextLines.push(`O cliente se chama ${contactName}.`);
    if (openConvCount > 0)
      contextLines.push(
        `Tem ${openConvCount} conversa(s) aberta(s) no sistema.`,
      );
    if (lastSummary)
      contextLines.push(`Resumo do cliente: ${lastSummary.slice(0, 300)}`);

    const contextBlock =
      contextLines.length > 0
        ? `\n\n===CONTEXTO DO CLIENTE===\n${contextLines.join('\n')}\n===FIM===`
        : '';

    const promptWithGuardrails = buildSystemPromptWithGuardrails(
      personaSystemPrompt ?? '',
      transferDepartamento({ persona: { name: personaName } }),
    );
    const enrichedPrompt = `${promptWithGuardrails}${contextBlock}${PT_BR_LANGUAGE_INSTRUCTION}`;

    const leadName =
      dynamicVariables.lead_name || contactName?.split(' ')[0] || '';
    const companyName = dynamicVariables.company_name || 'nossa empresa';

    let greeting: string;
    if (personaFirstMessage && personaFirstMessage.trim().length > 0) {
      greeting = personaFirstMessage.replace(
        /\{\{\s*(\w+)\s*\}\}/g,
        (_match, key: string) => {
          const v = dynamicVariables[key];
          return v !== undefined && v !== null ? String(v) : '';
        },
      );
    } else {
      greeting = leadName
        ? `Oi ${leadName}, aqui é ${personaName} da ${companyName}. Esta chamada pode ser gravada. Em que posso ajudar?`
        : `Oi, aqui é ${personaName} da ${companyName}. Esta chamada pode ser gravada. Em que posso ajudar?`;
    }

    this.logger.log(
      `agent=${payload.agent_id} caller=${callerE164} contact=${contactName ?? '(new)'} outbound=${isOutbound} vars=${Object.keys(dynamicVariables).length}`,
    );

    return {
      conversation_config_override: {
        agent: {
          prompt: { prompt: enrichedPrompt },
          first_message: greeting,
          language: PT_LANGUAGE,
        },
      },
      dynamic_variables: dynamicVariables,
    };
  }
}
