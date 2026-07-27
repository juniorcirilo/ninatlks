// Action dispatcher. Maps a declarative { type, params } to a side effect
// on Nexus. Each action returns a small JSON result so workflow_runs can
// show what happened — no silent successes.
//
// When adding a new action type:
//   1. Add a case here
//   2. Document its params shape in the JSDoc above the case
//   3. Update /src/lib/workflows.ts with a TS shape + UI builder option

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import type { Logger } from "../logger.ts";

export interface ActionRequest {
  type: string;
  params: Record<string, any>;
}

export interface ActionContext {
  admin: SupabaseClient;
  accountId: string;
  contactId?: string | null;
  correlationId: string;
  event: Record<string, any>;
  logger: Logger;
}

export interface ActionResult {
  type: string;
  ok: boolean;
  output?: any;
  error?: string;
  durationMs: number;
}

/**
 * Interpolate {{path}} references inside any string value using the context.
 * Supports `{{event.payload.name}}`, `{{contact.phone_number}}`, etc.
 */
function interpolate(value: any, ctx: Record<string, any>): any {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
      const parts = path.split(".");
      let cur: any = ctx;
      for (const p of parts) cur = cur?.[p];
      return cur === undefined || cur === null ? "" : String(cur);
    });
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, ctx));
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolate(v, ctx);
    return out;
  }
  return value;
}

export async function runAction(
  action: ActionRequest,
  ctx: ActionContext,
): Promise<ActionResult> {
  const started = Date.now();
  const type = action.type;
  const params = interpolate(action.params ?? {}, {
    event: ctx.event,
    contact: ctx.contactId ? { id: ctx.contactId } : {},
  });
  const log = ctx.logger.child({ action_type: type });

  try {
    const output = await dispatch(type, params, ctx, log);
    return { type, ok: true, output, durationMs: Date.now() - started };
  } catch (err) {
    log.error("action failed", err);
    return {
      type,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

async function dispatch(
  type: string,
  params: Record<string, any>,
  ctx: ActionContext,
  log: Logger,
): Promise<any> {
  switch (type) {
    /**
     * voice.start_campaign
     * params: {
     *   name: string,
     *   persona_id?: uuid,
     *   phone_number_id: uuid,
     *   script_mode: "script_readback"|"conversational"|"hybrid",
     *   opening_script?: string,
     *   contact_ids?: uuid[],                 // if empty, falls back to ctx.contactId
     *   escalation_rules?: any[],
     * }
     */
    case "voice.start_campaign": {
      const contactIds =
        params.contact_ids && params.contact_ids.length > 0
          ? params.contact_ids
          : ctx.contactId
            ? [ctx.contactId]
            : [];
      if (contactIds.length === 0) throw new Error("no contacts to call");
      const { data, error } = await ctx.admin.functions.invoke("voice-campaign-start", {
        body: {
          account_id: ctx.accountId,
          name: params.name ?? `Auto campaign ${new Date().toISOString()}`,
          persona_id: params.persona_id,
          phone_number_id: params.phone_number_id,
          script_mode: params.script_mode ?? "conversational",
          opening_script: params.opening_script,
          system_prompt: params.system_prompt,
          contact_ids: contactIds,
          escalation_rules: params.escalation_rules ?? [],
          voicemail_detection: params.voicemail_detection ?? true,
          record_call: params.record_call ?? true,
        },
        headers: { "x-correlation-id": ctx.correlationId },
      });
      if (error) throw error;
      return data;
    }

    /**
     * message.send_template
     * params: { conversation_id?: uuid, contact_id?: uuid, inbox_id?: uuid,
     *          template_name: string, language: string, variables: {...} }
     * At least one of conversation_id / contact_id must be present.
     */
    case "message.send_template": {
      let conversationId = params.conversation_id;
      if (!conversationId && params.contact_id && params.inbox_id) {
        // Find or create open conversation for this contact+inbox
        const { data: existing } = await ctx.admin
          .from("conversations")
          .select("id")
          .eq("account_id", ctx.accountId)
          .eq("contact_id", params.contact_id)
          .eq("inbox_id", params.inbox_id)
          .eq("status", 0)
          .order("last_activity_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existing) conversationId = existing.id;
        else {
          const { data: created } = await ctx.admin
            .from("conversations")
            .insert({
              account_id: ctx.accountId,
              contact_id: params.contact_id,
              inbox_id: params.inbox_id,
              status: 0,
            })
            .select("id")
            .single();
          conversationId = created!.id;
        }
      }
      if (!conversationId) throw new Error("conversation_id or (contact_id+inbox_id) required");

      const { data, error } = await ctx.admin.functions.invoke("channels-send", {
        body: {
          conversation_id: conversationId,
          type: "template",
          payload: {
            name: params.template_name,
            language: params.language ?? "pt_BR",
            variables: params.variables ?? {},
          },
        },
        headers: { "x-correlation-id": ctx.correlationId },
      });
      if (error) throw error;
      return data;
    }

    /**
     * message.send_text
     * params: { conversation_id?: uuid, contact_id?: uuid, inbox_id?: uuid, body: string }
     */
    case "message.send_text": {
      let conversationId = params.conversation_id;
      if (!conversationId && params.contact_id && params.inbox_id) {
        const { data: existing } = await ctx.admin
          .from("conversations")
          .select("id")
          .eq("account_id", ctx.accountId)
          .eq("contact_id", params.contact_id)
          .eq("inbox_id", params.inbox_id)
          .eq("status", 0)
          .order("last_activity_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        conversationId = existing?.id;
      }
      if (!conversationId) throw new Error("conversation_id required or contact_id+inbox_id");
      const { data, error } = await ctx.admin.functions.invoke("channels-send", {
        body: { conversation_id: conversationId, type: "text", payload: { body: params.body } },
        headers: { "x-correlation-id": ctx.correlationId },
      });
      if (error) throw error;
      return data;
    }

    /**
     * contact.update
     * params: { contact_id?: uuid, fields: { name?, phone_number?, email?, custom_attributes? } }
     */
    case "contact.update": {
      const contactId = params.contact_id ?? ctx.contactId;
      if (!contactId) throw new Error("contact_id required");
      const allowed = [
        "name",
        "phone_number",
        "email",
        "location",
        "identifier",
        "custom_attributes",
      ];
      const patch: Record<string, any> = {};
      for (const k of allowed) if (params.fields && k in params.fields) patch[k] = params.fields[k];
      const { data, error } = await ctx.admin
        .from("contacts")
        .update(patch)
        .eq("id", contactId)
        .eq("account_id", ctx.accountId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    /**
     * contact.add_tag
     * params: { contact_id?: uuid, tag: string }
     */
    case "contact.add_tag": {
      const contactId = params.contact_id ?? ctx.contactId;
      if (!contactId || !params.tag) throw new Error("contact_id and tag required");
      const { data, error } = await ctx.admin
        .from("contact_tags")
        .upsert(
          { account_id: ctx.accountId, contact_id: contactId, tag: params.tag },
          { onConflict: "account_id,contact_id,tag", ignoreDuplicates: true },
        )
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    }

    /**
     * task.create — creates a row in notifications table scoped to an admin.
     * Until we ship a proper tasks table this doubles as a todo inbox entry.
     * params: { user_id?: uuid, title: string, body?: string, link_to?: string, kind?: string }
     */
    case "task.create": {
      let userId = params.user_id;
      if (!userId) {
        const { data: admin } = await ctx.admin
          .from("user_roles")
          .select("user_id")
          .eq("account_id", ctx.accountId)
          .eq("role", "admin")
          .limit(1)
          .maybeSingle();
        userId = admin?.user_id;
      }
      if (!userId) throw new Error("no user_id and no account admin to notify");
      const { data, error } = await ctx.admin
        .from("notifications")
        .insert({
          account_id: ctx.accountId,
          user_id: userId,
          kind: params.kind ?? "workflow_task",
          title: params.title,
          body: params.body ?? null,
          link_to: params.link_to ?? null,
          metadata: { from_workflow: true, correlation_id: ctx.correlationId },
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    /**
     * notification.send — push a notification to every admin
     * params: { kind: string, title: string, body?: string, link_to?: string }
     */
    case "notification.send": {
      const { data: admins } = await ctx.admin
        .from("user_roles")
        .select("user_id")
        .eq("account_id", ctx.accountId)
        .eq("role", "admin");
      const rows = (admins ?? []).map((a) => ({
        account_id: ctx.accountId,
        user_id: a.user_id,
        kind: params.kind ?? "workflow",
        title: params.title,
        body: params.body ?? null,
        link_to: params.link_to ?? null,
        metadata: { from_workflow: true, correlation_id: ctx.correlationId },
      }));
      if (rows.length === 0) return { inserted: 0 };
      const { error } = await ctx.admin.from("notifications").insert(rows);
      if (error) throw error;
      return { inserted: rows.length };
    }

    /**
     * deal.move_stage — enqueue CRM write. crm-sync-worker picks it up and
     * pushes to Pipedrive/HubSpot. Retries with exponential backoff on failure.
     * params: { provider, provider_deal_id, stage_id?, status?, lost_reason?, value? }
     */
    case "deal.move_stage": {
      if (!params.provider || !params.provider_deal_id) {
        throw new Error("provider and provider_deal_id required");
      }
      const { data, error } = await ctx.admin
        .from("crm_sync_queue")
        .insert({
          account_id: ctx.accountId,
          provider: params.provider,
          operation:
            params.status === "won"
              ? "deal.win"
              : params.status === "lost"
                ? "deal.lose"
                : "deal.move_stage",
          target: { provider_deal_id: params.provider_deal_id },
          payload: params,
        })
        .select()
        .single();
      if (error) throw error;
      ctx.admin.functions.invoke("crm-sync-worker", { body: {} }).catch(() => {});
      return { queued_task_id: data.id };
    }

    /**
     * deal.create — enqueue CRM deal creation.
     * params: { provider, title, value?, currency?, pipeline_id?, stage_id?,
     *           person_id?, contact_id?, expected_close_date? }
     */
    case "deal.create": {
      if (!params.provider || !params.title) throw new Error("provider and title required");
      const { data, error } = await ctx.admin
        .from("crm_sync_queue")
        .insert({
          account_id: ctx.accountId,
          provider: params.provider,
          operation: "deal.create",
          target: { contact_id: params.contact_id ?? ctx.contactId },
          payload: params,
        })
        .select()
        .single();
      if (error) throw error;
      ctx.admin.functions.invoke("crm-sync-worker", { body: {} }).catch(() => {});
      return { queued_task_id: data.id };
    }

    /**
     * crm.activity_create — log a CRM activity (call/task/note).
     * params: { provider, subject, type?, note?, provider_deal_id?, provider_person_id?, done? }
     */
    case "crm.activity_create": {
      if (!params.provider || !params.subject) {
        throw new Error("provider and subject required");
      }
      const { data, error } = await ctx.admin
        .from("crm_sync_queue")
        .insert({
          account_id: ctx.accountId,
          provider: params.provider,
          operation: "activity.create",
          target: {
            provider_deal_id: params.provider_deal_id,
            provider_person_id: params.provider_person_id,
          },
          payload: params,
        })
        .select()
        .single();
      if (error) throw error;
      ctx.admin.functions.invoke("crm-sync-worker", { body: {} }).catch(() => {});
      return { queued_task_id: data.id };
    }

    /**
     * delay — sleep-and-resume primitive. Currently only logs; full scheduler
     * lands when we have background worker queue (Phase 4).
     */
    case "delay": {
      log.info("delay requested (no-op in v1)", params);
      return { noop: true, would_sleep_sec: params.seconds ?? 0 };
    }

    default:
      throw new Error(`unknown action type: ${type}`);
  }
}
