// Shared: resolve a contact from email or phone, creating one if none exists.
// Used by billing + lead adapters so new leads from external systems enter
// the contact book + optionally trigger follow-up workflows.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

export interface ContactMatchInput {
  accountId: string;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  autoCreate?: boolean;
  source?: string;                 // e.g. "billing:asaas" or "lead:typeform" — goes into custom_attributes
}

export async function resolveOrCreateContact(
  admin: SupabaseClient,
  input: ContactMatchInput,
): Promise<string | null> {
  const { accountId, email, phone, name, autoCreate = true, source } = input;
  const normalizedPhone = phone ? (phone.startsWith("+") ? phone : `+${phone.replace(/\D/g, "")}`) : null;

  if (email) {
    const { data } = await admin
      .from("contacts")
      .select("id")
      .eq("account_id", accountId)
      .eq("email", email)
      .maybeSingle();
    if (data) return data.id;
  }

  if (normalizedPhone) {
    const { data } = await admin
      .from("contacts")
      .select("id")
      .eq("account_id", accountId)
      .eq("phone_number", normalizedPhone)
      .maybeSingle();
    if (data) return data.id;
  }

  if (!autoCreate) return null;
  if (!email && !normalizedPhone) return null;

  const identifier = email
    ? `email:${email}`
    : normalizedPhone
      ? `phone:${normalizedPhone}`
      : `anon:${crypto.randomUUID()}`;

  const { data: created, error } = await admin
    .from("contacts")
    .insert({
      account_id: accountId,
      name: name ?? email ?? normalizedPhone,
      email,
      phone_number: normalizedPhone,
      identifier,
      custom_attributes: source ? { source } : {},
    })
    .select("id")
    .single();
  if (error) {
    console.warn("[contact-match] insert failed", error);
    return null;
  }
  return created.id;
}
