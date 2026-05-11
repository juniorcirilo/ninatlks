import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type WebhookDelivery = Tables<"webhook_deliveries">;

export async function fetchWebhookDeliveries(accountId: string, opts: { endpoint?: string; limit?: number } = {}) {
  const { endpoint, limit = 50 } = opts;
  let query = supabase
    .from("webhook_deliveries")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (endpoint) query = query.eq("endpoint", endpoint);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as WebhookDelivery[];
}
