// deno-lint-ignore-file no-explicit-any
//
// agent-tool-confirm-meeting
// --------------------------
// Tool chamada pelo agente DURANTE uma call de lembrete (T-15min) quando
// o lead diz que vai comparecer. Marca scheduled_meetings.confirmed_at.
//
// Auth: header x-el-webhook-secret = ELEVENLABS_WEBHOOK_SECRET.
//
// Body (do agent):
// {
//   conversation_id: string,
//   meeting_id: string
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-el-webhook-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, error: "method not allowed" }, 405);

  const expected = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";
  const received = req.headers.get("x-el-webhook-secret") ?? "";
  if (!expected || expected !== received) return j({ ok: false, error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); }
  catch { return j({ ok: false, error: "invalid json" }, 400); }

  const meetingId: string | undefined = body.meeting_id;
  if (!meetingId) return j({ ok: false, error: "meeting_id required" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: meeting } = await admin
    .from("scheduled_meetings")
    .select("id, status, starts_at")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return j({ ok: false, error: "meeting not found" }, 404);
  if ((meeting as any).status !== "scheduled") {
    return j({ ok: false, error: `meeting status is ${(meeting as any).status}, cannot confirm` }, 409);
  }

  await admin
    .from("scheduled_meetings")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("id", meetingId);

  console.log(`[agent-tool-confirm-meeting] meeting=${meetingId}`);

  return j({
    ok: true,
    meeting_id: meetingId,
    confirmation_message: "Tudo certo, confirmado. Até lá!",
  });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
