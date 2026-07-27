/**
 * Thin browser client for the Evolution-backed WhatsApp channel endpoints.
 * The actual Evolution API key never reaches the browser after provisioning
 * — it's stored on channels.config and used server-side.
 */
import { apiClient } from "@/lib/api-client";

export type EvolutionStatus = "disconnected" | "connecting" | "qr_ready" | "connected";

export async function testEvolution(args: {
  accountId: string;
  evolutionUrl: string;
  evolutionApiKey: string;
}): Promise<{ ok: boolean; instance_count?: number; error?: string; hint?: string }> {
  try {
    return await apiClient.post(`/accounts/${args.accountId}/evolution/test`, {
      evolutionUrl: args.evolutionUrl,
      evolutionApiKey: args.evolutionApiKey,
    });
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "falha ao testar conexão" };
  }
}

export async function provisionEvolution(args: {
  accountId: string;
  evolutionUrl: string;
  evolutionApiKey: string;
  channelId?: string;
  channelName?: string;
}): Promise<{
  ok: boolean;
  channel_id?: string;
  instance_name?: string;
  qrcode_base64?: string | null;
  status?: EvolutionStatus;
  error?: string;
}> {
  try {
    return await apiClient.post(`/accounts/${args.accountId}/evolution/provision`, {
      evolutionUrl: args.evolutionUrl,
      evolutionApiKey: args.evolutionApiKey,
      channelId: args.channelId,
      channelName: args.channelName,
    });
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "falha ao provisionar" };
  }
}

export async function fetchQrcode(
  accountId: string,
  channelId: string,
): Promise<{ base64?: string | null; pairingCode?: string | null; error?: string }> {
  try {
    return await apiClient.get(`/accounts/${accountId}/evolution/channels/${channelId}/qrcode`);
  } catch (e: any) {
    return { error: e?.message ?? "falha ao buscar QR code" };
  }
}

export async function fetchEvolutionStatus(
  accountId: string,
  channelId: string,
): Promise<{ status?: EvolutionStatus | "not_found"; raw?: string | null; error?: string }> {
  try {
    return await apiClient.get(`/accounts/${accountId}/evolution/channels/${channelId}/status`);
  } catch (e: any) {
    const msg = e?.message ?? "";
    if (e?.status === 404 || msg.toLowerCase().includes("not found")) {
      return { status: "not_found" };
    }
    return { error: msg };
  }
}

export async function deleteEvolutionInstance(
  accountId: string,
  channelId: string,
): Promise<{ ok: boolean; remote_deleted?: boolean; remote_error?: string; error?: string }> {
  try {
    return await apiClient.delete(`/accounts/${accountId}/evolution/channels/${channelId}`);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "falha ao remover instância" };
  }
}
