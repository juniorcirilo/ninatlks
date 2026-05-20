// Webhook/manual — enrola contato na campanha de Pós-venda (CSAT)
// após evento de venda fechada / reunião concluída.
//
// POST { account_id, contact_id, source?: 'meeting_completed'|'deal_closed' }
//   - resolve a primeira campanha campaign_kind='pos_venda' do account
//   - enfileira contato em voice_campaign_contacts se ainda não estiver

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface Body {
  account_id?: string;
  contact_id?: string;
  source?: string;
  delay_hours?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "POST required" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  let body: Body;
  try { body = await req.json(); } catch { return j({ error: "invalid json" }, 400); }
  const { account_id, contact_id, source = "manual", delay_hours = 24 } = body;
  if (!account_id || !contact_id) return j({ error: "account_id and contact_id required" }, 400);

  // Find pós-venda campaign
  const { data: campaign } = await admin
    .from("voice_campaigns")
    .select("id, status")
    .eq("account_id", account_id)
    .eq("campaign_kind", "pos_venda")
    .in("status", ["running", "draft"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!campaign) return j({ error: "no_pos_venda_campaign" }, 404);

  // Contact valid?
  const { data: contact } = await admin
    .from("contacts")
    .select("phone_number, blocked")
    .eq("id", contact_id)
    .eq("account_id", account_id)
    .maybeSingle();
  if (!contact?.phone_number || contact.blocked) return j({ error: "invalid_contact" }, 400);

  // Already enrolled?
  const { data: existing } = await admin
    .from("voice_campaign_contacts")
    .select("id")
    .eq("campaign_id", campaign.id)
    .eq("contact_id", contact_id)
    .in("status", ["queued", "placed", "ringing", "connected"])
    .maybeSingle();
  if (existing) return j({ ok: true, already_enrolled: true });

  const dispatchAfter = new Date(Date.now() + delay_hours * 3600_000).toISOString();
  const { error: insErr } = await admin.from("voice_campaign_contacts").insert({
    campaign_id: campaign.id,
    account_id,
    contact_id,
    phone_number: contact.phone_number,
    status: "queued",
    dispatch_after: dispatchAfter,
    variables: { source, auto_enrolled: true },
  });
  if (insErr) return j({ error: insErr.message }, 500);

  return j({ ok: true, campaign_id: campaign.id, dispatch_after: dispatchAfter });
});
