import { query } from "@/lib/db";
// Linha do tempo unificada por conversa (Fase 1B).
// Lê a view v_conversation_timeline (security_invoker → RLS das tabelas-base).
import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";
type Json = Record<string, any> | any[] | string | number | boolean | null;

export interface TimelineItem {
  item_id: string;
  conversation_id: string | null;
  kind: "message" | "voice_call" | "meeting" | "handoff";
  occurred_at: string;
  payload: Json;
}

export const getConversationTimeline = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z
      .object({
        accountId: z.string().uuid(),
        conversationId: z.string().uuid(),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const rows = await query<{
      item_id: string;
      conversation_id: string | null;
      kind: "message" | "voice_call" | "meeting" | "handoff";
      occurred_at: string;
      payload: Json;
    }>(
      `SELECT item_id, conversation_id, kind, occurred_at, payload
       FROM v_conversation_timeline
       WHERE account_id = $1 AND conversation_id = $2
       ORDER BY occurred_at ASC
       LIMIT $3`,
      [data.accountId, data.conversationId, data.limit],
    );
    return { items: (rows ?? []) as unknown as TimelineItem[] };
  });
