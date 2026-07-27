// deno-lint-ignore-file no-explicit-any
//
// Helpers de resolução de contact + stage compartilhados pelo pipeline SDR.
// Extraído de lead-classify-from-call/index.ts pra ser reusado pela tool em
// tempo real (agent-tool-qualify-lead) — garante que tool ao vivo e fallback
// pós-call usem exatamente a mesma lógica de match e a mesma tabela
// STAGE_BY_FASE → outcome_category → stage_name.

export type OutcomeCategory =
  | "scheduled"
  | "qualified"
  | "not_interested"
  | "callback"
  | "no_answer"
  | "voicemail"
  | "wrong_number"
  | "escalated"
  | "other";

export const ALLOWED_CATEGORIES: readonly OutcomeCategory[] = [
  "scheduled",
  "qualified",
  "not_interested",
  "callback",
  "no_answer",
  "voicemail",
  "wrong_number",
  "escalated",
  "other",
] as const;

// Mapa fase_pipeline (vocabulário do prompt SDR) → outcome_category interna.
// Mantém compat com lead-classify-from-call (que opera direto em
// outcome_category) e com a tool em tempo real (que recebe fase_pipeline
// vinda do LLM).
export const FASE_TO_CATEGORY: Record<string, OutcomeCategory> = {
  novo_lead:     "other",
  qualificado:   "qualified",
  demo_agendada: "scheduled",
  proposta:      "qualified",
  descartado:    "not_interested",
};

export const STAGE_BY_CATEGORY: Record<
  OutcomeCategory,
  { stageName: string; score: number }
> = {
  scheduled:      { stageName: "Reunião agendada", score: 95 },
  qualified:      { stageName: "Qualificado",      score: 70 },
  callback:       { stageName: "Contatado",        score: 50 },
  escalated:      { stageName: "Qualificado",      score: 60 },
  no_answer:      { stageName: "Contatado",        score: 20 },
  voicemail:      { stageName: "Contatado",        score: 15 },
  not_interested: { stageName: "Perdeu",           score: 5 },
  wrong_number:   { stageName: "Perdeu",           score: 0 },
  other:          { stageName: "Contatado",        score: 30 },
};

// Score boost por temperatura (lead quente sobe, frio desce). Aplicado por
// cima do score base do stage.
export const TEMPERATURE_BOOST: Record<string, number> = {
  quente: 15,
  morno: 0,
  frio: -10,
};

export interface ResolveCallContext {
  account_id: string;
  conversation_id: string | null;
  from_number: string | null;
  to_number: string | null;
  direction: string | null;
  metadata: any;
}

// Tenta extrair um nome utilizável do metadata da call (gravado por
// dispatchers como elevenlabs-outbound-call, meeting-reminder-tick, etc).
function nameFromCallMetadata(metadata: any): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const candidates = [
    metadata.lead_name,
    metadata.contact_name,
    metadata.invitee_name,
    metadata.dynamic_variables?.lead_name,
  ];
  for (const c of candidates) {
    if (typeof c === "string") {
      const trimmed = c.trim();
      if (trimmed.length >= 2 && trimmed.length <= 80 && !/^(olá|oi|alô)$/i.test(trimmed)) {
        return trimmed;
      }
    }
  }
  return null;
}

/**
 * Resolve contact_id da call. Tenta na ordem:
 *   1. metadata.contact_id (set por dispatchers)
 *   2. via conversation_id → conversations.contact_id
 *   3. lookup por phone_number (from se inbound, to se outbound)
 *   4. cria contact novo com source apropriada
 */
export async function resolveContactIdFromCall(
  admin: any,
  call: ResolveCallContext,
): Promise<string | null> {
  const metaContactId = call.metadata?.contact_id;
  if (typeof metaContactId === "string" && metaContactId) return metaContactId;

  if (call.conversation_id) {
    const { data: conv } = await admin
      .from("conversations")
      .select("contact_id")
      .eq("id", call.conversation_id)
      .maybeSingle();
    if (conv?.contact_id) return conv.contact_id;
  }

  const leadPhone = call.direction === "outbound" ? call.to_number : call.from_number;
  if (leadPhone) {
    const { data: existing } = await admin
      .from("contacts")
      .select("id")
      .eq("account_id", call.account_id)
      .eq("phone_number", leadPhone)
      .maybeSingle();
    if (existing?.id) return existing.id;

    const seedName = nameFromCallMetadata(call.metadata);
    const { data: created, error } = await admin
      .from("contacts")
      .insert({
        account_id: call.account_id,
        phone_number: leadPhone,
        source: call.direction === "outbound" ? "outbound" : "inbound",
        ...(seedName ? { name: seedName } : {}),
      })
      .select("id")
      .single();
    if (!error && created?.id) return created.id;
  }
  return null;
}

/**
 * Resolve stage_id pelo nome da stage no pipeline default da account.
 * Retorna null se não houver pipeline default ou stage com esse nome.
 */
export async function resolveStageIdByName(
  admin: any,
  accountId: string,
  stageName: string,
): Promise<string | null> {
  const { data } = await admin
    .from("lead_pipelines")
    .select("id, lead_stages!inner(id, name)")
    .eq("account_id", accountId)
    .eq("is_default", true)
    .eq("lead_stages.name", stageName)
    .maybeSingle();
  const stages = (data as any)?.lead_stages;
  if (Array.isArray(stages) && stages[0]) return stages[0].id;
  if (stages && typeof stages === "object" && stages.id) return stages.id;
  return null;
}
