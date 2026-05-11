// Shared helpers for sending outbound messages via Meta Cloud API.
// Used by `whatsapp-incoming`, `instagram-incoming` and `persona-auto-reply`.

export interface MetaChannelConfig {
  access_token?: string;
  phone_number_id?: string; // whatsapp
  ig_account_id?: string; // instagram
  verify_token?: string;
}

export async function sendWhatsAppMessage(params: {
  to: string;
  text: string;
  phoneNumberId: string;
  accessToken: string;
}): Promise<{ messageId?: string }> {
  const { to, text, phoneNumberId, accessToken } = params;
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/^\+/, ""),
      type: "text",
      text: { body: text },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WhatsApp send failed: ${res.status} ${errText}`);
  }
  const json = await res.json();
  return { messageId: json.messages?.[0]?.id };
}

export async function sendInstagramMessage(params: {
  recipientId: string;
  text: string;
  accessToken: string;
}): Promise<{ messageId?: string }> {
  const { recipientId, text, accessToken } = params;
  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Instagram send failed: ${res.status} ${errText}`);
  }
  const json = await res.json();
  return { messageId: json.message_id };
}

export function getAccessToken(
  providerConfig: unknown,
  envFallback?: string,
): string {
  const cfg = (providerConfig ?? {}) as MetaChannelConfig;
  const token = cfg.access_token ?? envFallback;
  if (!token) throw new Error("Meta access token not configured");
  return token;
}
