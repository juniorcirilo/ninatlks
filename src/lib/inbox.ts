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
  /** cabeçalho de mídia numa mensagem interativa */
  media_kind?: "image" | "video";
  name?: string;
  phone?: string;
  selected_id?: string;
  forwarded?: boolean;
  reply_to?: {
    message_id: string;
    /** id interno da mensagem citada (para rolar até ela) */
    target_id?: string;
    content: string | null;
    from_me: boolean;
    media_kind?: string;
    author_name?: string;
    edited?: boolean;
    deleted?: boolean;
  };
  /** transcrição automática (STT) de áudios */
  transcript?: string;
  edited?: boolean;
  edited_at?: string;
  deleted?: boolean;
  deleted_at?: string;
  /** texto antes da 1ª edição / da exclusão (citação interna) */
  original_content?: string | null;
  /** remetente real em grupos */
  sender?: { jid: string; name: string | null; avatar_url: string | null };
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
  media?: File | null,
): Promise<SendResult> {
  if (media) {
    const form = new FormData();
    form.append("conversationId", conversationId);
    if (replyToMessageId) form.append("replyToMessageId", replyToMessageId);
    form.append("payload", JSON.stringify(input));
    form.append("file", media);
    return apiClient.post(`/accounts/${accountId}/messages/send-interactive-media`, form);
  }
  return apiClient.post(`/accounts/${accountId}/messages/send-interactive`, {
    conversationId,
    ...input,
    replyToMessageId,
  });
}

export async function sendConversationContact(
  accountId: string,
  conversationId: string,
  contact: { name: string; phone: string },
  replyToMessageId?: string,
): Promise<SendResult> {
  return apiClient.post(`/accounts/${accountId}/messages/send-contact`, {
    conversationId,
    ...contact,
    replyToMessageId,
  });
}

export type PixKeyType = "cpf" | "cnpj" | "phone" | "email" | "random";

export async function sendConversationPix(
  accountId: string,
  conversationId: string,
  pix: {
    key: string;
    keyType: PixKeyType;
    title?: string;
    description?: string;
    footer?: string;
    beneficiary?: string;
    amount?: string;
  },
  replyToMessageId?: string,
): Promise<SendResult> {
  return apiClient.post(`/accounts/${accountId}/messages/send-pix`, {
    conversationId,
    ...pix,
    replyToMessageId,
  });
}

export type DraftTemplate =
  | "buttons"
  | "list"
  | "image_buttons"
  | "video_buttons"
  | "pix"
  | "link_image_buttons"
  | "coupon"
  | "promo"
  | "launch"
  | "event"
  | "booking"
  | "nps"
  | "review"
  | "cart";

export type InteractiveDraft = {
  title: string;
  description: string;
  footer?: string;
  buttonText?: string;
  buttons?: { text: string; value?: string }[];
  rows?: { title: string; description?: string }[];
  beneficiary?: string;
  amount?: string;
  key?: string;
  link?: string;
  fields?: Record<string, string>;
};

export async function generateInteractiveDraft(
  accountId: string,
  body: { template: DraftTemplate; prompt: string; buttonMode?: "reply" | "action" },
): Promise<InteractiveDraft> {
  return apiClient.post(`/accounts/${accountId}/messages/interactive-draft`, body);
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
};

export type DirectoryGroup = {
  jid: string;
  name: string;
  picture: string | null;
  size: number;
};

/** `pending` > 0 enquanto o servidor ainda busca fotos em segundo plano. */
export type Directory<T> = { items: T[]; pending: number };

export function fetchDirectoryContacts(accountId: string) {
  return apiClient.get<Directory<DirectoryContact>>(
    `/accounts/${accountId}/whatsapp/directory/contacts`,
  );
}

export function fetchDirectoryGroups(accountId: string) {
  return apiClient.get<Directory<DirectoryGroup>>(
    `/accounts/${accountId}/whatsapp/directory/groups`,
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

export function editMessage(accountId: string, messageId: string, content: string) {
  return apiClient.patch<{ ok: true }>(`/accounts/${accountId}/messages/${messageId}/edit`, {
    content,
  });
}

export function deleteMessage(accountId: string, messageId: string) {
  return apiClient.delete<{ ok: true }>(`/accounts/${accountId}/messages/${messageId}`);
}

export function transcribeMessage(accountId: string, messageId: string) {
  return apiClient.post<{ transcript: string }>(
    `/accounts/${accountId}/messages/${messageId}/transcribe`,
    {},
  );
}

export function sendSpeech(accountId: string, conversationId: string, content: string) {
  return apiClient.post<SendResult>(`/accounts/${accountId}/messages/send-speech`, {
    conversationId,
    content,
  });
}

export function resendMessage(accountId: string, messageId: string) {
  return apiClient.post<SendResult>(`/accounts/${accountId}/messages/${messageId}/resend`, {});
}

/** Assina a presença (digitando/online) dos chats ativos. Melhor esforço. */
export async function subscribeConversationsPresence(
  accountId: string,
  conversationIds: string[],
): Promise<void> {
  if (conversationIds.length === 0) return;
  await apiClient.post(`/accounts/${accountId}/messages/presence/subscribe`, { conversationIds });
}
