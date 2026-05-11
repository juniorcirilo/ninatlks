// Wrappers de gestão de equipe (membros + convites). Todos exigem admin.

import { supabase } from "@/integrations/supabase/client";

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
  email: string;
  role: MemberRole;
  token: string;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  invited_by_user_id: string | null;
};

export type InvitePreview = {
  account_name: string;
  role: MemberRole;
  email_hint: string;
  expires_at: string;
};

export async function listTeamMembers(accountId: string): Promise<TeamMember[]> {
  const { data, error } = await (supabase as any).rpc("team_list_members", {
    p_account_id: accountId,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as TeamMember[]).map((m) => ({
    ...m,
    role: (m.role === "admin" ? "admin" : "agent") as MemberRole,
  }));
}

export async function changeMemberRole(
  accountId: string,
  targetUserId: string,
  newRole: MemberRole,
): Promise<void> {
  const { error } = await (supabase as any).rpc("team_change_role", {
    p_account_id: accountId,
    p_target_user_id: targetUserId,
    p_new_role: newRole,
  });
  if (error) throw new Error(error.message);
}

export async function removeMember(
  accountId: string,
  targetUserId: string,
): Promise<void> {
  const { error } = await (supabase as any).rpc("team_remove_member", {
    p_account_id: accountId,
    p_target_user_id: targetUserId,
  });
  if (error) throw new Error(error.message);
}

export async function listInvites(accountId: string): Promise<Invite[]> {
  const { data, error } = await (supabase as any)
    .from("invites")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Invite[];
}

export async function createInvite(
  accountId: string,
  email: string,
  role: MemberRole,
): Promise<Invite> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await (supabase as any)
    .from("invites")
    .insert({
      account_id: accountId,
      email: email.trim().toLowerCase(),
      role,
      invited_by_user_id: userData?.user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Invite;
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from("invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId);
  if (error) throw new Error(error.message);
}

export async function acceptInviteByToken(token: string): Promise<string> {
  const { data, error } = await (supabase as any).rpc("invites_accept", {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function getInvitePreview(
  token: string,
): Promise<InvitePreview | null> {
  const { data, error } = await (supabase as any).rpc("invite_preview", {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return null;
  const row = data[0];
  return {
    account_name: row.account_name,
    role: (row.role === "admin" ? "admin" : "agent") as MemberRole,
    email_hint: row.email_hint,
    expires_at: row.expires_at,
  } as InvitePreview;
}

/**
 * Monta a URL de convite usando a origem atual.
 */
export function buildInviteUrl(token: string): string {
  if (typeof window === "undefined") return `/auth?invite=${encodeURIComponent(token)}`;
  return `${window.location.origin}/auth?invite=${encodeURIComponent(token)}`;
}
