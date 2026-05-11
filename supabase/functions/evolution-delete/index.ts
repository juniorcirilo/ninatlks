// Delete an Evolution WhatsApp instance + its Nexus channel row.
//
// Flow:
//   1. Auth: caller must be admin of the account that owns the channel.
//   2. Read channel config to grab the URL/apiKey/instanceName.
//   3. Call Evolution DELETE /instance/delete/{name}. Tolerates 404 —
//      the instance may already be gone remotely; DB cleanup still runs.
//   4. Delete the channels row. inboxes cascade via FK ON DELETE CASCADE.
//
// Safe to call on an already-deleted instance. Idempotent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { EvolutionError, deleteInstance } from "../_shared/evolution/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  channel_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return j({ error: "unauthorized" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: u } = await userClient.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return j({ error: "unauthorized" }, 401);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return j({ error: "body must be JSON" }, 400);
  }
  if (!body.channel_id) return j({ error: "channel_id required" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: channel, error: chErr } = await admin
    .from("channels")
    .select("id, account_id, channel_type, config")
    .eq("id", body.channel_id)
    .maybeSingle();
  if (chErr) return j({ error: `channel lookup failed: ${chErr.message}` }, 500);
  if (!channel) return j({ error: "channel not found" }, 404);
  if (channel.channel_type !== "whatsapp") {
    return j({ error: "channel is not a whatsapp/evolution instance" }, 400);
  }

  const { data: role } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", uid)
    .eq("account_id", channel.account_id)
    .maybeSingle();
  if (!role || role.role !== "admin") return j({ error: "admin role required" }, 403);

  const cfg = (channel.config ?? {}) as Record<string, string | undefined>;
  const url = cfg.evolution_url;
  const apiKey = cfg.evolution_api_key;
  const instanceName = cfg.evolution_instance_name;

  let remoteDeleted = false;
  let remoteError: string | undefined;
  if (url && apiKey && instanceName) {
    try {
      await deleteInstance({ url, apiKey, instanceName });
      remoteDeleted = true;
    } catch (e) {
      // 404 is already tolerated inside deleteInstance; anything else we
      // record but still proceed with local cleanup so the user can remove
      // a dangling row even if the Evolution server is offline.
      remoteError = e instanceof EvolutionError
        ? `Evolution ${e.status}: ${e.body.slice(0, 200)}`
        : String(e);
    }
  }

  const { error: delErr } = await admin
    .from("channels")
    .delete()
    .eq("id", channel.id);
  if (delErr) return j({ error: `channel delete failed: ${delErr.message}` }, 500);

  return j({
    ok: true,
    remote_deleted: remoteDeleted,
    remote_error: remoteError,
  });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
