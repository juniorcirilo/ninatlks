// Wrappers de gestão de equipe (membros + convites). Todos exigem admin.

import { apiClient } from "@/lib/api-client";

export type MemberRole = "admin" | "agent";

export type TeamMember = {
  user_id: string;
  email: string;
  name: string;
  role: MemberRole;
  joined_at: string;
};

export type Invite = {
  id: string;
  accountId: string;
  email: string;
  role: MemberRole;
  token: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  invitedByUserId: string | null;
};

export type InvitePreview = {
  account_name: string;
  role: MemberRole;
  email_hint: string;
  expires_at: string;
};

export async function listTeamMembers(accountId: string): Promise<TeamMember[]> {
  return apiClient.get<TeamMember[]>(`/accounts/${accountId}/members`);
}

export async function changeMemberRole(
  accountId: string,
  targetUserId: string,
  newRole: MemberRole,
): Promise<void> {
  await apiClient.patch(`/accounts/${accountId}/members/${targetUserId}/role`, { role: newRole });
}

export async function removeMember(accountId: string, targetUserId: string): Promise<void> {
  await apiClient.delete(`/accounts/${accountId}/members/${targetUserId}`);
}

export async function listInvites(accountId: string): Promise<Invite[]> {
  return apiClient.get<Invite[]>(`/accounts/${accountId}/invites`);
}

export async function createInvite(
  accountId: string,
  email: string,
  role: MemberRole,
): Promise<Invite> {
  return apiClient.post<Invite>(`/accounts/${accountId}/invites`, {
    email: email.trim().toLowerCase(),
    role,
  });
}

export async function revokeInvite(accountId: string, inviteId: string): Promise<void> {
  await apiClient.delete(`/accounts/${accountId}/invites/${inviteId}`);
}

/** For a user who's ALREADY logged in, joining a second workspace. */
export async function acceptInviteByToken(token: string): Promise<string> {
  const { accountId } = await apiClient.post<{ accountId: string }>(`/invites/${token}/accept`);
  return accountId;
}

export async function getInvitePreview(token: string): Promise<InvitePreview | null> {
  try {
    return await apiClient.get<InvitePreview>(`/invites/${token}/preview`);
  } catch {
    return null;
  }
}

/**
 * Monta a URL de convite usando a origem atual.
 */
export function buildInviteUrl(token: string): string {
  if (typeof window === "undefined") return `/auth?invite=${encodeURIComponent(token)}`;
  return `${window.location.origin}/auth?invite=${encodeURIComponent(token)}`;
}
