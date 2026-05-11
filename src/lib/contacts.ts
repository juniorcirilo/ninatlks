import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Contact = Tables<"contacts">;

export async function createContact(
  accountId: string,
  input: { name: string; email?: string; phone_number?: string; location?: string },
): Promise<Contact> {
  const { data, error } = await supabase
    .from("contacts")
    .insert({
      account_id: accountId,
      name: input.name,
      email: input.email ?? null,
      phone_number: input.phone_number ?? null,
      location: input.location ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Contact;
}

export async function lgpdDeleteContact(contactId: string): Promise<void> {
  const { error } = await supabase.rpc("lgpd_delete_contact", { p_contact_id: contactId });
  if (error) throw error;
}

export async function mergeContacts(primaryId: string, duplicateIds: string[]) {
  const { data, error } = await supabase.functions.invoke("contacts-merge", {
    body: { primary_id: primaryId, duplicate_ids: duplicateIds },
  });
  if (error) throw error;
  return data as {
    ok: boolean;
    merged_count?: number;
    moved_conversations?: number;
    moved_contact_inboxes?: number;
  };
}
