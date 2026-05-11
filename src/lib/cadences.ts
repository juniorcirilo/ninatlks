import { supabase } from "@/integrations/supabase/client";

export type CadenceTriggerEvent =
  | "stage_change"
  | "manual"
  | "no_show"
  | "meeting_attended";

export type CadenceChannel = "voice" | "whatsapp" | "email";

export type CadenceStep = {
  offset_hours: number;
  channel: CadenceChannel;
  template_key?: string | null;
};

export type Cadence = {
  id: string;
  name: string;
  description: string | null;
  trigger_event: CadenceTriggerEvent;
  trigger_stage_id: string | null;
  enabled: boolean;
  steps: CadenceStep[];
  pending_count: number;
  completed_count: number;
};

export const TRIGGER_LABEL: Record<CadenceTriggerEvent, string> = {
  manual: "Manual",
  stage_change: "Quando entra no stage",
  no_show: "Quando dá no-show",
  meeting_attended: "Após reunião realizada",
};

export const CHANNEL_LABEL: Record<CadenceChannel, string> = {
  voice: "Ligação",
  whatsapp: "WhatsApp",
  email: "E-mail",
};

export async function fetchCadences(accountId: string): Promise<Cadence[]> {
  const { data, error } = await (supabase as any).rpc("followup_list_cadences", {
    p_account_id: accountId,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    trigger_event: c.trigger_event,
    trigger_stage_id: c.trigger_stage_id,
    enabled: c.enabled,
    steps: Array.isArray(c.steps) ? c.steps : [],
    pending_count: Number(c.pending_count ?? 0),
    completed_count: Number(c.completed_count ?? 0),
  }));
}

export async function upsertCadence(input: {
  id?: string;
  account_id: string;
  name: string;
  description?: string | null;
  trigger_event: CadenceTriggerEvent;
  trigger_stage_id?: string | null;
  steps: CadenceStep[];
  enabled?: boolean;
}): Promise<string> {
  const payload = {
    account_id: input.account_id,
    name: input.name,
    description: input.description ?? null,
    trigger_event: input.trigger_event,
    trigger_stage_id: input.trigger_stage_id ?? null,
    steps: input.steps,
    enabled: input.enabled ?? true,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { error } = await (supabase as any)
      .from("follow_up_cadences")
      .update(payload)
      .eq("id", input.id);
    if (error) throw new Error(error.message);
    return input.id;
  }

  const { data, error } = await (supabase as any)
    .from("follow_up_cadences")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function deleteCadence(id: string): Promise<void> {
  const { error } = await (supabase as any)
    .from("follow_up_cadences")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function enrollContactInCadence(
  cadenceId: string,
  contactId: string,
): Promise<string> {
  const { data, error } = await (supabase as any).rpc("cadence_enroll_contact", {
    p_cadence_id: cadenceId,
    p_contact_id: contactId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
