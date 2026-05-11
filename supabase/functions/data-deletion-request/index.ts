// Public endpoint for the /data-deletion form. No authentication — anyone
// on the internet can file a deletion request. Rate-limited by IP at the CDN.
// Writes to `data_deletion_requests` table via service role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return j({ error: "body must be JSON" }, 400);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const identifier = String(body.identifier ?? "").trim();
  const reason = String(body.reason ?? "").trim().slice(0, 1000);

  if (!email && !identifier) {
    return j({ error: "E-mail ou identificador obrigatório." }, 400);
  }
  if (email && !/.+@.+\..+/.test(email)) {
    return j({ error: "E-mail inválido." }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  const userAgent = req.headers.get("user-agent");

  const { data, error } = await admin
    .from("data_deletion_requests")
    .insert({
      source: "user_form",
      email: email || null,
      external_identifier: identifier || null,
      reason: reason || null,
      raw_payload: body,
      ip_address: ip,
      user_agent: userAgent,
    })
    .select("confirmation_id")
    .single();

  if (error || !data) {
    console.error("[data-deletion-request] insert failed", error);
    return j({ error: "Falha ao registrar solicitação." }, 500);
  }

  console.log(
    `[data-deletion-request] queued confirmation_id=${data.confirmation_id} email=${email || "-"} identifier=${identifier || "-"}`,
  );

  return j({
    ok: true,
    confirmation_id: data.confirmation_id,
    message:
      "Solicitação registrada. Vamos processar em até 15 dias úteis e confirmar por e-mail.",
  });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
