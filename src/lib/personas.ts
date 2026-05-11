/**
 * Agent Personas — style cloning, deployment, compose reply
 */
import { supabase } from "@/integrations/supabase/client";

export type PersonaStatus = "draft" | "training" | "active" | "retired" | "archived";
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
  messages_sent_today: number;
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

// ── CRUD ──────────────────────────────────────────────────────────
export async function fetchPersonas(accountId: string) {
  const { data, error } = await supabase
    .from("agent_personas")
    .select("*")
    .eq("account_id", accountId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Persona[];
}

export async function createPersona(input: {
  accountId: string;
  name: string;
  description?: string;
  sourceUserId?: string | null;
}) {
  // source_user_id na schema antiga era NOT NULL (copiar estilo de um humano).
  // Para SDR não faz sentido obrigatório; fallback pro user atual garante o
  // insert passar na constraint enquanto a migration do nullable não roda.
  let sourceUserId = input.sourceUserId ?? null;
  if (!sourceUserId) {
    const { data: userData } = await supabase.auth.getUser();
    sourceUserId = userData.user?.id ?? null;
  }

  const { data, error } = await supabase
    .from("agent_personas")
    .insert({
      account_id: input.accountId,
      name: input.name,
      description: input.description ?? null,
      source_user_id: sourceUserId,
      status: "active",
    } as any)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as Persona;
}

export async function updatePersona(id: string, updates: Partial<Persona>) {
  const { data, error } = await supabase
    .from("agent_personas")
    .update(updates as any)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as Persona;
}

export async function deletePersona(id: string) {
  const { error } = await supabase.from("agent_personas").delete().eq("id", id);
  if (error) throw error;
}

// ── Deployments ───────────────────────────────────────────────────
export async function fetchDeployments(personaId: string) {
  const { data, error } = await supabase
    .from("agent_persona_deployments")
    .select("*")
    .eq("persona_id", personaId);
  if (error) throw error;
  return (data ?? []) as unknown as PersonaDeployment[];
}

export async function deleteDeployment(id: number) {
  const { error } = await supabase.from("agent_persona_deployments").delete().eq("id", id);
  if (error) throw error;
}

export async function findActiveDeploymentForInbox(accountId: string, inboxId: string) {
  const { data, error } = await supabase
    .from("agent_persona_deployments")
    .select("*, agent_personas!inner(id, name, status)")
    .eq("account_id", accountId)
    .eq("inbox_id", inboxId)
    .eq("enabled", true)
    .eq("agent_personas.status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
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
  const { data, error } = await supabase
    .from("agent_persona_deployments")
    .upsert(
      {
        persona_id: input.personaId,
        account_id: input.accountId,
        inbox_id: input.inboxId,
        enabled: input.enabled ?? true,
        mode: input.mode ?? "always",
        autonomy: input.autonomy ?? "auto",
        confidence_threshold: input.confidenceThreshold ?? 0.4,
        daily_message_budget: input.dailyMessageBudget ?? 100,
      } as any,
      { onConflict: "persona_id,inbox_id" },
    )
    .select()
    .single();
  if (error) throw error;
  return data as unknown as PersonaDeployment;
}

// ── AI actions (edge functions) ───────────────────────────────────
export async function distillPersona(personaId: string) {
  const { data, error } = await supabase.functions.invoke("persona-distill", {
    body: { personaId },
  });
  if (error) throw error;
  return data as { sampleCount: number; styleProfile: Record<string, unknown> };
}

export async function suggestReply(input: {
  conversationId: string;
  personaId?: string;
}) {
  const { data, error } = await supabase.functions.invoke("persona-suggest", {
    body: input,
  });
  if (error) throw error;
  return data as ComposedReply;
}

/**
 * Generate (or refine) a system prompt with the Lovable AI Gateway.
 * Input: a brief description of what the agent should do. Output: a
 * full, structured prompt optimized for voice conversation.
 */
export async function generatePersonaPrompt(args: {
  description: string;
  personaName?: string;
  existingPrompt?: string;
  refine?: boolean;
}) {
  const { data, error } = await supabase.functions.invoke("persona-prompt-generate", {
    body: {
      description: args.description,
      persona_name: args.personaName,
      existing_prompt: args.existingPrompt,
      refine: !!args.refine,
    },
  });
  if (error) throw new Error(error.message || "Falha ao gerar prompt com IA");
  const d = data as { ok?: boolean; error?: string; prompt?: string };
  if (d.error || !d.ok || !d.prompt) throw new Error(d.error ?? "Resposta vazia");
  return d.prompt;
}

/**
 * Sync this persona to an ElevenLabs Conversational AI agent.
 * Creates the agent on first call; PATCHes on subsequent calls.
 * Persists elevenlabs_agent_id back onto the persona row.
 */
export async function syncElevenLabsAgent(personaId: string) {
  const { data, error } = await supabase.functions.invoke("elevenlabs-agent-sync", {
    body: { persona_id: personaId },
  });
  if (error) throw new Error(error.message || "Falha ao sincronizar com ElevenLabs");
  if (!(data as any)?.ok) throw new Error((data as any)?.error ?? "Sync falhou");
  return data as { ok: true; elevenlabs_agent_id: string; persona_id: string };
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
  const { data, error } = await supabase.functions.invoke("elevenlabs-kb-add", {
    body: args,
  });
  if (error) throw new Error(error.message || "Falha ao adicionar conhecimento");
  return data as { ok: true; document_id: string };
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
  const { data, error } = await supabase.functions.invoke("elevenlabs-kb-add", {
    body: { ...args, type: "url" },
  });
  if (error) throw new Error(error.message || "Falha ao adicionar URL");
  return data as { ok: true; document_id: string };
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
