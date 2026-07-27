// Export a voice campaign's results as CSV.
// Auth: requires JWT + member of the campaign's account.
// Input: { campaign_id }
// Output: text/csv attachment with all calls + outcomes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return j({ ok: false, error: "unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { campaign_id?: string };
  try { body = await req.json(); }
  catch { return j({ ok: false, error: "invalid json" }, 400); }

  if (!body.campaign_id) return j({ ok: false, error: "campaign_id required" }, 400);

  // Fetch campaign + verify membership
  const { data: campaign } = await admin
    .from("voice_campaigns")
    .select("id, account_id, name")
    .eq("id", body.campaign_id)
    .maybeSingle();
  if (!campaign) return j({ ok: false, error: "campaign not found" }, 404);

  const { data: member } = await admin
    .from("account_users")
    .select("account_id")
    .eq("account_id", (campaign as any).account_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return j({ ok: false, error: "forbidden" }, 403);

  // Fetch all campaign contacts + their calls
  const { data: rows } = await admin
    .from("voice_campaign_contacts")
    .select(`
      phone_number,
      status,
      attempts,
      last_error,
      voice_call_id,
      contact:contacts(name, email),
      voice_call:voice_calls(
        status,
        duration_seconds,
        outcome_category,
        outcome_summary,
        outcome_confidence,
        started_at,
        ended_at
      )
    `)
    .eq("campaign_id", body.campaign_id)
    .order("phone_number", { ascending: true });

  const headers = [
    "phone_number",
    "contact_name",
    "contact_email",
    "campaign_status",
    "call_status",
    "outcome_category",
    "outcome_summary",
    "outcome_confidence",
    "duration_sec",
    "started_at",
    "ended_at",
    "attempts",
    "last_error",
  ];

  const lines: string[] = [headers.join(",")];
  for (const r of (rows ?? []) as any[]) {
    const c = Array.isArray(r.contact) ? r.contact[0] : r.contact;
    const vc = Array.isArray(r.voice_call) ? r.voice_call[0] : r.voice_call;
    const cells = [
      r.phone_number ?? "",
      c?.name ?? "",
      c?.email ?? "",
      r.status ?? "",
      vc?.status ?? "",
      vc?.outcome_category ?? "",
      vc?.outcome_summary ?? "",
      vc?.outcome_confidence ?? "",
      vc?.duration_seconds ?? "",
      vc?.started_at ?? "",
      vc?.ended_at ?? "",
      r.attempts ?? "",
      r.last_error ?? "",
    ];
    lines.push(cells.map(csvEscape).join(","));
  }

  // BOM for Excel UTF-8 support
  const csv = "\uFEFF" + lines.join("\n");
  const filename = `campanha-${(campaign as any).name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
