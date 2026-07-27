import { apiClient } from "@/lib/api-client";

export type Notification = {
  id: number;
  accountId: string;
  userId: string;
  kind: string;
  title: string;
  body: string | null;
  linkTo: string | null;
  metadata: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export async function fetchNotifications(accountId: string, limit = 30) {
  return apiClient.get<Notification[]>(`/accounts/${accountId}/notifications?limit=${limit}`);
}

export async function fetchUnreadCount(accountId: string) {
  const { count } = await apiClient.get<{ count: number }>(
    `/accounts/${accountId}/notifications/unread-count`,
  );
  return count;
}

export async function markNotificationRead(accountId: string, id: number) {
  await apiClient.patch(`/accounts/${accountId}/notifications/${id}/read`);
}

export async function markAllRead(accountId: string) {
  await apiClient.post(`/accounts/${accountId}/notifications/read-all`);
}
