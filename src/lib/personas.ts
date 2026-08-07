/**
 * Agent Personas — style cloning, deployment, compose reply
 */
import { apiClient } from "@/lib/api-client";
import type { TemplateField } from "@/lib/webhook-inbound-templates";

export type PersonaStatus = "draft" | "training" | "active" | "retired" | "archived";
/** Um campo de dado esperado deste agente (ex.: dias_em_atraso, numero_orcamento). */
export type PersonaVariableField = TemplateField;
export type DeploymentMode = "always" | "after_hours" | "overflow" | "shadow" | "cron";
export type DeploymentAutonomy = "auto" | "suggest" | "shadow";

export interface Persona {
  id: string;
  account_id: string;
  source_user_id: string | null;
  name: string;
  description: string | null;
  style_profile: Record<string, unknown>;
  system_prompt: string | null;
  voice_provider: string | null;
  voice_clone_id: string | null;
  voice_config: Record<string, unknown>;
  sample_count: number;
  status: PersonaStatus;
  version: number;
  enabled: boolean;
  elevenlabs_agent_id: string | null;
  elevenlabs_knowledge_base_ids: string[];
  first_message: string | null;
  turn_config: {
    turn_timeout?: number;
    turn_eagerness?: "eager" | "normal" | "cautious";
    silence_end_call_timeout?: number;
  };
  tts_config: {
    stability?: number;
    speed?: number;
    similarity_boost?: number;
  };
  asr_keywords: string[];
  llm_temperature: number;
  llm_max_tokens: number;
  llm_model: string;
  /** URL/model_id do LLM próprio deste agente. null = usa o padrão da conta. */
  llm_custom_url: string | null;
  llm_custom_model_id: string | null;
  /** Campos de dados esperados deste agente — formulário manual e template de webhook usam este conjunto. */
  variable_schema: PersonaVariableField[];
  created_at: string;
  updated_at: string;
}

export interface PersonaDeployment {
  id: number;
  persona_id: string;
  inbox_id: string;
  account_id: string;
  enabled: boolean;
  mode: DeploymentMode;
  schedule: Record<string, unknown>;
  autonomy: DeploymentAutonomy;
  confidence_threshold: number;
  daily_message_budget: number;
}

export interface ComposedReply {
  reply: string;
  confidence: number;
  personaName: string;
  briefingUsed: boolean;
}

export const STATUS_LABELS: Record<PersonaStatus, string> = {
  draft: "Rascunho",
  training: "Treinando",
  active: "Ativa",
  retired: "Aposentada",
  archived: "Arquivada",
};

export const MODE_LABELS: Record<DeploymentMode, string> = {
  always: "Sempre",
  after_hours: "Fora do expediente",
  overflow: "Overflow",
  shadow: "Sombra (silenciosa)",
  cron: "Agendada",
};

export const AUTONOMY_LABELS: Record<DeploymentAutonomy, string> = {
  auto: "Auto-envio",
  suggest: "Sugerir",
  shadow: "Sombra",
};

// The API returns camelCase (TypeORM entity props) — this app's UI/lib code
// speaks the original Supabase snake_case shape. Adapt at the edge instead
// of touching every call site.
type ApiPersona = {
  id: string;
  accountId: string;
  sourceUserId: string | null;
  name: string;
  description: string | null;
  styleProfile: Record<string, unknown>;
  systemPrompt: string | null;
  voiceProvider: string | null;
  voiceCloneId: string | null;
  voiceConfig: Record<string, unknown>;
  sampleCount: number;
  status: PersonaStatus;
  version: number;
  enabled: boolean;
  elevenlabsAgentId: string | null;
  elevenlabsKnowledgeBaseIds: string[];
  firstMessage: string | null;
  turnConfig: Persona["turn_config"];
  ttsConfig: Persona["tts_config"];
  asrKeywords: string[];
  llmTemperature: number;
  llmMaxTokens: number;
  llmModel: string;
  llmCustomUrl: string | null;
  llmCustomModelId: string | null;
  variableSchema: PersonaVariableField[];
  createdAt: string;
  updatedAt: string;
};

function toPersona(p: ApiPersona): Persona {
  return {
    id: p.id,
    account_id: p.accountId,
    source_user_id: p.sourceUserId,
    name: p.name,
    description: p.description,
    style_profile: p.styleProfile,
    system_prompt: p.systemPrompt,
    voice_provider: p.voiceProvider,
    voice_clone_id: p.voiceCloneId,
    voice_config: p.voiceConfig,
    sample_count: p.sampleCount,
    status: p.status,
    version: p.version,
    enabled: p.enabled,
    elevenlabs_agent_id: p.elevenlabsAgentId,
    elevenlabs_knowledge_base_ids: p.elevenlabsKnowledgeBaseIds,
    first_message: p.firstMessage,
    turn_config: p.turnConfig ?? {},
    tts_config: p.ttsConfig ?? {},
    asr_keywords: p.asrKeywords ?? [],
    llm_temperature: p.llmTemperature,
    llm_max_tokens: p.llmMaxTokens,
    llm_model: p.llmModel,
    llm_custom_url: p.llmCustomUrl ?? null,
    llm_custom_model_id: p.llmCustomModelId ?? null,
    variable_schema: p.variableSchema ?? [],
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

type ApiDeployment = {
  id: number;
  personaId: string;
  inboxId: string;
  accountId: string;
  enabled: boolean;
  mode: DeploymentMode;
  schedule: Record<string, unknown>;
  autonomy: DeploymentAutonomy;
  confidenceThreshold: number;
  dailyMessageBudget: number;
};

function toDeployment(d: ApiDeployment): PersonaDeployment {
  return {
    id: d.id,
    persona_id: d.personaId,
    inbox_id: d.inboxId,
    account_id: d.accountId,
    enabled: d.enabled,
    mode: d.mode,
    schedule: d.schedule,
    autonomy: d.autonomy,
    confidence_threshold: d.confidenceThreshold,
    daily_message_budget: d.dailyMessageBudget,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────
export async function fetchPersonas(accountId: string) {
  const rows = await apiClient.get<ApiPersona[]>(`/accounts/${accountId}/personas`);
  return rows.map(toPersona);
}

export async function createPersona(input: {
  accountId: string;
  name: string;
  description?: string;
  sourceUserId?: string | null;
}) {
  const row = await apiClient.post<ApiPersona>(`/accounts/${input.accountId}/personas`, {
    name: input.name,
    description: input.description,
    sourceUserId: input.sourceUserId ?? undefined,
  });
  return toPersona(row);
}

export async function updatePersona(accountId: string, id: string, updates: Partial<Persona>) {
  const body: Record<string, unknown> = {};
  if (updates.name !== undefined) body.name = updates.name;
  if (updates.description !== undefined) body.description = updates.description;
  if (updates.status !== undefined) body.status = updates.status;
  if (updates.enabled !== undefined) body.enabled = updates.enabled;
  if (updates.system_prompt !== undefined) body.systemPrompt = updates.system_prompt;
  if (updates.voice_provider !== undefined) body.voiceProvider = updates.voice_provider;
  if (updates.voice_clone_id !== undefined) body.voiceCloneId = updates.voice_clone_id;
  if (updates.voice_config !== undefined) body.voiceConfig = updates.voice_config;
  if (updates.first_message !== undefined) body.firstMessage = updates.first_message;
  if (updates.turn_config !== undefined) body.turnConfig = updates.turn_config;
  if (updates.tts_config !== undefined) body.ttsConfig = updates.tts_config;
  if (updates.asr_keywords !== undefined) body.asrKeywords = updates.asr_keywords;
  if (updates.llm_temperature !== undefined) body.llmTemperature = updates.llm_temperature;
  if (updates.llm_max_tokens !== undefined) body.llmMaxTokens = updates.llm_max_tokens;
  if (updates.llm_model !== undefined) body.llmModel = updates.llm_model;
  if (updates.llm_custom_url !== undefined) body.llmCustomUrl = updates.llm_custom_url;
  if (updates.llm_custom_model_id !== undefined) body.llmCustomModelId = updates.llm_custom_model_id;
  if (updates.variable_schema !== undefined) body.variableSchema = updates.variable_schema;

  const row = await apiClient.patch<ApiPersona>(`/accounts/${accountId}/personas/${id}`, body);
  return toPersona(row);
}

export async function deletePersona(accountId: string, id: string) {
  await apiClient.delete(`/accounts/${accountId}/personas/${id}`);
}

// ── Deployments ───────────────────────────────────────────────────
export async function fetchDeployments(accountId: string, personaId: string) {
  const rows = await apiClient.get<ApiDeployment[]>(
    `/accounts/${accountId}/personas/${personaId}/deployments`,
  );
  return rows.map(toDeployment);
}

export async function deleteDeployment(accountId: string, id: number) {
  await apiClient.delete(`/accounts/${accountId}/persona-deployments/${id}`);
}

export async function findActiveDeploymentForInbox(accountId: string, inboxId: string) {
  return apiClient.get<(ApiDeployment & { persona_name: string; persona_status: string }) | null>(
    `/accounts/${accountId}/persona-deployments/active-for-inbox?inboxId=${inboxId}`,
  );
}

export async function deployPersona(input: {
  personaId: string;
  accountId: string;
  inboxId: string;
  enabled?: boolean;
  mode?: DeploymentMode;
  autonomy?: DeploymentAutonomy;
  confidenceThreshold?: number;
  dailyMessageBudget?: number;
}) {
  const row = await apiClient.post<ApiDeployment>(
    `/accounts/${input.accountId}/persona-deployments`,
    {
      personaId: input.personaId,
      inboxId: input.inboxId,
      enabled: input.enabled,
      mode: input.mode,
      autonomy: input.autonomy,
      confidenceThreshold: input.confidenceThreshold,
      dailyMessageBudget: input.dailyMessageBudget,
    },
  );
  return toDeployment(row);
}

// ── AI actions (edge functions) ────────────────────────────────────
// Ported to new backend where endpoints exist; AI-powered actions (distill,
// suggest, generate-prompt) are Fase 8 and still need backend implementation.
export async function distillPersona(accountId: string, personaId: string) {
  const data = await apiClient.post<{ sampleCount: number; styleProfile: Record<string, unknown> }>(
    `/accounts/${accountId}/personas/${personaId}/distill`,
    {},
  );
  return data;
}

export async function suggestReply(accountId: string, personaId: string, input: { conversationId: string }) {
  const data = await apiClient.post<ComposedReply>(
    `/accounts/${accountId}/personas/${personaId}/suggest-reply`,
    { conversationId: input.conversationId },
  );
  return data;
}

/**
 * Generate (or refine) a system prompt with the Lovable AI Gateway.
 * Input: a brief description of what the agent should do. Output: a
 * full, structured prompt optimized for voice conversation.
 */
export async function generatePersonaPrompt(accountId: string, personaId: string, args: {
  description: string;
  personaName?: string;
  existingPrompt?: string;
  refine?: boolean;
}) {
  const data = await apiClient.post<{ ok?: boolean; error?: string; prompt?: string }>(
    `/accounts/${accountId}/personas/${personaId}/generate-prompt`,
    {
      description: args.description,
      personaName: args.personaName,
      existingPrompt: args.existingPrompt,
      refine: !!args.refine,
    },
  );
  if (data.error || !data.ok || !data.prompt) throw new Error(data.error ?? "Resposta vazia");
  return data.prompt;
}

/**
 * Sync this persona to an ElevenLabs Conversational AI agent.
 * Creates the agent on first call; PATCHes on subsequent calls.
 * Persists elevenlabs_agent_id back onto the persona row.
 */
export async function syncElevenLabsAgent(accountId: string, personaId: string) {
  const data = await apiClient.post<{ ok: true; elevenlabs_agent_id: string; persona_id: string }>(
    `/accounts/${accountId}/elevenlabs/agent-sync`,
    { personaId },
  );
  return data;
}

/**
 * Upload a document to ElevenLabs knowledge base and attach it to a persona's agent.
 * Accepts text content directly.
 */
export async function addKnowledgeBaseText(args: {
  accountId: string;
  personaId: string;
  name: string;
  text: string;
}) {
  const data = await apiClient.post<{ ok: true; document_id: string }>(
    `/accounts/${args.accountId}/elevenlabs/kb-add`,
    {
      personaId: args.personaId,
      name: args.name,
      text: args.text,
      type: "text",
    },
  );
  return data;
}

/**
 * Add a URL to the ElevenLabs knowledge base and attach to the persona's agent.
 */
export async function addKnowledgeBaseUrl(args: {
  accountId: string;
  personaId: string;
  name: string;
  url: string;
}) {
  const data = await apiClient.post<{ ok: true; document_id: string }>(
    `/accounts/${args.accountId}/elevenlabs/kb-add`,
    {
      personaId: args.personaId,
      name: args.name,
      url: args.url,
      type: "url",
    },
  );
  return data;
}

// ── Helpers ───────────────────────────────────────────────────────
export function shouldTriggerDeployment(d: PersonaDeployment, now = new Date()): boolean {
  if (!d.enabled) return false;
  const hour = now.getHours();
  switch (d.mode) {
    case "always":
    case "overflow":
    case "shadow":
      return true;
    case "after_hours":
      return hour >= 18 || hour < 8;
    case "cron": {
      const schedule = d.schedule as { start_hour?: number; end_hour?: number };
      const start = schedule.start_hour ?? 0;
      const end = schedule.end_hour ?? 24;
      return hour >= start && hour < end;
    }
  }
}
