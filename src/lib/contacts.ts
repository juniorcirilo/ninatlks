import { apiClient } from "@/lib/api-client";

export type Contact = {
  id: string;
  accountId: string;
  name: string | null;
  email: string | null;
  phoneNumber: string | null;
  identifier: string | null;
  additionalAttributes: Record<string, unknown>;
  customAttributes: Record<string, unknown>;
  location: string | null;
  countryCode: string | null;
  blocked: boolean;
  companyId: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  timezone: string | null;
  stageId: string | null;
  score: number;
  source: string | null;
  stageChangedAt: string | null;
  briefing: Record<string, unknown> | null;
  lastSentiment: string | null;
  lastSentimentScore: number | null;
  autoMovedAt: string | null;
  lifecycleStage: string;
  operationalStatus: string;
  ownerUserId: string | null;
  lastCallAt: string | null;
  lastWhatsappAt: string | null;
  notes: string | null;
};

export async function createContact(
  accountId: string,
  input: { name: string; email?: string; phone_number?: string; location?: string },
): Promise<Contact> {
  return apiClient.post<Contact>(`/accounts/${accountId}/contacts`, {
    name: input.name,
    email: input.email,
    phoneNumber: input.phone_number,
    location: input.location,
  });
}

export async function lgpdDeleteContact(accountId: string, contactId: string): Promise<void> {
  await apiClient.delete(`/accounts/${accountId}/contacts/${contactId}/lgpd`);
}

export async function mergeContacts(accountId: string, primaryId: string, duplicateIds: string[]) {
  const result = await apiClient.post<{
    primary_id: string;
    merged_count: number;
    moved_conversations: number;
    moved_contact_inboxes: number;
  }>(`/accounts/${accountId}/contacts/merge`, {
    primaryId,
    duplicateIds,
  });
  return {
    ok: true,
    merged_count: result.merged_count,
    moved_conversations: result.moved_conversations,
    moved_contact_inboxes: result.moved_contact_inboxes,
  };
}
