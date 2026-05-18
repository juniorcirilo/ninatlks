// Linha do tempo unificada por conversa (Fase 1B).
// Lê a view v_conversation_timeline (security_invoker → RLS das tabelas-base).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface TimelineItem {
  item_id: string;
  conversation_id: string | null;
  kind: "message" | "voice_call" | "meeting" | "handoff";
  occurred_at: string;
  payload: Record<string, unknown>;
}

export const getConversationTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      accountId: z.string().uuid(),
      conversationId: z.string().uuid(),
      limit: z.number().int().min(1).max(500).default(200),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("v_conversation_timeline" as never)
      .select("item_id, conversation_id, kind, occurred_at, payload")
      .eq("account_id", data.accountId)
      .eq("conversation_id", data.conversationId)
      .order("occurred_at", { ascending: true })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return { items: (rows ?? []) as unknown as TimelineItem[] };
  });
