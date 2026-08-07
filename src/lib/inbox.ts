import { apiClient } from "@/lib/api-client";

export type ConversationListItem = {
  id: string;
  contact_id: string;
  inbox_id: string;
  status: number;
  ai_autopilot_enabled: boolean;
  additional_attributes: Record<string, unknown>;
  last_activity_at: string;
  agent_last_seen_at: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  last_message_content: string | null;
  last_message_at: string | null;
  last_message_sender_type: string | null;
  unread: boolean;
};

export type ConversationMessage = {
  id: string;
  content: string | null;
  sender_type: string | null;
  message_type: number;
  content_type: number;
  content_attributes: Record<string, unknown>;
  created_at: string;
};

export async function fetchConversations(
  accountId: string,
  contactId?: string,
): Promise<ConversationListItem[]> {
  const qs = contactId ? `?contactId=${encodeURIComponent(contactId)}` : "";
  return apiClient.get<ConversationListItem[]>(`/accounts/${accountId}/conversations${qs}`);
}

export async function fetchConversationMessages(
  accountId: string,
  conversationId: string,
  before?: string,
): Promise<ConversationMessage[]> {
  const qs = before ? `?before=${encodeURIComponent(before)}` : "";
  return apiClient.get<ConversationMessage[]>(
    `/accounts/${accountId}/conversations/${conversationId}/messages${qs}`,
  );
}

export async function startConversation(
  accountId: string,
  contactId: string,
): Promise<{ id: string; created: boolean }> {
  return apiClient.post(`/accounts/${accountId}/conversations/start`, { contactId });
}

export async function sendConversationMessage(
  accountId: string,
  conversationId: string,
  content: string,
): Promise<{ ok: true; message_id: string; provider_id?: string }> {
  return apiClient.post(`/accounts/${accountId}/messages/send`, {
    conversationId,
    content,
  });
}

export async function setConversationAutopilot(
  accountId: string,
  conversationId: string,
  aiAutopilotEnabled: boolean,
): Promise<void> {
  await apiClient.patch(`/accounts/${accountId}/conversations/${conversationId}`, {
    aiAutopilotEnabled,
  });
}

export async function markConversationRead(
  accountId: string,
  conversationId: string,
): Promise<void> {
  await apiClient.patch(`/accounts/${accountId}/conversations/${conversationId}`, {
    markRead: true,
  });
}
