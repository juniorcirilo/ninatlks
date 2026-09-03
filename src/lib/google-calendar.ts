import { apiClient } from "@/lib/api-client";

export type GoogleCalendarStatus = {
  configured: boolean; // esta conta tem client_id/secret (vault ou GOOGLE_CLIENT_ID/SECRET do servidor)
  redirectUri: string; // URL de callback a cadastrar no Google Cloud Console
  connected: boolean; // esta conta já autorizou
  email: string | null;
  enabled: boolean;
};

export async function fetchGoogleCalendarStatus(accountId: string): Promise<GoogleCalendarStatus> {
  return apiClient.get<GoogleCalendarStatus>(`/accounts/${accountId}/google-calendar/status`);
}

/** Redireciona o navegador pro consentimento do Google — não é uma chamada fetch normal. */
export async function connectGoogleCalendar(accountId: string): Promise<void> {
  const { url } = await apiClient.get<{ url: string }>(
    `/accounts/${accountId}/google-calendar/connect`,
  );
  window.location.href = url;
}

export async function disconnectGoogleCalendar(accountId: string): Promise<void> {
  await apiClient.delete(`/accounts/${accountId}/google-calendar`);
}
