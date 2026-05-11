// Merge two or more contacts into one. Thin wrapper around the SQL function
// public.merge_contacts — lives as an edge function so the UI can RLS-gate
// via the user's token (must be admin of the account).
//
// Body: { primary_id: uuid, duplicate_ids: uuid[] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

  let body: { primary_id?: string; duplicate_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return j({ error: "body must be JSON" }, 400);
  }
  const primary = body.primary_id;
  const dups = body.duplicate_ids ?? [];
  if (!primary || dups.length === 0) {
    return j({ error: "primary_id and duplicate_ids required" }, 400);
  }
  if (dups.includes(primary)) {
    return j({ error: "primary_id cannot be in duplicate_ids" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Verify caller is admin of the account that owns all contacts involved.
  const { data: contacts } = await admin
    .from("contacts")
    .select("id, account_id")
    .in("id", [primary, ...dups]);
  if (!contacts || contacts.length !== 1 + dups.length) {
    return j({ error: "one or more contacts not found" }, 404);
  }
  const accountIds = new Set(contacts.map((c) => c.account_id));
  if (accountIds.size !== 1) {
    return j({ error: "contacts must belong to the same account" }, 400);
  }
  const accountId = contacts[0].account_id;

  const { data: role } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", uid)
    .eq("account_id", accountId)
    .maybeSingle();
  if (!role || role.role !== "admin") return j({ error: "admin role required" }, 403);

  const { data, error } = await admin.rpc("merge_contacts", {
    p_primary_id: primary,
    p_duplicate_ids: dups,
  });
  if (error) return j({ error: `merge failed: ${error.message}` }, 500);

  const result = Array.isArray(data) ? data[0] : data;
  console.log(
    `[contacts-merge] ok primary=${primary} merged=${result?.merged_count} convs=${result?.moved_conversations} cis=${result?.moved_contact_inboxes}`,
  );
  return j({ ok: true, ...result });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
