// ElevenLabs calls this webhook at the start of each call (inbound or outbound).
// Goal: hand the agent the full negotiation context (debt + rules) so it
// never has to invent values and never violates discount/installment caps.
//
// EL payload (POST):
//   { caller_id, agent_id, called_number, call_sid,
//     dynamic_variables?: {...} }   ← when outbound, EL forwards what we sent
//
// Our response (200):
//   { conversation_config_override?: {...}, dynamic_variables?: {...} }
//
// Auth: shared secret via x-el-webhook-secret header.
// verify_jwt = false (machine-to-machine).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { buildSystemPromptWithGuardrails } from "../_shared/voice/sdr-guardrails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const expected = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";
  const received = req.headers.get("x-el-webhook-secret") ?? "";
  if (expected && !timingSafeEqual(expected, received)) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  let payload: {
    caller_id?: string;
    agent_id?: string;
    called_number?: string;
    call_sid?: string;
    dynamic_variables?: Record<string, any>;
  };
  try {
    payload = await req.json();
  } catch {
    return j({});
  }

  // EL forwards the dynamic_variables we sent in the outbound POST. Para
  // calls outbound (lembrete/no-show/followup) o dispatcher já injeta o
  // contexto correto (call_purpose, meeting_id, lead_name, etc.). Aqui
  // PRESERVAMOS o que veio e só enriquecemos pra calls inbound (lookup
  // de contact + meeting agendada).
  const incomingVars: Record<string, any> = (payload.dynamic_variables ?? {}) as any;
  const isOutbound = Boolean(
    incomingVars.campaign_contact_id ||
      incomingVars.meeting_id ||
      (incomingVars.call_purpose && incomingVars.call_purpose !== "discovery"),
  );

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve persona from agent_id → find account.
  let accountId: string | null = null;
  let personaName = "Nina";
  let personaSystemPrompt: string | null = null;
  let personaFirstMessage: string | null = null;
  if (payload.agent_id) {
    const { data: persona } = await admin
      .from("agent_personas")
      .select("account_id, name, system_prompt, first_message")
      .eq("elevenlabs_agent_id", payload.agent_id)
      .maybeSingle();
    if (persona) {
      accountId = persona.account_id;
      personaName = persona.name ?? personaName;
      personaSystemPrompt = persona.system_prompt;
      personaFirstMessage = (persona.first_message as string | null) ?? null;
    }
  }

  const callerE164 = payload.caller_id ?? "";
  let contactName: string | null = null;
  let contactId: string | null = null;
  let openConvCount = 0;
  let lastSummary: string | null = null;

  if (accountId && callerE164) {
    const { data: contact } = await admin
      .from("contacts")
      .select("id, name")
      .eq("account_id", accountId)
      .eq("phone_number", callerE164)
      .maybeSingle();
    if (contact) {
      contactId = contact.id;
      contactName = contact.name;
      const { count } = await admin
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId)
        .eq("contact_id", contact.id)
        .eq("status", 0);
      openConvCount = count ?? 0;

      const { data: dossier } = await admin
        .from("contact_dossiers")
        .select("briefing")
        .eq("contact_id", contact.id)
        .maybeSingle();
      lastSummary = dossier?.briefing ?? null;
    }
  }

  // ── Build SDR context variables ──────────────────────────
  // Outbound: trust what dispatcher already sent (lembrete/no-show/followup).
  // Inbound: lookup company defaults + open meetings + lead briefing so a
  // returning lead is recognized.
  const negotiationVars: Record<string, string> = {};

  if (!isOutbound && accountId) {
    const { data: settings } = await admin
      .from("company_settings")
      .select("company_name, support_phone")
      .eq("account_id", accountId)
      .maybeSingle();

    negotiationVars.company_name = settings?.company_name ?? "sua empresa";
    negotiationVars.agent_name = personaName;
    negotiationVars.support_phone = settings?.support_phone ?? "";
    negotiationVars.call_purpose = "discovery";

    if (contactName) {
      negotiationVars.lead_name = contactName.split(" ")[0];
    }

    // Próxima reunião agendada (se houver) — útil pro agent reconhecer
    // lead que já tem reunião marcada.
    if (contactId) {
      const { data: nextMeeting } = await admin
        .from("scheduled_meetings")
        .select("id, starts_at, status")
        .eq("account_id", accountId)
        .eq("contact_id", contactId)
        .eq("status", "scheduled")
        .gt("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(1)
        .maybeSingle();
      if (nextMeeting) {
        negotiationVars.has_upcoming_meeting = "sim";
        negotiationVars.upcoming_meeting_human = new Intl.DateTimeFormat("pt-BR", {
          weekday: "long",
          day: "2-digit",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Sao_Paulo",
        }).format(new Date(nextMeeting.starts_at));
      } else {
        negotiationVars.has_upcoming_meeting = "não";
      }

      // Stage atual + score atual (lead voltando)
      const { data: contact } = await admin
        .from("contacts")
        .select("score, stage_id")
        .eq("id", contactId)
        .maybeSingle();
      if (contact) {
        negotiationVars.lead_score = String(contact.score ?? 0);
      }
    }
  }

  // Merge: incoming (from dispatcher) wins; we only fill gaps.
  // agent_name SEMPRE vem da persona (não deixar dispatcher sobrescrever).
  const dynamicVariables: Record<string, string> = {
    ...negotiationVars,
    ...Object.fromEntries(
      Object.entries(incomingVars).map(([k, v]) => [k, String(v ?? "")]),
    ),
    agent_name: personaName,
    customer_name: contactName ?? incomingVars.lead_name ?? "cliente",
    caller_phone: callerE164,
    open_conversations: String(openConvCount),
    has_history: openConvCount > 0 ? "sim" : "não",
  };

  // Build enriched system prompt prefix with caller context.
  const contextLines: string[] = [];
  if (contactName) contextLines.push(`O cliente se chama ${contactName}.`);
  if (openConvCount > 0) contextLines.push(`Tem ${openConvCount} conversa(s) aberta(s) no sistema.`);
  if (lastSummary) contextLines.push(`Resumo do cliente: ${lastSummary.slice(0, 300)}`);

  const contextBlock = contextLines.length > 0
    ? `\n\n===CONTEXTO DO CLIENTE===\n${contextLines.join("\n")}\n===FIM===`
    : "";

  // Mesma lógica do agent-sync: garante que o prompt enviado ao runtime
  // SEMPRE contenha o header de regras SDR (fluxo por call_purpose,
  // compliance, tools), mesmo se a persona tiver um sysprompt curto.
  const promptWithGuardrails = buildSystemPromptWithGuardrails(personaSystemPrompt);
  const enrichedPrompt = promptWithGuardrails + contextBlock;

  // first_message: respeita o opener cadastrado na persona — só substitui
  // as variáveis dinâmicas. O aviso de gravação fica no system_prompt
  // (regra obrigatória do template) para não engessar o opener customizado.
  // Fallback hardcoded só quando a persona NÃO tem first_message.
  const leadName = dynamicVariables.lead_name || contactName?.split(" ")[0] || "";
  const companyName = dynamicVariables.company_name || "nossa empresa";

  let greeting: string;
  if (personaFirstMessage && personaFirstMessage.trim().length > 0) {
    // Substitui {{var}} no opener salvo. Vars não fornecidas viram "".
    greeting = personaFirstMessage.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
      const v = dynamicVariables[key];
      return v !== undefined && v !== null ? String(v) : "";
    });
  } else {
    greeting = leadName
      ? `Oi ${leadName}, aqui é ${personaName} da ${companyName}. Esta chamada pode ser gravada. Em que posso ajudar?`
      : `Oi, aqui é ${personaName} da ${companyName}. Esta chamada pode ser gravada. Em que posso ajudar?`;
  }

  const response: Record<string, any> = {
    conversation_config_override: {
      agent: {
        prompt: { prompt: enrichedPrompt },
        first_message: greeting,
        language: "pt",
      },
    },
    dynamic_variables: dynamicVariables,
  };

  console.log(
    `[el-personalization] agent=${payload.agent_id} caller=${callerE164} contact=${contactName ?? "(new)"} outbound=${isOutbound} vars=${Object.keys(dynamicVariables).length}`,
  );

  return j(response);
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
