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
  contact_avatar: string | null;
  last_message_content: string | null;
  last_message_at: string | null;
  last_message_sender_type: string | null;
  unread: boolean;
};

export type DeliveryStatus = "sent" | "delivered" | "read" | "played" | "error";

export type ConversationMessage = {
  id: string;
  content: string | null;
  sender_type: string | null;
  message_type: number;
  content_type: number;
  content_attributes: MessageAttributes;
  created_at: string;
  media_url?: string;
  delivery_status?: DeliveryStatus | null;
  delivery_error?: string | null;
};

export type InteractiveButtonInput = {
  type: "reply" | "url" | "copy" | "call";
  displayText: string;
  id?: string;
  url?: string;
  copyCode?: string;
  phoneNumber?: string;
};

export type InteractiveSectionInput = {
  title: string;
  rows: { title: string; rowId: string; description?: string }[];
};

export type MessageAttributes = {
  kind?: string;
  mime?: string;
  filename?: string;
  caption?: string;
  size?: number;
  storage_path?: string;
  selected_id?: string;
  forwarded?: boolean;
  reply_to?: { message_id: string; content: string | null; from_me: boolean };
  title?: string;
  description?: string;
  footer?: string;
  buttons?: InteractiveButtonInput[];
  buttonText?: string;
  sections?: InteractiveSectionInput[];
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
  replyToMessageId?: string,
): Promise<SendResult> {
  return apiClient.post(`/accounts/${accountId}/messages/send`, {
    conversationId,
    content,
    replyToMessageId,
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

export type SendResult =
  | { ok: true; message_id: string; provider_id?: string }
  | { ok: false; message_id: string; error: string };

export async function sendConversationMedia(
  accountId: string,
  conversationId: string,
  file: File,
  caption?: string,
  replyToMessageId?: string,
): Promise<SendResult> {
  const form = new FormData();
  form.append("conversationId", conversationId);
  if (replyToMessageId) form.append("replyToMessageId", replyToMessageId);
  if (caption?.trim()) form.append("caption", caption.trim());
  form.append("file", file);
  return apiClient.post(`/accounts/${accountId}/messages/send-media`, form);
}

export type InteractiveInput =
  | {
      kind: "buttons";
      title: string;
      description: string;
      footer?: string;
      buttons: InteractiveButtonInput[];
    }
  | {
      kind: "list";
      title: string;
      description?: string;
      footer?: string;
      buttonText: string;
      sections: InteractiveSectionInput[];
    };

export async function sendConversationInteractive(
  accountId: string,
  conversationId: string,
  input: InteractiveInput,
  replyToMessageId?: string,
): Promise<SendResult> {
  return apiClient.post(`/accounts/${accountId}/messages/send-interactive`, {
    conversationId,
    ...input,
    replyToMessageId,
  });
}

export async function sendConversationPresence(
  accountId: string,
  conversationId: string,
  presence: "composing" | "recording" | "paused",
): Promise<void> {
  await apiClient.post(`/accounts/${accountId}/messages/presence`, { conversationId, presence });
}

export type DirectoryContact = {
  jid: string;
  name: string | null;
  phone: string | null;
  picture: string | null;
  resolved_lid: boolean;
};

export type DirectoryGroup = {
  jid: string;
  name: string;
  picture: string | null;
  size: number;
};

export function fetchDirectoryContacts(accountId: string, refresh = false) {
  return apiClient.get<DirectoryContact[]>(
    `/accounts/${accountId}/evolution/directory/contacts${refresh ? "?refresh=1" : ""}`,
  );
}

export function fetchDirectoryGroups(accountId: string, refresh = false) {
  return apiClient.get<DirectoryGroup[]>(
    `/accounts/${accountId}/evolution/directory/groups${refresh ? "?refresh=1" : ""}`,
  );
}

export function startConversationByJid(
  accountId: string,
  input: { jid: string; name?: string | null; picture?: string | null },
) {
  return apiClient.post<{ id: string; created: boolean; contact_id: string }>(
    `/accounts/${accountId}/conversations/start-jid`,
    { jid: input.jid, name: input.name ?? undefined, picture: input.picture ?? undefined },
  );
}

export function forwardMessage(accountId: string, messageId: string, conversationIds: string[]) {
  return apiClient.post<{ ok: boolean; results: (SendResult & { conversation_id: string })[] }>(
    `/accounts/${accountId}/messages/forward`,
    { messageId, conversationIds },
  );
}

export function resendMessage(accountId: string, messageId: string) {
  return apiClient.post<SendResult>(`/accounts/${accountId}/messages/${messageId}/resend`, {});
}
