// Contrato único do Agent Runtime — Fase 1 do roadmap "Funcionários IA 2026".
//
// Todo "funcionário IA" (SDR, Orçamentista, Atendimento, Pós-venda, Cobrança,
// Retenção) executa um TURN respeitando este contrato. Isso permite:
//  - trocar a persona ativa sem mudar o roteador;
//  - fazer handoff entre agentes sem perder contexto;
//  - logar uniformemente por conversation_id;
//  - testar cada agente em isolamento no Eval Lab.
//
// Este arquivo é puro TypeScript (sem deps) e pode ser importado tanto pelo
// frontend (para tipar UI de Mission Control) quanto pelos server fns.

export type AgentChannel =
  | "whatsapp"
  | "instagram"
  | "messenger"
  | "voice"
  | "sms"
  | "email"
  | "internal";

export type AgentRoleKey =
  | "sdr"
  | "orcamentista"
  | "atendimento"
  | "pos_venda"
  | "cobranca"
  | "retencao"
  | "generalista";

export type AgentAutonomy = "auto" | "suggest" | "shadow";

/** Entrada de um turno: tudo que o agente precisa para responder UMA mensagem. */
export interface AgentTurnInput {
  /** ID da conversa Chatwoot-like. */
  conversationId: string;
  /** Account (workspace) — mantido para o dia que voltarmos a multi-tenant. */
  accountId: string;
  /** Contato dono da conversa. */
  contactId: string;
  /** Canal por onde a mensagem entrou. */
  channel: AgentChannel;
  /** Conteúdo bruto recebido do cliente. */
  userMessage: string;
  /** Persona que deve atender ESTE turno (resolvida pelo Agent Router). */
  personaId: string;
  /** Papel do agente (define ferramentas e prompt base). */
  role: AgentRoleKey;
  /** Modo de autonomia herdado do deployment. */
  autonomy: AgentAutonomy;
  /** Locale do contato (pt-BR por padrão). */
  locale?: string;
  /** Metadados livres do canal (ex: phone, instagram handle). */
  channelMeta?: Record<string, unknown>;
}

/** Pedido de transferência para outro papel (handoff). */
export interface AgentHandoff {
  toRole: AgentRoleKey;
  /** Por que está transferindo (loga em agent_handoffs). */
  reason: string;
  /** Contexto resumido que o próximo agente deve receber. */
  briefing: string;
  /** Dados estruturados (ex: lead qualification). */
  payload?: Record<string, unknown>;
}

/** Ação acessória executada durante o turno (chamada de ferramenta). */
export interface AgentToolCall {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

/** Saída de um turno. Sempre serializa para JSON (cruza RPC). */
export interface AgentTurnOutput {
  /** Texto que o canal deve enviar ao cliente. Vazio = silêncio intencional. */
  reply: string;
  /** Confiança 0..1 reportada pelo modelo / heurística. */
  confidence: number;
  /** Ferramentas chamadas durante o turno. */
  toolCalls: AgentToolCall[];
  /** Handoff para outro funcionário IA, se aplicável. */
  handoff: AgentHandoff | null;
  /** Eventos para publicar no workflow_events bus (ex: lead.qualified). */
  events: Array<{ type: string; payload: Record<string, unknown> }>;
  /** Métricas de execução. */
  metrics: {
    promptTokens?: number;
    completionTokens?: number;
    latencyMs: number;
    modelUsed: string;
  };
  /** Se foi pulado, por quê (ex: outside_schedule, low_confidence). */
  skippedReason?: string;
}

/** Resultado quando o Agent Router decide NÃO responder. */
export const skip = (reason: string, modelUsed = "n/a"): AgentTurnOutput => ({
  reply: "",
  confidence: 0,
  toolCalls: [],
  handoff: null,
  events: [],
  metrics: { latencyMs: 0, modelUsed },
  skippedReason: reason,
});
