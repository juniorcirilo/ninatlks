// Sync a Nexus persona to an ElevenLabs Conversational AI agent.
//
// Called by:
//   1. The /agents edit dialog when the user saves a persona (via client).
//   2. Future: automated nightly reconciliation cron.
//
// On first sync: creates the EL agent and writes elevenlabs_agent_id back.
// On subsequent syncs: PATCHes the agent with the latest prompt + voice.
//
// EL Agent ← Persona fields:
//   name              → name
//   system_prompt     → conversational_config.agent.prompt.prompt
//   voice_clone_id    → conversational_config.tts.voice_id
//   description       → used in first_message heuristic
//   elevenlabs_agent_id → persisted back after create
//
// Also configures:
//   - Personalization webhook → our elevenlabs-personalization fn (per-caller ctx)
//   - Post-call webhook       → our elevenlabs-events fn (transcript + analytics)
//   - Language: pt-BR
//   - LLM: gemini-2.5-flash (configurable per-persona in future)
//   - Model: eleven_flash_v2_5 (required for non-English agents)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { resolveCredentialsForAccount, ElevenLabsError } from "../_shared/elevenlabs/index.ts";
import { buildSystemPromptWithGuardrails } from "../_shared/voice/sdr-guardrails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EL_BASE = "https://api.elevenlabs.io";

async function elRequest(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const res = await fetch(`${EL_BASE}${path}`, {
    method,
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`EL ${method} ${path} → ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return j({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) return j({ error: "unauthorized" }, 401);

  let body: { persona_id: string };
  try {
    body = await req.json();
  } catch {
    return j({ error: "body must be JSON" }, 400);
  }
  if (!body.persona_id) return j({ error: "persona_id required" }, 400);

  const { data: persona, error: pErr } = await admin
    .from("agent_personas")
    .select("*")
    .eq("id", body.persona_id)
    .maybeSingle();
  if (pErr || !persona) return j({ error: "persona not found" }, 404);

  // Verify caller belongs to the same account.
  const { data: membership } = await admin
    .from("account_users")
    .select("account_id")
    .eq("user_id", u.user.id)
    .eq("account_id", persona.account_id)
    .maybeSingle();
  if (!membership) return j({ error: "forbidden" }, 403);

  let apiKey = "";
  try {
    const creds = await resolveCredentialsForAccount(admin, persona.account_id);
    apiKey = creds.apiKey;
  } catch (e) {
    const msg = e instanceof ElevenLabsError ? e.message : (e instanceof Error ? e.message : "ElevenLabs key unavailable");
    return j({ error: msg }, 503);
  }

  // Build the webhook URLs pointing back to our edge functions.
  const nexusBase = supabaseUrl.replace(/\/$/, "");
  const personalizationWebhook = `${nexusBase}/functions/v1/elevenlabs-personalization`;
  const eventsWebhook = `${nexusBase}/functions/v1/elevenlabs-events`;
  const elWebhookSecret = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";

  const voiceId = persona.voice_clone_id ?? "cjVigY5qzO86Huf0OWal";
  const rawSystemPrompt = (persona.system_prompt as string | null) ?? "";
  // Injeta header de regras SDR automaticamente — usuário pode escrever
  // prompt curto sem variáveis e mesmo assim o agente recebe contexto
  // por call_purpose, fluxo de qualificação e instruções das tools.
  const systemPrompt = buildSystemPromptWithGuardrails(rawSystemPrompt);
  const firstMessage = (persona.first_message as string | null) ??
    `Oi {{lead_name}}, aqui é {{agent_name}} da {{company_name}}. Esta chamada pode ser gravada. Em que posso ajudar?`;

  // Advanced config with fallback defaults for personas created before
  // the migration added these columns.
  const turnCfg = (persona.turn_config ?? {}) as Record<string, any>;
  const ttsCfg = (persona.tts_config ?? {}) as Record<string, any>;
  const asrKeywords = Array.isArray(persona.asr_keywords) ? persona.asr_keywords : [];
  const llmModel = (persona.llm_model as string | null) ?? "gemini-2.5-flash";
  const llmTemperature = typeof persona.llm_temperature === "number"
    ? persona.llm_temperature
    : 0.5;
  // Default 400 (era 150). Com 150 o agente cortava no meio da frase ao
  // apresentar débito + ofertas. 400 cobre apresentação completa sem ficar
  // verboso demais (ainda é "respostas curtas" — EL/TTS aceita bem).
  const llmMaxTokens = typeof persona.llm_max_tokens === "number" && persona.llm_max_tokens >= 200
    ? persona.llm_max_tokens
    : 400;

  // Defaults pra cada {{var}} usada no prompt. Se a chamada não passar a var
  // (ex.: ligação manual sem débito vinculado), o EL substitui pelo default
  // ao invés de deixar literal "{{valor_formatado}}" no prompt — o que faria
  // o LLM improvisar um valor.
  const dynamicVariablePlaceholders: Record<string, string> = {
    company_name: "nossa empresa",
    agent_name: persona.name ?? "Nina",
    lead_name: "olá",
    customer_name: "cliente",
    support_phone: "",
    caller_phone: "",
    call_purpose: "discovery",
    has_upcoming_meeting: "não",
    upcoming_meeting_human: "",
    meeting_id: "",
    meeting_starts_at_iso: "",
    meeting_starts_at_human: "",
    attendee_name: "",
    lead_score: "0",
    open_conversations: "0",
    has_history: "não",
  };

  // Critérios de avaliação automática — rodam ao final de cada chamada.
  const evaluationCriteria = [
    {
      id: "aviso_gravacao",
      name: "Avisou que a chamada pode ser gravada",
      conversation_goal_prompt:
        "O agente deve informar nos primeiros 30 segundos que a chamada pode ser gravada. Aprovado se mencionou explicitamente gravação. Reprovado se não mencionou.",
    },
    {
      id: "identificou_se",
      name: "Identificou-se com nome e empresa",
      conversation_goal_prompt:
        "O agente deve abrir dizendo o próprio nome e o nome da empresa. Aprovado se fez. Reprovado se não.",
    },
    {
      id: "qualificou_lead",
      name: "Qualificou o lead com perguntas",
      conversation_goal_prompt:
        "Em call de discovery, o agente deve fazer perguntas para entender quem é o lead, qual a dor e se há fit. Aprovado se fez 3+ perguntas relevantes. Reprovado se só falou.",
    },
    {
      id: "respeitou_escopo_comercial",
      name: "Não prometeu preço ou condição comercial",
      conversation_goal_prompt:
        "O agente NÃO deve prometer preço, prazo ou condição comercial — quem fecha é o humano. Aprovado se não prometeu. Reprovado se inventou ou prometeu valores.",
    },
    {
      id: "respeitou_dnc",
      name: "Encerrou educadamente em pedido de DNC",
      conversation_goal_prompt:
        "Se o lead pediu DNC, agente deve concordar e encerrar sem insistir. N/A se não houve pedido.",
    },
  ];

  // ÚNICA chave de config — `conversation_config` (singular) é a oficial da API EL.
  // Antes tínhamos `conversational_config` E `conversation_config` duplicados; EL
  // descartava silenciosamente o `conversational_config` (incluindo personalization
  // webhook, dynamic var defaults, turn config, first_message). Agora tudo num lugar só.
  const agentBody = {
    name: `Nexus: ${persona.name}`,
    conversation_config: {
      asr: {
        quality: "high",
        provider: "elevenlabs",
        keywords: asrKeywords,
      },
      turn: {
        turn_timeout: typeof turnCfg.turn_timeout === "number" ? turnCfg.turn_timeout : 3,
        silence_end_call_timeout:
          typeof turnCfg.silence_end_call_timeout === "number"
            ? turnCfg.silence_end_call_timeout
            : 30,
        turn_eagerness: (turnCfg.turn_eagerness as string) ?? "eager",
      },
      tts: {
        model_id: "eleven_flash_v2_5",
        voice_id: voiceId,
        stability: typeof ttsCfg.stability === "number" ? ttsCfg.stability : 0.35,
        speed: typeof ttsCfg.speed === "number" ? ttsCfg.speed : 1.05,
        similarity_boost:
          typeof ttsCfg.similarity_boost === "number" ? ttsCfg.similarity_boost : 0.85,
      },
      conversation: {
        text_only: false,
        max_duration_seconds: 600,
      },
      agent: {
        first_message: firstMessage,
        language: "pt",
        dynamic_variables: {
          dynamic_variable_placeholders: dynamicVariablePlaceholders,
        },
        prompt: {
          prompt: systemPrompt,
          llm: llmModel,
          temperature: llmTemperature,
          max_tokens: llmMaxTokens,
          tools: [
            {
              type: "webhook",
              name: "ver_disponibilidade",
              description:
                "Consulta horários livres na agenda dos médicos da clínica. Use ANTES de tentar agendar. Pode filtrar por especialidade (ex.: 'Ortopedia') ou por nome do médico. Retorna friendly_message com até 4 opções formatadas em PT-BR pra você ler em voz alta — cada slot já vem com doctor_id que você usa em agendar_reuniao.",
              api_schema: {
                url: `${nexusBase}/functions/v1/agent-tool-get-availability`,
                method: "POST",
                request_headers: elWebhookSecret
                  ? { "x-el-webhook-secret": elWebhookSecret }
                  : {},
                request_body_schema: {
                  type: "object",
                  required: ["conversation_id"],
                  properties: {
                    conversation_id: {
                      type: "string",
                      description: "ID da conversa atual (system var conversation_id).",
                    },
                    specialty: {
                      type: "string",
                      description: "Especialidade médica solicitada pelo paciente (ex.: 'Ortopedia esportiva', 'Fisiatria', 'Nutrição esportiva'). Match parcial.",
                    },
                    doctor_name: {
                      type: "string",
                      description: "Nome (ou parte) do médico, se o paciente pedir alguém específico (ex.: 'Dr. João'). Match parcial.",
                    },
                    duration_minutes: {
                      type: "integer",
                      description: "Duração desejada em minutos. Default: duração padrão do médico (geralmente 30).",
                    },
                    days_ahead: {
                      type: "integer",
                      description: "Janela de busca em dias (default 14, máx 30).",
                    },
                    max_options: {
                      type: "integer",
                      description: "Quantas opções devolver (default 4).",
                    },
                  },
                },
              },
              dynamic_variables: {
                conversation_id: "{{system__conversation_id}}",
              },
            },
            {
              type: "webhook",
              name: "agendar_reuniao",
              description:
                "Marca a consulta na agenda do médico. CHAME quando o paciente confirmar um horário que você ofereceu via ver_disponibilidade. Use exatamente o doctor_id e starts_at do slot escolhido. Antes de chamar, repita o horário, médico e modalidade em voz alta e peça confirmação. Após sucesso, leia o confirmation_message.",
              api_schema: {
                url: `${nexusBase}/functions/v1/agent-tool-schedule-meeting`,
                method: "POST",
                request_headers: elWebhookSecret
                  ? { "x-el-webhook-secret": elWebhookSecret }
                  : {},
                request_body_schema: {
                  type: "object",
                  required: ["conversation_id", "doctor_id", "starts_at"],
                  properties: {
                    conversation_id: {
                      type: "string",
                      description: "ID da conversa atual (system var conversation_id).",
                    },
                    doctor_id: {
                      type: "string",
                      description: "ID do médico, retornado em cada slot pelo ver_disponibilidade. Obrigatório.",
                    },
                    starts_at: {
                      type: "string",
                      description: "ISO8601 do horário escolhido (ex.: 2026-04-30T14:00:00-03:00). Use exatamente um starts_at devolvido por ver_disponibilidade.",
                    },
                    duration_minutes: {
                      type: "integer",
                      description: "Duração em minutos. Default: padrão do médico (geralmente 30).",
                    },
                    modality: {
                      type: "string",
                      description: "Modalidade: 'presencial' ou 'teleconsulta'. Pergunte ao paciente.",
                    },
                    title: {
                      type: "string",
                      description: "Título da consulta. Default: 'Consulta com {nome do médico}'.",
                    },
                    notes: {
                      type: "string",
                      description: "Observações livres (motivo da falta anterior, queixa, preferências do paciente).",
                    },
                  },
                },
              },
              dynamic_variables: {
                conversation_id: "{{system__conversation_id}}",
              },
            },
            {
              type: "webhook",
              name: "confirmar_reuniao",
              description:
                "USE APENAS em call de lembrete (call_purpose=reminder), quando o lead confirmar verbalmente que vai comparecer. Marca a reunião como confirmada. Após sucesso, leia o confirmation_message.",
              api_schema: {
                url: `${nexusBase}/functions/v1/agent-tool-confirm-meeting`,
                method: "POST",
                request_headers: elWebhookSecret
                  ? { "x-el-webhook-secret": elWebhookSecret }
                  : {},
                request_body_schema: {
                  type: "object",
                  required: ["conversation_id", "meeting_id"],
                  properties: {
                    conversation_id: {
                      type: "string",
                      description: "ID da conversa atual.",
                    },
                    meeting_id: {
                      type: "string",
                      description: "ID da reunião sendo confirmada (system var meeting_id).",
                    },
                  },
                },
              },
              dynamic_variables: {
                conversation_id: "{{system__conversation_id}}",
                meeting_id: "{{meeting_id}}",
              },
            },
            {
              type: "webhook",
              name: "remarcar_reuniao",
              description:
                "USE em call de lembrete OU de no-show quando o lead pedir pra remarcar ou cancelar. Para remarcar use action='reschedule' + new_starts_at (consultado via ver_disponibilidade). Para cancelar use action='cancel'. Após sucesso leia o confirmation_message.",
              api_schema: {
                url: `${nexusBase}/functions/v1/agent-tool-reschedule-meeting`,
                method: "POST",
                request_headers: elWebhookSecret
                  ? { "x-el-webhook-secret": elWebhookSecret }
                  : {},
                request_body_schema: {
                  type: "object",
                  required: ["conversation_id", "meeting_id", "action"],
                  properties: {
                    conversation_id: {
                      type: "string",
                      description: "ID da conversa atual.",
                    },
                    meeting_id: {
                      type: "string",
                      description: "ID da reunião original (system var meeting_id).",
                    },
                    action: {
                      type: "string",
                      enum: ["reschedule", "cancel"],
                      description: "'reschedule' cria nova reunião e marca a antiga como rescheduled. 'cancel' marca como canceled.",
                    },
                    new_starts_at: {
                      type: "string",
                      description: "ISO8601 do novo horário (obrigatório se action=reschedule). Use slot vindo de ver_disponibilidade.",
                    },
                    duration_minutes: {
                      type: "integer",
                      description: "Duração em minutos (default = duração da original).",
                    },
                    reason: {
                      type: "string",
                      description: "Motivo da remarcação ou cancelamento (resumo curto).",
                    },
                  },
                },
              },
              dynamic_variables: {
                conversation_id: "{{system__conversation_id}}",
                meeting_id: "{{meeting_id}}",
              },
            },
            {
              type: "webhook",
              name: "qualificar_lead",
              description:
                "CHAME ANTES DE DESPEDIR em toda call de discovery (call_purpose=discovery). Registra o lead qualificado no pipeline com fase, sentimento, dor e próxima ação. Use null em campos que não conseguiu confirmar — NUNCA invente dado. Se for DNC, motivo_descarte='dnc' adiciona no bloqueio automático.",
              api_schema: {
                url: `${nexusBase}/functions/v1/agent-tool-qualify-lead`,
                method: "POST",
                request_headers: elWebhookSecret
                  ? {
                      "x-el-webhook-secret": elWebhookSecret,
                      "x-conversation-id": "{{system__conversation_id}}",
                    }
                  : { "x-conversation-id": "{{system__conversation_id}}" },
                request_body_schema: {
                  type: "object",
                  required: ["fase_pipeline", "sentimento"],
                  properties: {
                    nome: { type: "string", description: "Nome completo do lead." },
                    telefone: { type: "string", description: "Melhor telefone de retorno (E.164 quando possível, ex: +5511999998888)." },
                    email: { type: "string", description: "E-mail do lead." },
                    cidade: { type: "string", description: "Cidade do lead." },
                    uf: { type: "string", description: "Sigla da UF, ex: SP." },
                    empresa: { type: "string", description: "Razão social ou nome fantasia." },
                    cnpj: { type: "string", description: "Apenas dígitos (14 chars)." },
                    dor_principal: { type: "string", description: "Resumo da dor relatada pelo lead." },
                    ferramenta_atual: { type: "string", description: "Sistema/processo que o lead usa hoje." },
                    interesse: {
                      type: "string",
                      enum: ["alto", "medio", "baixo", "descartado"],
                      description: "Nível de interesse percebido durante a chamada.",
                    },
                    fase_pipeline: {
                      type: "string",
                      enum: ["novo_lead", "qualificado", "demo_agendada", "proposta", "descartado"],
                      description: "Fase do funil. demo_agendada SÓ se realmente agendou via agendar_reuniao.",
                    },
                    sentimento: {
                      type: "string",
                      enum: ["positivo", "neutro", "negativo"],
                      description: "Humor predominante do lead na chamada.",
                    },
                    temperatura: {
                      type: "string",
                      enum: ["quente", "morno", "frio"],
                      description: "Probabilidade de virar cliente. quente = dor + orçamento + decisão + urgência.",
                    },
                    motivo_descarte: {
                      type: "string",
                      enum: ["sem_fit", "sem_orcamento", "concorrente", "dnc", "outro"],
                      description: "Preencher SOMENTE se fase_pipeline=descartado.",
                    },
                    proxima_acao: {
                      type: "string",
                      enum: ["agendar_demo", "enviar_material", "recontato", "nenhuma"],
                      description: "Próximo passo combinado com o lead.",
                    },
                    observacao: {
                      type: "string",
                      description: "Anotação livre pro time comercial (objeções, contexto, sugestões).",
                    },
                  },
                },
              },
              dynamic_variables: {
                conversation_id: "{{system__conversation_id}}",
              },
            },
          ],
          tool_ids: [],
          knowledge_base: (persona.elevenlabs_knowledge_base_ids as string[]) ?? [],
        },
      },
    },
    platform_settings: {
      // Webhook de personalização — EL chama no início de toda chamada
      // (inbound E outbound) e nós retornamos contexto enriquecido.
      // ANTES: estava em `conversational_config.initiation_client_data_webhook`
      // (chave inválida) → EL ignorava e webhook nunca disparava.
      ...(personalizationWebhook ? {
        call_initiation: {
          enable_conversation_initiation_webhook: true,
          conversation_initiation_webhook: {
            url: personalizationWebhook,
            request_headers: elWebhookSecret
              ? { "x-el-webhook-secret": elWebhookSecret }
              : {},
          },
        },
      } : {}),
      ...(eventsWebhook ? {
        webhook: {
          url: eventsWebhook,
          secret: elWebhookSecret || undefined,
        },
      } : {}),
      evaluation: {
        criteria: evaluationCriteria,
      },
    },
  };


  let elAgentId = persona.elevenlabs_agent_id as string | null;

  try {
    if (elAgentId) {
      // Update existing agent.
      try {
        await elRequest(apiKey, "PATCH", `/v1/convai/agents/${elAgentId}`, agentBody);
        console.log(`[el-agent-sync] PATCH agent=${elAgentId} persona=${persona.id}`);
      } catch (err) {
        // Agent doesn't exist on this EL account (e.g., key rotated). Recreate.
        if (String(err).includes("404") || String(err).includes("document_not_found")) {
          console.warn(`[el-agent-sync] stored agent ${elAgentId} not found on EL, recreating`);
          const created = await elRequest(apiKey, "POST", "/v1/convai/agents/create", agentBody);
          elAgentId = created.agent_id ?? created.id;
          console.log(`[el-agent-sync] POST agent=${elAgentId} persona=${persona.id} (recreated)`);
        } else {
          throw err;
        }
      }
    } else {
      // Create new agent.
      const created = await elRequest(apiKey, "POST", "/v1/convai/agents/create", agentBody);
      elAgentId = created.agent_id ?? created.id;
      console.log(`[el-agent-sync] POST agent=${elAgentId} persona=${persona.id}`);
    }
  } catch (err) {
    console.error("[el-agent-sync] EL API error", err);
    return j({ error: String(err) }, 502);
  }

  // Write back the el agent id.
  const { error: updErr } = await admin
    .from("agent_personas")
    .update({ elevenlabs_agent_id: elAgentId })
    .eq("id", persona.id);
  if (updErr) {
    console.error("[el-agent-sync] failed to write back agent_id", updErr);
  }

  return j({ ok: true, elevenlabs_agent_id: elAgentId, persona_id: persona.id });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
