/**
 * Cliente do canal WhatsApp (Baileys direto, uma sessão por canal).
 * Credenciais e dados da sessão ficam no servidor (/data/sessions/<canal>);
 * o navegador só recebe estado e QR — este último em tempo real pelo socket.
 */
import { apiClient } from "@/lib/api-client";

export type WhatsAppStatus = "disconnected" | "connecting" | "qr_ready" | "connected";

export interface WhatsAppSession {
  id: string;
  name: string;
  enabled: boolean;
  status: WhatsAppStatus;
  phone: string | null;
  owner_jid: string | null;
  profile_name: string | null;
  profile_pic_url: string | null;
  counts: { contacts: number; chats: number; messages: number };
}

const base = (accountId: string) => `/accounts/${accountId}/whatsapp`;

export function listWhatsAppSessions(accountId: string): Promise<WhatsAppSession[]> {
  return apiClient.get(`${base(accountId)}/sessions`);
}

/** Cria o canal, sobe a sessão e já devolve o QR quando o WhatsApp o gerar. */
export async function provisionWhatsApp(args: {
  accountId: string;
  channelName?: string;
}): Promise<{
  ok: boolean;
  channel_id?: string;
  qrcode_base64?: string | null;
  status?: WhatsAppStatus;
  error?: string;
}> {
  try {
    return await apiClient.post(`${base(args.accountId)}/channels`, {
      channelName: args.channelName,
    });
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "falha ao criar a sessão" };
  }
}

export async function fetchQrcode(
  accountId: string,
  channelId: string,
): Promise<{ base64?: string | null; pairingCode?: string | null; error?: string }> {
  try {
    return await apiClient.get(`${base(accountId)}/channels/${channelId}/qrcode`);
  } catch (e: any) {
    return { error: e?.message ?? "falha ao buscar QR code" };
  }
}

export async function requestPairingCode(
  accountId: string,
  channelId: string,
  phone: string,
): Promise<{ code?: string; error?: string }> {
  try {
    return await apiClient.post(`${base(accountId)}/channels/${channelId}/pairing-code`, { phone });
  } catch (e: any) {
    return { error: e?.message ?? "falha ao gerar o código" };
  }
}

export function restartWhatsApp(accountId: string, channelId: string) {
  return apiClient.post(`${base(accountId)}/channels/${channelId}/restart`, {});
}

export function logoutWhatsApp(accountId: string, channelId: string) {
  return apiClient.post(`${base(accountId)}/channels/${channelId}/logout`, {});
}

export function updateWhatsAppChannel(
  accountId: string,
  channelId: string,
  patch: { name?: string; enabled?: boolean },
) {
  return apiClient.patch(`${base(accountId)}/channels/${channelId}`, patch);
}

export function deleteWhatsAppChannel(accountId: string, channelId: string) {
  return apiClient.delete(`${base(accountId)}/channels/${channelId}`);
}
