// Shared tenant/auth helpers for authenticated edge functions.
// Goal: prevent cross-account data access even when the caller supplies
// a resource ID that belongs to a different tenant.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

export interface AuthContext {
  userId: string;
  accountIds: string[];
  userClient: SupabaseClient;
  adminClient: SupabaseClient;
}

/**
 * Resolve the caller from the Authorization header and load the set of
 * accounts they belong to. Throws when the token is missing/invalid.
 */
export async function requireAuth(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new AuthError("Unauthorized", 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!anonKey) throw new AuthError("Supabase anon key not configured", 500);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceKey);

  const { data: userRes } = await userClient.auth.getUser();
  const userId = userRes?.user?.id;
  if (!userId) throw new AuthError("Unauthorized", 401);

  const { data: memberships, error: mErr } = await adminClient
    .from("account_users")
    .select("account_id")
    .eq("user_id", userId);
  if (mErr) throw new AuthError(`account lookup failed: ${mErr.message}`, 500);

  const accountIds = (memberships ?? []).map((m) => m.account_id).filter(Boolean);
  if (!accountIds.length) throw new AuthError("Forbidden", 403);

  return { userId, accountIds, userClient, adminClient };
}

/**
 * Assert that a contact belongs to one of the caller's accounts.
 * Returns the contact's account_id for convenience.
 */
export async function requireContactAccess(
  ctx: AuthContext,
  contactId: string,
): Promise<string> {
  if (!contactId) throw new AuthError("contactId required", 400);
  const { data, error } = await ctx.adminClient
    .from("contacts")
    .select("account_id")
    .eq("id", contactId)
    .maybeSingle();
  if (error) throw new AuthError(`contact lookup failed: ${error.message}`, 500);
  if (!data) throw new AuthError("Not found", 404);
  if (!ctx.accountIds.includes(data.account_id)) {
    throw new AuthError("Forbidden", 403);
  }
  return data.account_id;
}

/**
 * Assert that a conversation belongs to one of the caller's accounts.
 * Returns `{ accountId, contactId }` for convenience.
 */
export async function requireConversationAccess(
  ctx: AuthContext,
  conversationId: string,
): Promise<{ accountId: string; contactId: string }> {
  if (!conversationId) throw new AuthError("conversationId required", 400);
  const { data, error } = await ctx.adminClient
    .from("conversations")
    .select("account_id, contact_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new AuthError(`conversation lookup failed: ${error.message}`, 500);
  if (!data) throw new AuthError("Not found", 404);
  if (!ctx.accountIds.includes(data.account_id)) {
    throw new AuthError("Forbidden", 403);
  }
  return { accountId: data.account_id, contactId: data.contact_id };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export function authErrorResponse(err: unknown, corsHeaders: Record<string, string>) {
  if (err instanceof AuthError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return null;
}
