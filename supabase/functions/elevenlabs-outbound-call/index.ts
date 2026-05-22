// Dial outbound through ElevenLabs's native Twilio integration:
//   POST /v1/convai/twilio/outbound-call { agent_id, agent_phone_number_id, to_number }
//
// Required state:
//   - phone_numbers row with elevenlabs_phone_number_id set (via
//     elevenlabs-phone-register)
//   - pinned persona with elevenlabs_agent_id (via elevenlabs-agent-sync)
//
// Pre-create voice_calls row + linka conversation_id (busca contato por
// E.164 → get_or_create_open_conversation). Em 5xx/timeout EL, faz fallback
// pro voice-outbound (Twilio direto) reusando a mesma voice_calls.id.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { guardCall, logAttempt } from "../_shared/voice/guard.ts";
import { buildSystemPromptWithGuardrails } from "../_shared/voice/sdr-guardrails.ts";
import {
  resolveCredentialsForAccount,
  ElevenLabsError,
} from "../_shared/elevenlabs/client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EL_TIMEOUT_MS = 15_000;
const PT_BR_LANGUAGE = "pt";
const PT_BR_LANGUAGE_INSTRUCTION =
  "\n\n# IDIOMA DA LIGAÇÃO\n- Fale exclusivamente em português do Brasil (PT-BR).\n- A primeira fala deve ser em português brasileiro.\n- Nunca use inglês, mesmo se o runtime ou telefonia sugerirem outro idioma.";

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

  let body: {
    from_phone_number_id: string;
    to_number: string;
    persona_id?: string;
    contact_id?: string;
    notes?: string;
    meeting_id?: string;
    call_purpose?: "discovery" | "reminder" | "noshow_reschedule" | "followup";
  };
  try {
    body = await req.json();
  } catch {
    return j({ error: "body must be JSON" }, 400);
  }
  if (!body.from_phone_number_id || !body.to_number) {
    return j({ error: "from_phone_number_id and to_number required" }, 400);
  }

  const { data: pn } = await admin
    .from("phone_numbers")
    .select(
      "id, account_id, e164, pinned_persona_id, elevenlabs_phone_number_id, inbox_id",
    )
    .eq("id", body.from_phone_number_id)
    .maybeSingle();
  if (!pn) return j({ error: "phone number not found" }, 404);

  const { data: membership } = await admin
    .from("account_users")
    .select("account_id")
    .eq("user_id", u.user.id)
    .eq("account_id", pn.account_id)
    .maybeSingle();
  if (!membership) return j({ error: "forbidden" }, 403);

  // ── GUARD ───────────────────────────────────────────────────
  const guard = await guardCall(admin, {
    accountId: pn.account_id,
    toNumber: body.to_number,
  });
  if (!guard.allowed) {
    await logAttempt(admin, {
      accountId: pn.account_id,
      phoneNumber: body.to_number,
      outcome: `blocked:${guard.reason}`,
    });
    return j(
      { error: guard.message, reason: guard.reason, details: guard.details },
      422,
    );
  }
  const toE164 = guard.e164;

  const elPhoneId = pn.elevenlabs_phone_number_id as string | null;
  if (!elPhoneId) {
    return j(
      { error: "número não está ativado com ElevenLabs — clique em 'Ativar IA'" },
      409,
    );
  }

  const personaId = body.persona_id ?? pn.pinned_persona_id;
  if (!personaId) return j({ error: "nenhuma persona pinada neste número" }, 409);

  const { data: persona } = await admin
    .from("agent_personas")
    .select("elevenlabs_agent_id, name, system_prompt, first_message, voice_clone_id")
    .eq("id", personaId)
    .maybeSingle();
  const agentId = persona?.elevenlabs_agent_id as string | null;
  const personaName = (persona?.name as string | null) ?? "Nina";
  const systemPrompt = `${buildSystemPromptWithGuardrails(persona?.system_prompt as string | null | undefined)}${PT_BR_LANGUAGE_INSTRUCTION}`;
  const firstMessage = (persona?.first_message as string | null | undefined) ??
    `Oi {{lead_name}}, aqui é {{agent_name}} da {{company_name}}. Esta chamada pode ser gravada. Em que posso ajudar?`;
  if (!agentId) {
    return j(
      { error: "persona não está sincronizada com EL — sincronize o agente primeiro" },
      409,
    );
  }

  let elKey: string;
  try {
    const creds = await resolveCredentialsForAccount(admin, pn.account_id);
    elKey = creds.apiKey;
  } catch (err) {
    const status = err instanceof ElevenLabsError ? err.status : 500;
    console.error("[el-outbound] failed to resolve EL key:", err);
    return j(
      {
        error:
          "ElevenLabs API key não configurada. Configure em Configurações → Integrações → ElevenLabs.",
      },
      status,
    );
  }

  // ── Pre-create voice_calls row ─────────────────────────────
  // Pre-resolve nome do contato pra gravar em metadata.lead_name desde já.
  // Isso garante que mesmo se o classifier não pegar o nome no transcript,
  // o contato já fica nomeado.
  let preLeadName: string | null = null;
  try {
    const { data: preContact } = await admin
      .from("contacts")
      .select("name")
      .eq("account_id", pn.account_id)
      .eq("phone_number", toE164)
      .maybeSingle();
    const n = (preContact as any)?.name;
    if (typeof n === "string" && n.trim()) preLeadName = n.trim();
  } catch (_e) { /* noop */ }

  const { data: call, error: callErr } = await admin
    .from("voice_calls")
    .insert({
      account_id: pn.account_id,
      phone_number_id: pn.id,
      persona_id: personaId,
      direction: "outbound",
      status: "queued",
      provider: "twilio",
      from_number: pn.e164,
      to_number: toE164,
      started_at: new Date().toISOString(),
      metadata: {
        source: "elevenlabs",
        initiated_by: u.user.id,
        contact_id: body.contact_id ?? null,
        notes: body.notes ?? null,
        meeting_id: body.meeting_id ?? null,
        call_purpose: body.call_purpose ?? "discovery",
        lead_name: preLeadName,
      },
    })
    .select("id")
    .single();
  if (callErr || !call) {
    return j({ error: "failed to create voice_calls row" }, 500);
  }

  // ── Link conversation_id ───────────────────────────────────
  // Procura contato por E.164 no account; se houver inbox_id no número,
  // (re)usa conversa aberta nesse inbox. Persiste em voice_calls.conversation_id
  // pra inbox conseguir mostrar a chamada no histórico do contato.
  try {
    const { data: contact } = await admin
      .from("contacts")
      .select("id")
      .eq("account_id", pn.account_id)
      .eq("phone_number", toE164)
      .maybeSingle();

    if (contact?.id && pn.inbox_id) {
      const { data: convId } = await admin.rpc("get_or_create_open_conversation", {
        p_account_id: pn.account_id,
        p_contact_id: contact.id,
        p_inbox_id: pn.inbox_id,
      });
      if (convId) {
        await admin
          .from("voice_calls")
          .update({ conversation_id: convId })
          .eq("id", call.id);
      }
    }
  } catch (linkErr) {
    console.warn(`[el-outbound] failed to link conversation:`, linkErr);
    // não bloqueia — chamada segue
  }

  // ── Build dynamic_variables for SDR outbound ─────────────────
  // Pull contact + company defaults + (se for chamada de lembrete/no-show)
  // contexto da reunião agendada. O system prompt da Nina usa essas vars
  // pra adaptar o tom: discovery vs reminder vs noshow_reschedule vs followup.
  const dynamicVariables: Record<string, string> = {};
  try {
    const [{ data: settings }, { data: contact }] = await Promise.all([
      admin
        .from("company_settings")
        .select("company_name, support_phone")
        .eq("account_id", pn.account_id)
        .maybeSingle(),
      admin
        .from("contacts")
        .select("id, name")
        .eq("account_id", pn.account_id)
        .eq("phone_number", toE164)
        .maybeSingle(),
    ]);

    dynamicVariables.company_name = settings?.company_name ?? "sua empresa";
    dynamicVariables.agent_name = personaName;
    dynamicVariables.support_phone = settings?.support_phone ?? "";
    dynamicVariables.call_purpose = body.call_purpose ?? "discovery";

    if (contact) {
      dynamicVariables.lead_name = (contact.name ?? "").split(" ")[0] || "olá";
    }

    // Contexto de reunião (lembrete T-15min ou retry de no-show)
    if (body.meeting_id) {
      const { data: meeting } = await admin
        .from("scheduled_meetings")
        .select("id, starts_at, ends_at, status, attendee_user_id, invitee_name")
        .eq("id", body.meeting_id)
        .eq("account_id", pn.account_id)
        .maybeSingle();
      if (meeting) {
        dynamicVariables.meeting_id = String(meeting.id);
        dynamicVariables.meeting_starts_at_iso = String(meeting.starts_at);
        dynamicVariables.meeting_starts_at_human = new Intl.DateTimeFormat("pt-BR", {
          weekday: "long",
          day: "2-digit",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Sao_Paulo",
        }).format(new Date(meeting.starts_at));
        if (meeting.attendee_user_id) {
          const { data: prof } = await admin
            .from("profiles")
            .select("display_name, name, email")
            .eq("id", meeting.attendee_user_id)
            .maybeSingle();
          dynamicVariables.attendee_name =
            (prof as any)?.display_name ?? (prof as any)?.name ?? (prof as any)?.email ?? "nosso especialista";
        }
        // Se contato não tinha nome mas a meeting tem invitee_name, registra
        // pra D1 (backfill via metadata.lead_name) e pra próxima call.
        if (!preLeadName && meeting.invitee_name) {
          const { data: existingCall } = await admin
            .from("voice_calls")
            .select("metadata")
            .eq("id", call.id)
            .maybeSingle();
          const md = ((existingCall?.metadata as any) ?? {}) as Record<string, any>;
          await admin
            .from("voice_calls")
            .update({ metadata: { ...md, lead_name: meeting.invitee_name } })
            .eq("id", call.id);
        }
      }
    }

    console.log(
      `[el-outbound] vars: company=${dynamicVariables.company_name} purpose=${dynamicVariables.call_purpose} lead=${dynamicVariables.lead_name ?? "—"} meeting=${dynamicVariables.meeting_id ?? "—"}`,
    );
  } catch (varsErr) {
    console.warn("[el-outbound] failed to build vars (continuing):", varsErr);
  }

  // ── POST EL com timeout ────────────────────────────────────
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EL_TIMEOUT_MS);

  let res: Response;
  let timedOut = false;
  try {
    res = await fetch(
      "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
      {
        method: "POST",
        headers: { "xi-api-key": elKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          agent_phone_number_id: elPhoneId,
          to_number: toE164,
          conversation_initiation_client_data: {
            conversation_config_override: {
            asr: {
              keywords: ["português", "Brasil", "Nina"],
            },
              agent: {
                language: PT_BR_LANGUAGE,
                first_message: firstMessage,
                prompt: { prompt: systemPrompt },
              },
            tts: {
              voice_id: (persona as any)?.voice_clone_id ?? undefined,
            },
            },
            dynamic_variables: dynamicVariables,
          },
        }),
        signal: ctrl.signal,
      },
    );
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      timedOut = true;
      res = new Response("timeout", { status: 504 });
    } else {
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }

  const data = timedOut ? {} : await res.json().catch(() => ({}));

  // ── Fallback Twilio em 5xx ou timeout ──────────────────────
  if (res.status >= 500 || timedOut) {
    console.warn(
      `[el-outbound] EL failed (${res.status}, timeout=${timedOut}) — fallback to Twilio for call=${call.id}`,
    );

    // E4: Merge into existing metadata so we don't drop campaign_id, voice_id, variables, etc.
    const { data: existingCall } = await admin
      .from("voice_calls")
      .select("metadata")
      .eq("id", call.id)
      .maybeSingle();
    const currentMetadata = ((existingCall?.metadata as any) ?? {}) as Record<string, any>;
    await admin
      .from("voice_calls")
      .update({
        metadata: {
          ...currentMetadata,
          fallback_from: "elevenlabs",
          el_status: res.status,
          el_timeout: timedOut,
          source: "elevenlabs",
          initiated_by: u.user.id,
        },
      })
      .eq("id", call.id);

    const fb = await fetch(`${supabaseUrl}/functions/v1/voice-outbound`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        "X-Reuse-Voice-Call-Id": call.id,
      },
      body: JSON.stringify({
        fromNumberId: pn.id,
        toNumber: toE164,
        personaId,
      }),
    });
    const fbData = await fb.json().catch(() => ({}));

    if (!fb.ok || fbData?.status === "failed") {
      return j(
        {
          ok: false,
          call_id: call.id,
          fallback: "twilio_failed",
          el_status: res.status,
          twilio_error: fbData,
        },
        502,
      );
    }

    return j({
      ok: true,
      call_id: call.id,
      via: "twilio_fallback",
      twilio_call_sid: fbData.callSid,
    });
  }

  // ── EL falhou com código não-recuperável (4xx) ─────────────
  if (!res.ok || data?.success === false) {
    await admin
      .from("voice_calls")
      .update({ status: "failed", metadata: { error: data, source: "elevenlabs" } })
      .eq("id", call.id);

    await logAttempt(admin, {
      accountId: pn.account_id,
      phoneNumber: toE164,
      voiceCallId: call.id,
      outcome: `failed:el_${res.status}`,
    });

    return j(
      { error: `EL outbound failed: ${res.status}: ${JSON.stringify(data).slice(0, 300)}` },
      502,
    );
  }

  // ── Sucesso EL ─────────────────────────────────────────────
  // EL returns: { success, conversation_id, callSid }
  const { error: updErr } = await admin
    .from("voice_calls")
    .update({
      provider_call_sid: data.callSid,
      source_id: data.conversation_id,
      status: "ringing",
    })
    .eq("id", call.id);
  if (updErr) {
    console.error(
      `[el-outbound] failed to persist conv_id/sid on call=${call.id}:`,
      updErr,
    );
  }

  await logAttempt(admin, {
    accountId: pn.account_id,
    phoneNumber: toE164,
    voiceCallId: call.id,
    outcome: "placed:elevenlabs",
  });

  console.log(
    `[el-outbound] ok call=${call.id} conv=${data.conversation_id} sid=${data.callSid} to=${toE164}`,
  );

  return j({
    ok: true,
    call_id: call.id,
    via: "elevenlabs",
    conversation_id: data.conversation_id,
    twilio_call_sid: data.callSid,
  });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
