// Scheduled worker: retry messages whose dispatch failed with transient errors.
// Scans messages where additional_attributes.dispatch.status = 'failed' and
// retry_count < MAX_RETRIES, then re-invokes channels-send with the original
// payload captured from content_attributes.
//
// Called by cron (every ~5 min) or manually via service role.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_RETRIES = 3;
const RETRYABLE_MARKERS = [
  "rate limit",
  "429",
  "500",
  "502",
  "503",
  "504",
  "temporarily",
  "timeout",
  "network",
  "ECONNRESET",
  "80007",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  const authHeader = req.headers.get("Authorization") ?? "";
  const isService = authHeader.includes(serviceKey);
  if (!isService) return j({ error: "service role required" }, 403);

  // Query failed messages that haven't exhausted retries.
  // The partial index idx_messages_dispatch_retry makes this cheap.
  const { data: rows, error } = await admin
    .from("messages")
    .select("id, account_id, conversation_id, content, content_attributes, additional_attributes")
    .filter("additional_attributes->dispatch->>status", "eq", "failed")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return j({ error: error.message }, 500);

  const attempts: any[] = [];
  for (const row of rows ?? []) {
    const dispatch = (row.additional_attributes?.dispatch ?? {}) as Record<string, any>;
    const retryCount = Number(dispatch.retry_count ?? 0);
    if (retryCount >= MAX_RETRIES) continue;

    const reason = String(dispatch.failed_reason ?? "").toLowerCase();
    const isRetryable = RETRYABLE_MARKERS.some((m) => reason.includes(m.toLowerCase()));
    if (!isRetryable) {
      attempts.push({ id: row.id, skipped: "non-retryable" });
      continue;
    }

    const result = await retryOne(admin, row).catch((e) => ({ error: String(e) }));
    attempts.push({ id: row.id, ...result });
  }

  return j({ scanned: rows?.length ?? 0, attempts });
});

async function retryOne(admin: SupabaseClient, msg: any) {
  const contentAttrs = (msg.content_attributes ?? {}) as Record<string, any>;
  const dispatch = (msg.additional_attributes?.dispatch ?? {}) as Record<string, any>;
  const retryCount = Number(dispatch.retry_count ?? 0);

  // Reconstruct the send body from persisted attrs. kind was stored during
  // the first send so we can replay without losing fidelity.
  const kind = contentAttrs.kind ?? "text";
  const payload: Record<string, any> = {};
  if (kind === "text") payload.body = msg.content;
  else if (["image", "audio", "video", "document", "sticker"].includes(kind)) {
    payload.caption = msg.content && msg.content !== `[${kind}]` ? msg.content : undefined;
    payload.media_id = contentAttrs.media_id;
    payload.link = contentAttrs.link;
    payload.filename = contentAttrs.filename;
  } else if (kind === "template") {
    payload.name = contentAttrs.template;
    payload.language = contentAttrs.language;
    payload.variables = contentAttrs.variables;
  } else {
    // Unsupported replay shape — mark to skip and move on.
    await bumpRetry(admin, msg.id, retryCount, "unsupported-replay-kind");
    return { skipped: "unsupported kind" };
  }

  const { data: sendRes, error: sendErr } = await admin.functions.invoke("channels-send", {
    body: {
      conversation_id: msg.conversation_id,
      type: kind,
      payload,
      storage_path: contentAttrs.storage_path,
      skip_dispatch: false,
    },
  });

  if (sendErr) {
    await bumpRetry(admin, msg.id, retryCount, sendErr.message ?? "invoke failed");
    return { error: sendErr.message };
  }

  const newStatus = (sendRes as any)?.dispatch?.status;
  if (newStatus === "sent") {
    // The retry created a NEW message row (the successful one). Mark the old
    // one as replayed so the scanner doesn't pick it up again.
    await admin
      .from("messages")
      .update({
        additional_attributes: {
          ...(msg.additional_attributes ?? {}),
          dispatch: {
            ...dispatch,
            status: "superseded",
            superseded_by: (sendRes as any)?.message?.id,
            retry_count: retryCount + 1,
            retried_at: new Date().toISOString(),
          },
        },
      })
      .eq("id", msg.id);
    return { retried: true, new_message_id: (sendRes as any)?.message?.id };
  }

  await bumpRetry(admin, msg.id, retryCount, (sendRes as any)?.dispatch?.failed_reason ?? "still failing");
  return { retried: false };
}

async function bumpRetry(admin: SupabaseClient, id: string, currentCount: number, reason: string) {
  const { data: current } = await admin
    .from("messages")
    .select("additional_attributes")
    .eq("id", id)
    .single();
  const existing = (current?.additional_attributes ?? {}) as Record<string, any>;
  const dispatch = (existing.dispatch ?? {}) as Record<string, any>;
  await admin
    .from("messages")
    .update({
      additional_attributes: {
        ...existing,
        dispatch: {
          ...dispatch,
          status: "failed",
          failed_reason: reason,
          retry_count: currentCount + 1,
          last_retry_at: new Date().toISOString(),
        },
      },
    })
    .eq("id", id);
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
