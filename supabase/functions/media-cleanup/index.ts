// Daily storage/database cleanup:
//   - Delete voice-recordings older than VOICE_RECORDING_TTL_DAYS (default 90)
//     for rows where voice_calls.recording_storage_path is set.
//   - Delete attachments older than ATTACHMENT_TTL_DAYS (default 180).
//   - Delete customer_memory_nodes rows past expires_at (Cloud data minimization).
//   - Delete csat_surveys older than 30 days (regardless of status).
//   - Delete channel_usage_metrics older than 180 days (telemetry doesn't need
//     to live forever).
//   - Delete webhook_deliveries older than 90 days.
//
// Service-role only. Idempotent. Run daily via pg_cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { loggerFor } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const log = loggerFor(req, { function: "media-cleanup" });
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isService = (req.headers.get("Authorization") ?? "").includes(serviceKey);
  if (!isService) return json({ error: "service role required" }, 403);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const stats: Record<string, number> = {};

  const recordingTtl = parseInt(Deno.env.get("VOICE_RECORDING_TTL_DAYS") ?? "90", 10);
  const attachmentTtl = parseInt(Deno.env.get("ATTACHMENT_TTL_DAYS") ?? "180", 10);
  const dbTtl = parseInt(Deno.env.get("TELEMETRY_TTL_DAYS") ?? "90", 10);

  stats.memory_nodes_expired = await deleteExpired(supabase, log, "customer_memory_nodes", "expires_at", new Date());
  stats.memory_nodes_expired_count = stats.memory_nodes_expired;

  stats.csat_surveys_old = await deleteOlder(supabase, log, "csat_surveys", 30);
  stats.channel_usage_old = await deleteOlder(supabase, log, "channel_usage_metrics", 180);
  stats.webhook_deliveries_old = await deleteOlder(supabase, log, "webhook_deliveries", dbTtl);

  stats.recordings_cleaned = await cleanupStorage(
    supabase,
    log,
    "voice-recordings",
    recordingTtl,
    "voice_calls",
    "recording_storage_path",
  );
  stats.attachments_cleaned = await cleanupOrphanAttachments(supabase, log, attachmentTtl);

  log.info("cleanup complete", stats);
  return json({ ok: true, ...stats });
});

async function deleteExpired(supabase: any, log: any, table: string, col: string, asOf: Date) {
  const { data, error } = await supabase
    .from(table)
    .delete({ count: "exact" })
    .lt(col, asOf.toISOString())
    .select(col, { count: "exact", head: true });
  if (error) {
    log.warn(`delete expired ${table} failed`, error);
    return 0;
  }
  return (data as any)?.length ?? 0;
}

async function deleteOlder(supabase: any, log: any, table: string, days: number) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const { error, count } = await supabase
    .from(table)
    .delete({ count: "exact" })
    .lt("created_at", cutoff);
  if (error) {
    log.warn(`delete old ${table} failed`, error);
    return 0;
  }
  return count ?? 0;
}

async function cleanupStorage(
  supabase: any,
  log: any,
  bucket: string,
  ttlDays: number,
  refTable: string,
  refCol: string,
): Promise<number> {
  const cutoffIso = new Date(Date.now() - ttlDays * 86400000).toISOString();
  // Find DB rows whose recording is expired; delete both DB field and object.
  const { data: rows } = await supabase
    .from(refTable)
    .select(`id, ${refCol}, created_at`)
    .lt("created_at", cutoffIso)
    .not(refCol, "is", null)
    .limit(500);
  let removed = 0;
  for (const r of rows ?? []) {
    const path = r[refCol] as string;
    const [maybeBucket, ...rest] = path.split("/");
    const actualBucket = rest.length ? maybeBucket : bucket;
    const key = rest.length ? rest.join("/") : path;
    const { error: rmErr } = await supabase.storage.from(actualBucket).remove([key]);
    if (rmErr) {
      log.warn("storage remove failed", rmErr, { path });
      continue;
    }
    await supabase.from(refTable).update({ [refCol]: null }).eq("id", r.id);
    removed++;
  }
  return removed;
}

/**
 * Best-effort orphan attachment cleanup: deletes storage objects older than
 * TTL that aren't referenced in any message.content_attributes.storage_path.
 * Limited to 200 objects per run to avoid runaway deletes.
 */
async function cleanupOrphanAttachments(supabase: any, log: any, ttlDays: number): Promise<number> {
  // Placeholder — listing buckets via Storage API requires pagination per
  // folder. We keep a conservative default that lists the account_id root
  // and inspects objects in last N days. Leave as TODO; start with 0.
  log.info("orphan attachment scan skipped — TODO implement", { ttlDays });
  return 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
