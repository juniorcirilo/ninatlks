// Add a document (URL or text) to the ElevenLabs knowledge base and attach
// it to a persona's agent. Called from the /agents knowledge tab.
//
// Body:
//   { account_id, persona_id, name, type?: "url" | "text" | "file",
//     url?, text? }

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) return j({ error: "unauthorized" }, 401);

  let body: {
    accountId?: string;
    account_id?: string;
    personaId?: string;
    persona_id?: string;
    name: string;
    type?: "url" | "text";
    url?: string;
    text?: string;
  };
  try {
    body = await req.json();
  } catch {
    return j({ error: "body must be JSON" }, 400);
  }
  const accountId = body.accountId ?? body.account_id;
  const personaId = body.personaId ?? body.persona_id;
  if (!accountId || !personaId || !body.name) {
    return j({ error: "account_id, persona_id and name required" }, 400);
  }

  // Load persona and verify ownership.
  const { data: persona } = await admin
    .from("agent_personas")
    .select("id, account_id, elevenlabs_agent_id, elevenlabs_knowledge_base_ids")
    .eq("id", personaId)
    .maybeSingle();
  if (!persona) return j({ error: "persona not found" }, 404);
  if (persona.account_id !== accountId) return j({ error: "forbidden" }, 403);
  if (!persona.elevenlabs_agent_id) {
    return j({ error: "persona must be synced to ElevenLabs first" }, 409);
  }

  const { data: membership } = await admin
    .from("account_users")
    .select("account_id")
    .eq("user_id", u.user.id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (!membership) return j({ error: "forbidden" }, 403);

  const apiKey = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
  if (!apiKey) return j({ error: "ELEVENLABS_API_KEY not configured" }, 500);

  // 1. Create the KB document on EL.
  const type = body.type ?? (body.url ? "url" : "text");
  const createPath = type === "url"
    ? "/v1/convai/knowledge-base/url"
    : "/v1/convai/knowledge-base/text";
  const createBody = type === "url"
    ? { url: body.url, name: body.name }
    : { text: body.text, name: body.name };

  const createRes = await fetch(`https://api.elevenlabs.io${createPath}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(createBody),
  });
  if (!createRes.ok) {
    const t = await createRes.text().catch(() => "");
    return j({ error: `EL KB create failed: ${createRes.status}: ${t.slice(0, 200)}` }, 502);
  }
  const doc = await createRes.json();
  const docId = doc.id as string;

  // 2. Fetch current agent config, append doc id to knowledge_base, PATCH.
  const current = (persona.elevenlabs_knowledge_base_ids as string[]) ?? [];
  const nextKb = [...current, docId];

  const patchRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/agents/${persona.elevenlabs_agent_id}`,
    {
      method: "PATCH",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_config: {
          agent: {
            prompt: {
              knowledge_base: nextKb,
            },
          },
        },
      }),
    },
  );
  if (!patchRes.ok) {
    const t = await patchRes.text().catch(() => "");
    return j({ error: `EL agent patch failed: ${patchRes.status}: ${t.slice(0, 200)}` }, 502);
  }

  // 3. Mirror the list back to our persona row.
  await admin
    .from("agent_personas")
    .update({ elevenlabs_knowledge_base_ids: nextKb })
    .eq("id", persona.id);

  console.log(
    `[el-kb-add] persona=${persona.id} agent=${persona.elevenlabs_agent_id} doc=${docId} type=${type}`,
  );

  return j({ ok: true, document_id: docId, knowledge_base_ids: nextKb });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
