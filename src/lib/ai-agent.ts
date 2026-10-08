import { API_URL, ApiError, apiClient } from "@/lib/api-client";

export type AiAgentSkill = {
  /** agente (persona) dono da skill; null = skill da conta toda */
  persona_id?: string | null;
  persona_name?: string | null;
  /** "generated" = criada pelo botão "Gerar com IA Agent" (uma por agente) */
  origin?: "manual" | "generated";
  id: string;
  slug: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
};

export type DbConnection = "postgresql" | "mssql";

export type AiAgentTool = {
  id: string;
  slug: string;
  name: string;
  kind: "database";
  connection: DbConnection;
  description: string;
  max_rows: number;
  enabled: boolean;
  persona_id: string | null;
  persona_name?: string | null;
};

export type ReplyLength = "curta" | "media" | "longa";

/** "" = responde no mesmo idioma usado pelo cliente (padrão). */
export type ReplyLanguage = "" | "pt-BR" | "en" | "es";

export type AiAgentSettings = {
  enabled: boolean;
  system_prompt: string;
  temperature: number;
  /** esforço/raciocínio (variant do IA Agent); "" = padrão do modelo */
  effort: string;
  reply_length: ReplyLength;
  reply_language: ReplyLanguage;
  history_turns: number;
  /** modelos tentados em ordem quando o principal falha */
  fallback_models: string[];
};

export type AiAgentOverview = {
  /** colunas novas ainda não migradas no banco */
  migration_pending?: boolean;
  settings: AiAgentSettings;
  connection: { base_url: string; has_key: boolean; model_id: string; connected: boolean };
  /** skill do sistema: sempre ativa, somente leitura */
  global_skill: { slug: string; name: string; description: string; body: string };
  skills: AiAgentSkill[];
  tools: AiAgentTool[];
  /** credenciais salvas em Integrações */
  connections: Record<DbConnection, boolean>;
  /** Client ID (tenant) configurado em Integrações */
  tenants?: Record<DbConnection, boolean>;
};

const base = (accountId: string) => `/accounts/${accountId}/ai-agent`;

export const fetchAiAgent = (accountId: string) => apiClient.get<AiAgentOverview>(base(accountId));

export const updateAiAgentSettings = (
  accountId: string,
  patch: Partial<{
    enabled: boolean;
    systemPrompt: string;
    temperature: number;
    effort: string;
    replyLength: ReplyLength;
    replyLanguage: ReplyLanguage;
    historyTurns: number;
    fallbackModels: string[];
  }>,
) => apiClient.patch<{ ok: true }>(`${base(accountId)}/settings`, patch);

export type ConnectionInput = { baseUrl?: string; apiKey?: string; modelId?: string };

export const saveAiConnection = (accountId: string, body: ConnectionInput) =>
  apiClient.put<{ ok: true }>(`${base(accountId)}/connection`, body);

export const removeAiConnection = (accountId: string) =>
  apiClient.delete<{ ok: true }>(`${base(accountId)}/connection`);

export const listAiModels = (accountId: string, body: ConnectionInput) =>
  apiClient.post<{ models: string[] }>(`${base(accountId)}/connection/models`, body);

export const testAiConnection = (accountId: string, body: ConnectionInput) =>
  apiClient.post<{ ok: true; message: string }>(`${base(accountId)}/connection/test`, body);

export type SkillInput = {
  name: string;
  description: string;
  body: string;
  enabled?: boolean;
  /** agente (persona) dono da skill; vazio = skill geral */
  personaId?: string;
};

export const createAiSkill = (accountId: string, s: SkillInput) =>
  apiClient.post<AiAgentSkill>(`${base(accountId)}/skills`, s);

export const updateAiSkill = (accountId: string, id: string, s: Partial<SkillInput>) =>
  apiClient.patch<AiAgentSkill>(`${base(accountId)}/skills/${id}`, s);

export const deleteAiSkill = (accountId: string, id: string) =>
  apiClient.delete<{ ok: true }>(`${base(accountId)}/skills/${id}`);

/** O IA Agent analisa a descrição do agente e cria a skill (pode levar até ~1 min). */
export const generateAiSkill = (
  accountId: string,
  input: { name: string; description: string; personaId?: string },
) => apiClient.post<AiAgentSkill>(`${base(accountId)}/skills/generate`, input);

// ─── geração de skill em tempo real (raciocínio, ferramentas, texto) ──────

/**
 * Evento ao vivo do IA Agent durante a geração de uma skill (já sem segredos
 * internos). Um `type` conhecido ("model_start", "reasoning", "tool_use",
 * "text", "step_finish", "error", "done", "fatal_error"...) soma os campos
 * daquele tipo; tipo desconhecido é só ignorado pela tela.
 */
export interface SkillGenEvent {
  type: string;
  model?: string;
  error?: string | { message?: string; data?: { message?: string } };
  part?: {
    text?: string;
    tool?: string;
    state?: { status?: string; output?: string };
    tokens?: { input?: number; output?: number; reasoning?: number };
    cost?: number;
  };
  skill?: AiAgentSkill;
  message?: string;
}

/**
 * Chama a geração de skill via Server-Sent Events: `onEvent` recebe cada
 * evento do IA Agent assim que acontece (raciocínio, uso de ferramentas,
 * trechos de texto, uso de tokens). Resolve com a skill criada (evento
 * "done") ou rejeita no primeiro "fatal_error" ou erro de rede.
 */
export async function generateAiSkillStream(
  accountId: string,
  input: { name: string; description: string; personaId?: string },
  onEvent: (ev: SkillGenEvent) => void,
  signal?: AbortSignal,
): Promise<AiAgentSkill> {
  const res = await fetch(`${API_URL}${base(accountId)}/skills/generate/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      (body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : null) ?? res.statusText,
      body,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result: AiAgentSkill | null = null;
  let fatal: string | null = null;

  const consume = (raw: string) => {
    for (const block of raw.split("\n\n")) {
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let ev: SkillGenEvent;
      try {
        ev = JSON.parse(line.slice(5).trim()) as SkillGenEvent;
      } catch {
        continue;
      }
      if (ev.type === "done" && ev.skill) result = ev.skill;
      else if (ev.type === "fatal_error" && ev.message) fatal = ev.message;
      onEvent(ev);
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) consume(p);
  }
  if (buf) consume(buf);

  if (fatal) throw new Error(fatal);
  if (!result) throw new Error("O IA Agent encerrou sem concluir a skill.");
  return result;
}

export const createAiTool = (
  accountId: string,
  t: {
    name: string;
    connection: DbConnection;
    description?: string;
    maxRows?: number;
    personaId?: string;
  },
) => apiClient.post<AiAgentTool>(`${base(accountId)}/tools`, t);

export const updateAiTool = (
  accountId: string,
  id: string,
  t: Partial<{ name: string; description: string; maxRows: number; enabled: boolean }>,
) => apiClient.patch<AiAgentTool>(`${base(accountId)}/tools/${id}`, t);

export const deleteAiTool = (accountId: string, id: string) =>
  apiClient.delete<{ ok: true }>(`${base(accountId)}/tools/${id}`);

export const testDbConnection = (accountId: string, type: DbConnection) =>
  apiClient.post<{ ok: true; message: string }>(`${base(accountId)}/connections/${type}/test`, {});

// ─── uso e consumo (dashboard) ────────────────────────────────────────────

/** Valores numéricos chegam como texto do PostgreSQL (bigint/numeric). */
export type AiUsageSummary =
  | { migration_pending: true; days: number }
  | {
      migration_pending: false;
      days: number;
      totals: Record<string, string | null>;
      by_day: { day: string; calls: string; ok_calls: string; tokens: string; cost: string }[];
      by_model: {
        model: string;
        provider: string;
        calls: string;
        ok_calls: string;
        tokens: string;
        cost: string;
        avg_ms: string;
      }[];
      by_agent: {
        persona_id: string | null;
        name: string;
        calls: string;
        tokens: string;
        cost: string;
      }[];
      errors: {
        created_at: string;
        kind: string;
        model: string | null;
        provider: string;
        error: string | null;
      }[];
      db: Record<string, string>;
    };

export const fetchAiUsage = (accountId: string, days: number) =>
  apiClient.get<AiUsageSummary>(`${base(accountId)}/usage?days=${days}`);
