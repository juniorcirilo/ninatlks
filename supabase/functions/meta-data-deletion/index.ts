// Meta Data Deletion Callback URL — required by Meta App Review.
// When a user removes our app from their Facebook/Instagram, Meta POSTs
// here with a signed_request. We must return JSON with { url, confirmation_code }
// pointing to a status page. Details:
// https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const form = await req.formData().catch(() => null);
  const signedRequest = form?.get("signed_request")?.toString() ?? "";

  const appSecret = Deno.env.get("META_APP_SECRET") ?? "";
  const payload = await parseSignedRequest(signedRequest, appSecret);

  if (!payload) {
    console.warn("[meta-data-deletion] invalid signed_request");
    return j({ error: "invalid signed_request" }, 400);
  }

  const userId = String(payload.user_id ?? "");
  if (!userId) {
    return j({ error: "missing user_id" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await admin
    .from("data_deletion_requests")
    .insert({
      source: "meta_callback",
      meta_user_id: userId,
      raw_payload: { signed_request_payload: payload },
    })
    .select("confirmation_id")
    .single();

  if (error || !data) {
    console.error("[meta-data-deletion] insert failed", error);
    return j({ error: "failed to queue" }, 500);
  }

  const baseUrl = Deno.env.get("APP_BASE_URL") ?? "https://nexus.viverdeia.ai";
  const statusUrl = `${baseUrl}/data-deletion?confirmation=${encodeURIComponent(data.confirmation_id)}`;

  console.log(
    `[meta-data-deletion] queued meta_user_id=${userId} confirmation_id=${data.confirmation_id}`,
  );

  // Meta expects this exact shape.
  return j({
    url: statusUrl,
    confirmation_code: data.confirmation_id,
  });
});

/**
 * Decode + verify a Meta signed_request. Returns the payload object if the
 * HMAC-SHA256 signature is valid, null otherwise.
 * Format: <base64url(signature)>.<base64url(payload)>
 */
async function parseSignedRequest(
  signedRequest: string,
  appSecret: string,
): Promise<Record<string, unknown> | null> {
  if (!signedRequest || !appSecret) return null;
  const parts = signedRequest.split(".");
  if (parts.length !== 2) return null;
  const [sigB64, payloadB64] = parts;

  try {
    const expected = await hmacSha256(payloadB64, appSecret);
    const received = base64UrlDecodeToBytes(sigB64);
    if (!timingSafeEqual(expected, received)) return null;

    const payloadJson = new TextDecoder().decode(base64UrlDecodeToBytes(payloadB64));
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

async function hmacSha256(message: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

function base64UrlDecodeToBytes(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
