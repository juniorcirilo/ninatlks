// deno-lint-ignore-file no-explicit-any
//
// cadence-tick
// ------------
// Cron */5 min: processa execuções de follow_up_cadences que estão pendentes
// e com next_run_at <= now(). Para cada step, dispara a ação do canal
// (voice/whatsapp/email) e marca avançar/erro via RPC cadence_advance.
//
// Sprint 4: implementa channel=voice. WhatsApp/email ficam pra Sprint 5+
// (são marcados como skipped sem erro pra não travar a cadência).
//
// Auth: service role only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { resolveCredentialsForAccount } from "../_shared/elevenlabs/client.ts";
import { buildSystemPromptWithGuardrails } from "../_shared/voice/sdr-guardrails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const PT_LANGUAGE = "pt";
const PT_BR_LANGUAGE_INSTRUCTION =
  "\n\n# IDIOMA DA LIGAÇÃO\n- Fale exclusivamente em português do Brasil (PT-BR).\n- Use vocabulário, tratamento e pronúncia naturais do Brasil; nunca use português de Portugal.\n- A primeira fala deve ser em português brasileiro.\n- Nunca cumprimente nem responda em inglês.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isService = (req.headers.get("Authorization") ?? "").includes(serviceKey);
  if (!isService) return j({ error: "service role required" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const { data: due, error: dueErr } = await admin.rpc("cadence_due", { p_limit: 50 });
  if (dueErr) {
    console.error("[cadence-tick] RPC failed", dueErr);
    return j({ error: dueErr.message }, 500);
  }
  const items = (due ?? []) as Array<{
    execution_id: string;
    account_id: string;
    cadence_id: string;
    contact_id: string;
    current_step: number;
    step_definition: { channel?: string; offset_hours?: number; template_key?: string } | null;
  }>;

  let advanced = 0;
  let failed = 0;
  let skipped = 0;

  for (const it of items) {
    if (!it.step_definition) {
      // step undefined → terminou
      await admin.rpc("cadence_advance", { p_execution_id: it.execution_id, p_success: true, p_error: null });
      advanced++;
      continue;
    }
    const channel = it.step_definition.channel ?? "voice";
    try {
      if (channel === "voice") {
        await dispatchVoiceFollowup(admin, it);
      } else {
        // WhatsApp/email não implementados nesta sprint — marca como skipped
        // mas avança a cadência pra não travar.
        skipped++;
      }
      await admin.rpc("cadence_advance", { p_execution_id: it.execution_id, p_success: true, p_error: null });
      advanced++;
    } catch (e: any) {
      await admin.rpc("cadence_advance", {
        p_execution_id: it.execution_id,
        p_success: false,
        p_error: String(e?.message ?? e).slice(0, 500),
      });
      failed++;
    }
  }

  console.log(
    `[cadence-tick] checked=${items.length} advanced=${advanced} failed=${failed} skipped=${skipped}`,
  );
  return j({ ok: true, checked: items.length, advanced, failed, skipped });
});

async function dispatchVoiceFollowup(
  admin: any,
  it: {
    execution_id: string;
    account_id: string;
    cadence_id: string;
    contact_id: string;
    current_step: number;
  },
) {
  // 1. Contato + telefone
  const { data: contact } = await admin
    .from("contacts")
    .select("id, name, phone_number, blocked")
    .eq("id", it.contact_id)
    .maybeSingle();
  if (!contact?.phone_number) throw new Error("contact has no phone");
  if (contact.blocked) throw new Error("contact blocked");

  // 2. Phone outbound
  const { data: phone } = await admin
    .from("phone_numbers")
    .select("id, e164, elevenlabs_phone_number_id, pinned_persona_id")
    .eq("account_id", it.account_id)
    .eq("enabled", true)
    .eq("outbound_enabled", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!phone) throw new Error("no outbound phone configured");
  if (!phone.elevenlabs_phone_number_id) throw new Error("phone not registered in EL");

  // 3. Persona
  let personaId: string | null = phone.pinned_persona_id ?? null;
  if (!personaId) {
    const { data: p } = await admin
      .from("agent_personas")
      .select("id")
      .eq("account_id", it.account_id)
      .eq("enabled", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    personaId = p?.id ?? null;
  }
  if (!personaId) throw new Error("no enabled persona");

  const { data: persona } = await admin
    .from("agent_personas")
    .select("elevenlabs_agent_id, name, system_prompt, voice_clone_id")
    .eq("id", personaId)
    .maybeSingle();
  if (!persona?.elevenlabs_agent_id) throw new Error("persona not synced with EL");

  const creds = await resolveCredentialsForAccount(admin, it.account_id);
  const elKey = creds.apiKey;

  // 4. Pre-create voice_calls
  const { data: vc, error: vcErr } = await admin
    .from("voice_calls")
    .insert({
      account_id: it.account_id,
      phone_number_id: phone.id,
      persona_id: personaId,
      direction: "outbound",
      status: "queued",
      provider: "twilio",
      from_number: phone.e164,
      to_number: contact.phone_number,
      started_at: new Date().toISOString(),
      metadata: {
        source: "cadence-tick",
        cadence_id: it.cadence_id,
        cadence_execution_id: it.execution_id,
        cadence_step: it.current_step,
        call_purpose: "followup",
      },
    })
    .select("id")
    .single();
  if (vcErr || !vc) throw new Error("failed to create voice_calls row");

  const leadName = (contact.name ?? "").split(" ")[0] || "olá";
  const dynamicVariables: Record<string, string> = {
    call_purpose: "followup",
    lead_name: leadName,
    agent_name: persona.name ?? "Nina",
    voice_call_id: vc.id,
  };
  const firstMessage = `Oi ${leadName}, é a Nina. Estou retomando contato sobre nossa última conversa. Tem um minutinho?`;
  const systemPrompt = `${buildSystemPromptWithGuardrails(persona.system_prompt)}${PT_BR_LANGUAGE_INSTRUCTION}`;

  const elRes = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
    method: "POST",
    headers: { "xi-api-key": elKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: persona.elevenlabs_agent_id,
      agent_phone_number_id: phone.elevenlabs_phone_number_id,
      to_number: contact.phone_number,
      conversation_initiation_client_data: {
        conversation_config_override: {
          asr: { keywords: ["português", "Brasil", "Nina"] },
          agent: {
            language: PT_LANGUAGE,
            first_message: firstMessage,
            prompt: { prompt: systemPrompt },
          },
          tts: { voice_id: persona.voice_clone_id ?? undefined },
        },
        dynamic_variables: dynamicVariables,
      },
    }),
  });
  const elData = await elRes.json().catch(() => ({}));
  if (!elRes.ok || elData?.success === false) {
    await admin
      .from("voice_calls")
      .update({ status: "failed", metadata: { error: `EL ${elRes.status}` } })
      .eq("id", vc.id);
    throw new Error(`EL outbound failed: ${elRes.status}`);
  }

  await admin
    .from("voice_calls")
    .update({
      provider_call_sid: elData.callSid,
      source_id: elData.conversation_id,
      status: "ringing",
    })
    .eq("id", vc.id);
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
