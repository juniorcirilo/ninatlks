import { Injectable, Scope } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { ElevenLabsConfigService } from './elevenlabs-config.service';
import {
  ElevenLabsClientService,
  ElevenLabsCredentials,
  ElevenLabsError,
} from './elevenlabs-client.service';
import { buildSystemPromptWithGuardrails } from '../voice/sdr-guardrails.util';
import { SecretsService } from '../secrets/secrets.service';
import { agentLlmProviderMeta } from '../agent-llm-provider/providers';

const PT_LANGUAGE = 'pt';
const PT_BR_LANGUAGE_INSTRUCTION =
  '\n\n# IDIOMA DA LIGAÇÃO\n- Fale exclusivamente em português do Brasil (PT-BR).\n- Use vocabulário, tratamento e pronúncia naturais do Brasil; nunca use português de Portugal.\n- A primeira fala deve ser em português brasileiro.\n- Nunca cumprimente nem responda em inglês.';

interface PersonaRow {
  id: string;
  account_id: string;
  name: string;
  config: Record<string, unknown> | null;
  system_prompt: string | null;
  voice_clone_id: string | null;
  first_message: string | null;
  turn_config: Record<string, unknown> | null;
  tts_config: Record<string, unknown> | null;
  asr_keywords: string[] | null;
  llm_model: string | null;
  llm_custom_url: string | null;
  llm_custom_model_id: string | null;
  llm_temperature: number | null;
  llm_max_tokens: number | null;
  elevenlabs_agent_id: string | null;
  elevenlabs_knowledge_base_ids: string[] | null;
}

function publicApiBase(): string {
  return (process.env.PUBLIC_API_URL ?? 'http://localhost:3001').replace(
    /\/$/,
    '',
  );
}

/**
 * Ported from supabase/functions/elevenlabs-agent-sync,
 * elevenlabs-agent-info, elevenlabs-kb-add, elevenlabs-call-audio —
 * persona↔EL-agent lifecycle + the audio-playback proxy. All frontend-
 * initiated (real session, so Scope.REQUEST via TenantTxHost is safe here,
 * unlike the webhook-facing services in modules/voice/).
 */
@Injectable({ scope: Scope.REQUEST })
export class ElevenLabsAgentService {
  constructor(
    private readonly tx: TenantTxHost,
    private readonly config: ElevenLabsConfigService,
    private readonly client: ElevenLabsClientService,
    private readonly secrets: SecretsService,
  ) {}

  async syncPersona(
    accountId: string,
    personaId: string,
  ): Promise<{ ok: true; elevenlabs_agent_id: string; persona_id: string }> {
    const rows = await this.tx.manager.query<PersonaRow[]>(
      `SELECT id, account_id, name, config, system_prompt, voice_clone_id, first_message,
              turn_config, tts_config, asr_keywords, llm_model, llm_custom_url,
              llm_custom_model_id, llm_temperature,
              llm_max_tokens, elevenlabs_agent_id, elevenlabs_knowledge_base_ids
       FROM agent_personas WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [personaId, accountId],
    );
    const persona = rows[0];
    if (!persona) throw new ElevenLabsError(404, 'persona not found');

    const creds = await this.config.loadAccountCreds(accountId);

    const base = publicApiBase();
    const personalizationWebhook = `${base}/webhooks/elevenlabs/personalization`;
    const eventsWebhook = `${base}/webhooks/elevenlabs/events`;
    const elWebhookSecret = process.env.ELEVENLABS_WEBHOOK_SECRET ?? '';

    const voiceId = persona.voice_clone_id ?? 'cjVigY5qzO86Huf0OWal';
    const systemPrompt = `${buildSystemPromptWithGuardrails(persona.system_prompt ?? '')}${PT_BR_LANGUAGE_INSTRUCTION}`;
    const firstMessage =
      persona.first_message ??
      'Oi {{lead_name}}, aqui é {{agent_name}} da {{company_name}}. Esta chamada pode ser gravada. Em que posso ajudar?';

    const turnCfg = persona.turn_config ?? {};
    const ttsCfg = persona.tts_config ?? {};
    const asrKeywords = Array.isArray(persona.asr_keywords)
      ? persona.asr_keywords
      : [];
    const llmModel = persona.llm_model ?? 'gemini-2.5-flash';
    const customLlm =
      llmModel === 'custom-llm'
        ? await this.resolveCustomLlm(accountId, persona, creds)
        : null;
    const llmTemperature =
      typeof persona.llm_temperature === 'number'
        ? persona.llm_temperature
        : 0.5;
    const llmMaxTokens =
      typeof persona.llm_max_tokens === 'number' &&
      persona.llm_max_tokens >= 200
        ? persona.llm_max_tokens
        : 400;

    const dynamicVariablePlaceholders: Record<string, string> = {
      company_name: 'nossa empresa',
      agent_name: persona.name ?? 'Nina',
      lead_name: 'olá',
      customer_name: 'cliente',
      support_phone: '',
      caller_phone: '',
      call_purpose: 'discovery',
      has_upcoming_meeting: 'não',
      upcoming_meeting_human: '',
      meeting_id: '',
      meeting_starts_at_iso: '',
      meeting_starts_at_human: '',
      attendee_name: '',
      lead_score: '0',
      open_conversations: '0',
      has_history: 'não',
    };

    const evaluationCriteria = [
      {
        id: 'aviso_gravacao',
        name: 'Avisou que a chamada pode ser gravada',
        conversation_goal_prompt:
          'O agente deve informar nos primeiros 30 segundos que a chamada pode ser gravada. Aprovado se mencionou explicitamente gravação. Reprovado se não mencionou.',
      },
      {
        id: 'identificou_se',
        name: 'Identificou-se com nome e empresa',
        conversation_goal_prompt:
          'O agente deve abrir dizendo o próprio nome e o nome da empresa. Aprovado se fez. Reprovado se não.',
      },
      {
        id: 'qualificou_lead',
        name: 'Qualificou o lead com perguntas',
        conversation_goal_prompt:
          'Em call de discovery, o agente deve fazer perguntas para entender quem é o lead, qual a dor e se há fit. Aprovado se fez 3+ perguntas relevantes. Reprovado se só falou.',
      },
      {
        id: 'respeitou_escopo_comercial',
        name: 'Não prometeu preço ou condição comercial',
        conversation_goal_prompt:
          'O agente NÃO deve prometer preço, prazo ou condição comercial — quem fecha é o humano. Aprovado se não prometeu. Reprovado se inventou ou prometeu valores.',
      },
      {
        id: 'respeitou_dnc',
        name: 'Encerrou educadamente em pedido de DNC',
        conversation_goal_prompt:
          'Se o lead pediu DNC, agente deve concordar e encerrar sem insistir. N/A se não houve pedido.',
      },
    ];

    const toolHeaders = elWebhookSecret
      ? { 'x-el-webhook-secret': elWebhookSecret }
      : {};

    // persona.config.kind é o sinal canônico, mas personas mais antigas (ex.:
    // "Diego Cobrança" seedado antes do config.kind existir) ficam com
    // config={}. Mesmo fallback por nome usado em inferAgentKind()
    // (src/lib/webhook-inbound-templates.ts) evita que a persona real fique
    // sem a tool de cobrança só porque o campo nunca foi preenchido.
    const isCobranca =
      (persona.config as Record<string, unknown> | null)?.kind === 'cobranca' ||
      /cobran|inadimpl|d[ií]vida|cart[eé]ira/i.test(persona.name ?? '');
    const cobrancaTool = {
      type: 'webhook',
      name: 'registrar_desfecho_cobranca',
      description:
        "OBRIGATÓRIO antes de despedir em toda call de cobrança (call_purpose=cobranca). Registra o resultado da negociação do título. Use desfecho='wrong_number' se a pessoa negar ser o titular (e não mencione o débito). Preencha valor_prometido/data_prometida SOMENTE se o lead realmente prometeu pagar — NUNCA invente.",
      api_schema: {
        url: `${base}/agent-tools/registrar-desfecho-cobranca`,
        method: 'POST',
        request_headers: {
          ...toolHeaders,
          'x-conversation-id': '{{system__conversation_id}}',
        },
        request_body_schema: {
          type: 'object',
          required: ['desfecho'],
          properties: {
            desfecho: {
              type: 'string',
              enum: [
                'quitou',
                'prometeu_pagar',
                'negociou_parcelas',
                'pediu_boleto',
                'contestou_divida',
                'sem_condicoes',
                'recusou_pagar',
                'no_answer',
                'wrong_number',
              ],
              description: 'Resultado da negociação nesta ligação.',
            },
            valor_prometido: {
              type: 'string',
              description:
                'Valor que o lead prometeu pagar, como falado (ex.: "1240,55"). Só se houve promessa real.',
            },
            data_prometida: {
              type: 'string',
              description:
                'Data prometida para pagamento, formato ISO 8601 (ex.: 2026-08-15). Só se houve promessa real.',
            },
            forma_pagamento: {
              type: 'string',
              description: "Forma combinada, ex.: 'pix', 'boleto', 'cartao', 'parcelado'.",
            },
            observacao: {
              type: 'string',
              description: 'Anotação livre pro time financeiro (objeções, contexto).',
            },
          },
        },
      },
      dynamic_variables: {
        conversation_id: '{{system__conversation_id}}',
      },
    };

    const agentBody = {
      name: `Nexus: ${persona.name}`,
      conversation_config: {
        // 'elevenlabs' (Original ASR) foi removido pela ElevenLabs e os agentes
        // existentes migrados para Scribe v2 Realtime; mandar o valor antigo
        // agora é 400 na criação e no PATCH do agente.
        asr: {
          quality: 'high',
          provider: 'scribe_realtime',
          keywords: asrKeywords,
        },
        turn: {
          turn_timeout:
            typeof turnCfg.turn_timeout === 'number' ? turnCfg.turn_timeout : 3,
          silence_end_call_timeout:
            typeof turnCfg.silence_end_call_timeout === 'number'
              ? turnCfg.silence_end_call_timeout
              : 30,
          turn_eagerness: (turnCfg.turn_eagerness as string) ?? 'eager',
        },
        tts: {
          model_id: 'eleven_flash_v2_5',
          voice_id: voiceId,
          stability:
            typeof ttsCfg.stability === 'number' ? ttsCfg.stability : 0.35,
          speed: typeof ttsCfg.speed === 'number' ? ttsCfg.speed : 1.05,
          similarity_boost:
            typeof ttsCfg.similarity_boost === 'number'
              ? ttsCfg.similarity_boost
              : 0.85,
        },
        conversation: { text_only: false, max_duration_seconds: 600 },
        agent: {
          first_message: firstMessage,
          language: PT_LANGUAGE,
          dynamic_variables: {
            dynamic_variable_placeholders: dynamicVariablePlaceholders,
          },
          prompt: {
            prompt: systemPrompt,
            llm: llmModel,
            custom_llm: customLlm,
            temperature: llmTemperature,
            max_tokens: llmMaxTokens,
            tools: [
              {
                type: 'webhook',
                name: 'ver_disponibilidade',
                description:
                  "Consulta horários livres na agenda dos médicos da clínica. Use ANTES de tentar agendar. Pode filtrar por especialidade (ex.: 'Ortopedia') ou por nome do médico. Retorna friendly_message com até 4 opções formatadas em PT-BR pra você ler em voz alta — cada slot já vem com doctor_id que você usa em agendar_reuniao.",
                api_schema: {
                  url: `${base}/agent-tools/get-availability`,
                  method: 'POST',
                  request_headers: toolHeaders,
                  request_body_schema: {
                    type: 'object',
                    required: ['conversation_id'],
                    properties: {
                      conversation_id: {
                        type: 'string',
                        description:
                          'ID da conversa atual (system var conversation_id).',
                      },
                      specialty: {
                        type: 'string',
                        description:
                          "Especialidade médica solicitada pelo paciente (ex.: 'Ortopedia esportiva', 'Fisiatria', 'Nutrição esportiva'). Match parcial.",
                      },
                      doctor_name: {
                        type: 'string',
                        description:
                          "Nome (ou parte) do médico, se o paciente pedir alguém específico (ex.: 'Dr. João'). Match parcial.",
                      },
                      duration_minutes: {
                        type: 'integer',
                        description:
                          'Duração desejada em minutos. Default: duração padrão do médico (geralmente 30).',
                      },
                      days_ahead: {
                        type: 'integer',
                        description:
                          'Janela de busca em dias (default 14, máx 30).',
                      },
                      max_options: {
                        type: 'integer',
                        description: 'Quantas opções devolver (default 4).',
                      },
                    },
                  },
                },
                dynamic_variables: {
                  conversation_id: '{{system__conversation_id}}',
                },
              },
              {
                type: 'webhook',
                name: 'agendar_reuniao',
                description:
                  'Marca a consulta na agenda do médico. CHAME quando o paciente confirmar um horário que você ofereceu via ver_disponibilidade. Use exatamente o doctor_id e starts_at do slot escolhido. Antes de chamar, repita o horário, médico e modalidade em voz alta e peça confirmação. Após sucesso, leia o confirmation_message.',
                api_schema: {
                  url: `${base}/agent-tools/schedule-meeting`,
                  method: 'POST',
                  request_headers: toolHeaders,
                  request_body_schema: {
                    type: 'object',
                    required: ['conversation_id', 'doctor_id', 'starts_at'],
                    properties: {
                      conversation_id: {
                        type: 'string',
                        description:
                          'ID da conversa atual (system var conversation_id).',
                      },
                      doctor_id: {
                        type: 'string',
                        description:
                          'ID do médico, retornado em cada slot pelo ver_disponibilidade. Obrigatório.',
                      },
                      starts_at: {
                        type: 'string',
                        description:
                          'ISO8601 do horário escolhido (ex.: 2026-04-30T14:00:00-03:00). Use exatamente um starts_at devolvido por ver_disponibilidade.',
                      },
                      duration_minutes: {
                        type: 'integer',
                        description:
                          'Duração em minutos. Default: padrão do médico (geralmente 30).',
                      },
                      modality: {
                        type: 'string',
                        description:
                          "Modalidade: 'presencial' ou 'teleconsulta'. Pergunte ao paciente.",
                      },
                      title: {
                        type: 'string',
                        description:
                          "Título da consulta. Default: 'Consulta com {nome do médico}'.",
                      },
                      notes: {
                        type: 'string',
                        description:
                          'Observações livres (motivo da falta anterior, queixa, preferências do paciente).',
                      },
                    },
                  },
                },
                dynamic_variables: {
                  conversation_id: '{{system__conversation_id}}',
                },
              },
              {
                type: 'webhook',
                name: 'confirmar_reuniao',
                description:
                  'USE APENAS em call de lembrete (call_purpose=reminder), quando o lead confirmar verbalmente que vai comparecer. Marca a reunião como confirmada. Após sucesso, leia o confirmation_message.',
                api_schema: {
                  url: `${base}/agent-tools/confirm-meeting`,
                  method: 'POST',
                  request_headers: toolHeaders,
                  request_body_schema: {
                    type: 'object',
                    required: ['conversation_id', 'meeting_id'],
                    properties: {
                      conversation_id: {
                        type: 'string',
                        description: 'ID da conversa atual.',
                      },
                      meeting_id: {
                        type: 'string',
                        description:
                          'ID da reunião sendo confirmada (system var meeting_id).',
                      },
                    },
                  },
                },
                dynamic_variables: {
                  conversation_id: '{{system__conversation_id}}',
                  meeting_id: '{{meeting_id}}',
                },
              },
              {
                type: 'webhook',
                name: 'remarcar_reuniao',
                description:
                  "USE em call de lembrete OU de no-show quando o lead pedir pra remarcar ou cancelar. Para remarcar use action='reschedule' + new_starts_at (consultado via ver_disponibilidade). Para cancelar use action='cancel'. Após sucesso leia o confirmation_message.",
                api_schema: {
                  url: `${base}/agent-tools/reschedule-meeting`,
                  method: 'POST',
                  request_headers: toolHeaders,
                  request_body_schema: {
                    type: 'object',
                    required: ['conversation_id', 'meeting_id', 'action'],
                    properties: {
                      conversation_id: {
                        type: 'string',
                        description: 'ID da conversa atual.',
                      },
                      meeting_id: {
                        type: 'string',
                        description:
                          'ID da reunião original (system var meeting_id).',
                      },
                      action: {
                        type: 'string',
                        enum: ['reschedule', 'cancel'],
                        description:
                          "'reschedule' cria nova reunião e marca a antiga como rescheduled. 'cancel' marca como canceled.",
                      },
                      new_starts_at: {
                        type: 'string',
                        description:
                          'ISO8601 do novo horário (obrigatório se action=reschedule). Use slot vindo de ver_disponibilidade.',
                      },
                      duration_minutes: {
                        type: 'integer',
                        description:
                          'Duração em minutos (default = duração da original).',
                      },
                      reason: {
                        type: 'string',
                        description:
                          'Motivo da remarcação ou cancelamento (resumo curto).',
                      },
                    },
                  },
                },
                dynamic_variables: {
                  conversation_id: '{{system__conversation_id}}',
                  meeting_id: '{{meeting_id}}',
                },
              },
              {
                type: 'webhook',
                name: 'qualificar_lead',
                description:
                  "CHAME ANTES DE DESPEDIR em toda call de discovery (call_purpose=discovery). Registra o lead qualificado no pipeline com fase, sentimento, dor e próxima ação. Use null em campos que não conseguiu confirmar — NUNCA invente dado. Se for DNC, motivo_descarte='dnc' adiciona no bloqueio automático.",
                api_schema: {
                  url: `${base}/agent-tools/qualify-lead`,
                  method: 'POST',
                  request_headers: {
                    ...toolHeaders,
                    'x-conversation-id': '{{system__conversation_id}}',
                  },
                  request_body_schema: {
                    type: 'object',
                    required: ['fase_pipeline', 'sentimento'],
                    properties: {
                      nome: {
                        type: 'string',
                        description: 'Nome completo do lead.',
                      },
                      telefone: {
                        type: 'string',
                        description:
                          'Melhor telefone de retorno (E.164 quando possível, ex: +5511999998888).',
                      },
                      email: { type: 'string', description: 'E-mail do lead.' },
                      cidade: {
                        type: 'string',
                        description: 'Cidade do lead.',
                      },
                      uf: {
                        type: 'string',
                        description: 'Sigla da UF, ex: SP.',
                      },
                      empresa: {
                        type: 'string',
                        description: 'Razão social ou nome fantasia.',
                      },
                      cnpj: {
                        type: 'string',
                        description: 'Apenas dígitos (14 chars).',
                      },
                      dor_principal: {
                        type: 'string',
                        description: 'Resumo da dor relatada pelo lead.',
                      },
                      ferramenta_atual: {
                        type: 'string',
                        description: 'Sistema/processo que o lead usa hoje.',
                      },
                      interesse: {
                        type: 'string',
                        enum: ['alto', 'medio', 'baixo', 'descartado'],
                        description:
                          'Nível de interesse percebido durante a chamada.',
                      },
                      fase_pipeline: {
                        type: 'string',
                        enum: [
                          'novo_lead',
                          'qualificado',
                          'demo_agendada',
                          'proposta',
                          'descartado',
                        ],
                        description:
                          'Fase do funil. demo_agendada SÓ se realmente agendou via agendar_reuniao.',
                      },
                      sentimento: {
                        type: 'string',
                        enum: ['positivo', 'neutro', 'negativo'],
                        description: 'Humor predominante do lead na chamada.',
                      },
                      temperatura: {
                        type: 'string',
                        enum: ['quente', 'morno', 'frio'],
                        description:
                          'Probabilidade de virar cliente. quente = dor + orçamento + decisão + urgência.',
                      },
                      motivo_descarte: {
                        type: 'string',
                        enum: [
                          'sem_fit',
                          'sem_orcamento',
                          'concorrente',
                          'dnc',
                          'outro',
                        ],
                        description:
                          'Preencher SOMENTE se fase_pipeline=descartado.',
                      },
                      proxima_acao: {
                        type: 'string',
                        enum: [
                          'agendar_demo',
                          'enviar_material',
                          'recontato',
                          'nenhuma',
                        ],
                        description: 'Próximo passo combinado com o lead.',
                      },
                      observacao: {
                        type: 'string',
                        description:
                          'Anotação livre pro time comercial (objeções, contexto, sugestões).',
                      },
                    },
                  },
                },
                dynamic_variables: {
                  conversation_id: '{{system__conversation_id}}',
                },
              },
              ...(isCobranca ? [cobrancaTool] : []),
            ],
            tool_ids: [],
            knowledge_base: persona.elevenlabs_knowledge_base_ids ?? [],
          },
        },
      },
      platform_settings: {
        call_initiation: {
          enable_conversation_initiation_webhook: true,
          conversation_initiation_webhook: {
            url: personalizationWebhook,
            request_headers: elWebhookSecret
              ? { 'x-el-webhook-secret': elWebhookSecret }
              : {},
          },
        },
        webhook: { url: eventsWebhook, secret: elWebhookSecret || undefined },
        evaluation: { criteria: evaluationCriteria },
        overrides: {
          enable_conversation_initiation_client_data_from_webhook: true,
          conversation_config_override: {
            agent: {
              first_message: true,
              language: true,
              prompt: { prompt: true },
            },
            asr: { keywords: true },
            tts: { voice_id: true },
          },
        },
      },
    };

    let elAgentId = persona.elevenlabs_agent_id;

    if (elAgentId) {
      try {
        await this.client.request({
          method: 'PATCH',
          path: `/v1/convai/agents/${elAgentId}`,
          credentials: creds,
          json: agentBody,
        });
      } catch (err) {
        if (err instanceof ElevenLabsError && err.status === 404) {
          const created = await this.client.request<{
            agent_id?: string;
            id?: string;
          }>({
            method: 'POST',
            path: '/v1/convai/agents/create',
            credentials: creds,
            json: agentBody,
          });
          elAgentId = created.agent_id ?? created.id ?? null;
        } else {
          throw err;
        }
      }
    } else {
      const created = await this.client.request<{
        agent_id?: string;
        id?: string;
      }>({
        method: 'POST',
        path: '/v1/convai/agents/create',
        credentials: creds,
        json: agentBody,
      });
      elAgentId = created.agent_id ?? created.id ?? null;
    }

    if (!elAgentId)
      throw new ElevenLabsError(502, 'ElevenLabs did not return an agent id');

    await this.tx.manager.query(
      `UPDATE agent_personas SET elevenlabs_agent_id = $2, updated_at = now() WHERE id = $1`,
      [persona.id, elAgentId],
    );

    return { ok: true, elevenlabs_agent_id: elAgentId, persona_id: persona.id };
  }

  /**
   * Resolve a config de LLM próprio pra este agente: URL/model_id do próprio
   * agente quando preenchidos, senão o "Provedor de IA do Agente" da conta
   * (vault, provider 'agent-llm' — mesmo seletor usado pelos Funcionários IA
   * de texto em Configurações → Integrações), com fallback pro 'custom-llm'
   * legado (contas que configuraram antes do seletor existir). A API key não
   * pode ir em texto claro para a ElevenLabs — ela exige uma referência a um
   * "workspace secret" dela; por isso criamos/reaproveitamos esse secret via
   * API antes de montar o payload.
   *
   * Anthropic não entra aqui: o custom_llm da ElevenLabs assume um endpoint
   * OpenAI-compatible (POST {url}/chat/completions) — a Messages API da
   * Anthropic tem formato próprio que a ElevenLabs não fala. Falha cedo, na
   * sincronização, em vez de quebrar silenciosamente numa ligação real (foi
   * exatamente esse tipo de falha silenciosa — custom-llm apontando pra um IP
   * inalcançável — que derrubou a campanha original).
   */
  private async resolveCustomLlm(
    accountId: string,
    persona: PersonaRow,
    creds: ElevenLabsCredentials,
  ): Promise<{
    url: string;
    model_id?: string;
    api_key?: { secret_id: string };
  }> {
    const agentLlm = await this.secrets.getInternalBulk(accountId, 'agent-llm');
    const providerId = (agentLlm.provider ?? '').trim();

    let defaultUrl = '';
    let defaultModelId = '';
    let defaultApiKey = '';

    if (providerId) {
      const meta = agentLlmProviderMeta(providerId);
      if (meta.kind === 'anthropic') {
        throw new ElevenLabsError(
          400,
          `O "Provedor de IA do Agente" da conta está em Anthropic (Claude), que não é compatível com agentes de voz — a ElevenLabs só integra com endpoints no formato OpenAI. Escolha outro provedor (OpenAI, Gemini, Groq, DeepSeek, Mistral, Ollama ou LM Studio) em Configurações → Integrações, ou defina uma URL própria na aba Modelo do agente "${persona.name}".`,
        );
      }
      defaultUrl = (agentLlm.base_url || meta.defaultBaseUrl || '').trim();
      defaultModelId = (agentLlm.model_id ?? '').trim();
      defaultApiKey = (agentLlm.api_key ?? '').trim();
    } else {
      const legacy = await this.secrets.getInternalBulk(accountId, 'custom-llm');
      defaultUrl = (legacy.api_url ?? '').trim();
      defaultModelId = (legacy.model_id ?? '').trim();
      defaultApiKey = (legacy.api_key ?? '').trim();
    }

    const url = (persona.llm_custom_url || defaultUrl || '').trim();
    if (!url) {
      throw new ElevenLabsError(
        400,
        `Agente "${persona.name}" está configurado para IA própria (custom-llm), mas não há URL definida — configure em Configurações → Integrações → Provedor de IA do Agente, ou na aba Modelo deste agente.`,
      );
    }
    const modelId = (persona.llm_custom_model_id || defaultModelId || '').trim();

    if (!defaultApiKey) {
      return { url, ...(modelId ? { model_id: modelId } : {}) };
    }

    const secretId = await this.ensureElevenLabsSecret(
      accountId,
      defaultApiKey,
      creds,
    );
    return {
      url,
      ...(modelId ? { model_id: modelId } : {}),
      api_key: { secret_id: secretId },
    };
  }

  /**
   * Cria (ou atualiza, se o valor mudou) o secret de workspace na ElevenLabs
   * que guarda a API key do LLM próprio, e devolve o `secret_id`. O hash fica
   * nos metadados do vault local só para saber "já criei esse valor exato lá
   * fora?" sem reenviar a chave à toa a cada sincronização — criar um secret
   * novo por sync acumularia lixo no workspace do cliente.
   */
  private async ensureElevenLabsSecret(
    accountId: string,
    apiKey: string,
    creds: ElevenLabsCredentials,
  ): Promise<string> {
    const hash = createHash('sha256').update(apiKey).digest('hex');
    const existing = await this.secrets.list(accountId);
    const entry = existing.find(
      (e) => e.provider === 'custom-llm' && e.key_name === 'api_key',
    );
    const cachedSecretId = entry?.metadata?.elevenlabs_secret_id as
      | string
      | undefined;
    const cachedHash = entry?.metadata?.value_hash as string | undefined;

    if (cachedSecretId && cachedHash === hash) {
      return cachedSecretId;
    }

    const name = `nina-talks-custom-llm-${accountId}`;
    let secretId: string | undefined;
    if (cachedSecretId) {
      // Valor mudou: atualiza o secret existente em vez de criar outro.
      try {
        await this.client.request({
          method: 'PATCH',
          path: `/v1/convai/secrets/${cachedSecretId}`,
          credentials: creds,
          json: { type: 'update', name, value: apiKey },
        });
        secretId = cachedSecretId;
      } catch (err) {
        // Secret cacheado pertence a outro workspace ElevenLabs (chave da
        // conta foi trocada) — não existe mais lá, cria um novo.
        if (!(err instanceof ElevenLabsError && err.status === 404)) throw err;
      }
    }
    if (!secretId) {
      const created = await this.client.request<{ secret_id: string }>({
        method: 'POST',
        path: '/v1/convai/secrets',
        credentials: creds,
        json: { type: 'new', name, value: apiKey },
      });
      secretId = created.secret_id;
    }

    // Reescreve o mesmo valor só para carimbar o hash/secret_id novos nos
    // metadados — é o registro de "já sincronizei isso com a ElevenLabs".
    await this.secrets.set(accountId, 'custom-llm', 'api_key', apiKey, {
      elevenlabs_secret_id: secretId,
      value_hash: hash,
    });

    return secretId;
  }

  async getAgentInfo(
    accountId: string,
    agentId: string,
  ): Promise<
    | { agent_id: string; found: false }
    | {
        agent_id: string;
        found: true;
        name: string | null;
        language: string | null;
        first_message: string | null;
        model_id: string | null;
        voice_id: string | null;
      }
  > {
    const creds = await this.config.loadAccountCreds(accountId);
    try {
      const data = await this.client.request<{
        name?: string;
        conversation_config?: {
          agent?: { language?: string; first_message?: string };
          tts?: { model_id?: string; voice_id?: string };
        };
      }>({
        method: 'GET',
        path: `/v1/convai/agents/${encodeURIComponent(agentId)}`,
        credentials: creds,
      });
      return {
        agent_id: agentId,
        found: true,
        name: data.name ?? null,
        language: data.conversation_config?.agent?.language ?? null,
        first_message: data.conversation_config?.agent?.first_message ?? null,
        model_id: data.conversation_config?.tts?.model_id ?? null,
        voice_id: data.conversation_config?.tts?.voice_id ?? null,
      };
    } catch (err) {
      if (err instanceof ElevenLabsError && err.status === 404) {
        return { agent_id: agentId, found: false };
      }
      throw err;
    }
  }

  async addKnowledgeBaseDocument(
    accountId: string,
    input: {
      personaId: string;
      name: string;
      type?: 'url' | 'text' | 'file';
      url?: string;
      text?: string;
    },
  ): Promise<{ ok: true; document_id: string; knowledge_base_ids: string[] }> {
    const rows = await this.tx.manager.query<
      {
        id: string;
        account_id: string;
        elevenlabs_agent_id: string | null;
        elevenlabs_knowledge_base_ids: string[] | null;
      }[]
    >(
      `SELECT id, account_id, elevenlabs_agent_id, elevenlabs_knowledge_base_ids
       FROM agent_personas WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [input.personaId, accountId],
    );
    const persona = rows[0];
    if (!persona) throw new ElevenLabsError(404, 'persona not found');
    if (!persona.elevenlabs_agent_id) {
      throw new ElevenLabsError(
        409,
        'persona must be synced to ElevenLabs first',
      );
    }

    const creds = await this.config.loadAccountCreds(accountId);
    const type = input.type === 'url' || input.url ? 'url' : 'text';

    const doc = await this.client.request<{ id: string }>({
      method: 'POST',
      path:
        type === 'url'
          ? '/v1/convai/knowledge-base/url'
          : '/v1/convai/knowledge-base/text',
      credentials: creds,
      json:
        type === 'url'
          ? { url: input.url, name: input.name }
          : { text: input.text, name: input.name },
    });

    const currentKb = Array.isArray(persona.elevenlabs_knowledge_base_ids)
      ? persona.elevenlabs_knowledge_base_ids
      : [];
    const nextKb = [...currentKb, doc.id];

    await this.client.request({
      method: 'PATCH',
      path: `/v1/convai/agents/${persona.elevenlabs_agent_id}`,
      credentials: creds,
      json: {
        conversation_config: { agent: { prompt: { knowledge_base: nextKb } } },
      },
    });

    await this.tx.manager.query(
      `UPDATE agent_personas SET elevenlabs_knowledge_base_ids = $2::jsonb, updated_at = now() WHERE id = $1`,
      [persona.id, JSON.stringify(nextKb)],
    );

    return { ok: true, document_id: doc.id, knowledge_base_ids: nextKb };
  }

  async getCallAudio(
    accountId: string,
    voiceCallId: string,
  ): Promise<
    | { kind: 'redirect'; url: string }
    | { kind: 'stream'; contentType: string; body: Buffer }
    | { kind: 'fallback'; error: string; status: number; detail: string }
  > {
    const rows = await this.tx.manager.query<
      {
        id: string;
        account_id: string;
        source_id: string | null;
        recording_url: string | null;
      }[]
    >(
      `SELECT id, account_id, source_id, recording_url FROM voice_calls WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [voiceCallId, accountId],
    );
    const call = rows[0];
    if (!call) throw new ElevenLabsError(404, 'call not found');

    if (call.recording_url) {
      return { kind: 'redirect', url: call.recording_url };
    }
    if (!call.source_id) {
      throw new ElevenLabsError(
        404,
        'no recording available (ElevenLabs conversation_id missing)',
      );
    }

    const creds = await this.config.loadAccountCreds(accountId);
    try {
      const res = await this.client.request<Response>({
        method: 'GET',
        path: `/v1/convai/conversations/${encodeURIComponent(call.source_id)}/audio`,
        credentials: creds,
        raw: true,
      });
      if (!res.ok) {
        return {
          kind: 'fallback',
          error:
            res.status === 404 ? 'AUDIO_NOT_AVAILABLE' : 'AUDIO_FETCH_FAILED',
          status: res.status,
          detail:
            res.status === 404
              ? 'Áudio ainda não disponível para esta chamada.'
              : 'Não foi possível buscar o áudio da chamada no momento.',
        };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        kind: 'stream',
        contentType: res.headers.get('content-type') ?? 'audio/mpeg',
        body: buf,
      };
    } catch {
      return {
        kind: 'fallback',
        error: 'AUDIO_FETCH_FAILED',
        status: 502,
        detail: 'Não foi possível buscar o áudio da chamada no momento.',
      };
    }
  }
}
