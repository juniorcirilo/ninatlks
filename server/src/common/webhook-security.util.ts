import { createHmac, timingSafeEqual } from 'node:crypto';

// Ported 1:1 from supabase/functions/_shared/webhook-security.ts (Deno) —
// same algorithms, same header/signing conventions. All validators return
// `true` only when the request is authentic; callers MUST reject with 403
// on `false`.

function hexToBytes(hex: string): Buffer {
  return Buffer.from(hex.replace(/^0x/i, ''), 'hex');
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Twilio webhook signature validation (X-Twilio-Signature).
 * Spec: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 *
 * Twilio signs: url + sorted concatenated POST params (no separator).
 * The signature is HMAC-SHA1 with the account's AuthToken, base64-encoded.
 */
export function validateTwilioSignature(params: {
  url: string;
  form: Record<string, string>;
  signature: string | null;
  authToken: string;
}): boolean {
  const { url, form, signature, authToken } = params;
  if (!signature || !authToken) return false;

  const entries = Object.entries(form).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  let payload = url;
  for (const [k, v] of entries) payload += k + v;

  const expected = createHmac('sha1', authToken).update(payload).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  return safeEqual(expected, received);
}

/**
 * Meta (Facebook/WhatsApp/Instagram) webhook signature validation.
 * Header: X-Hub-Signature-256 with value "sha256=<hex>".
 * Body: raw request body bytes; sign with the APP_SECRET (not the verify token).
 *
 * Spec: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads
 */
export function validateMetaSignature(params: {
  rawBody: Buffer;
  header: string | null;
  appSecret: string;
}): boolean {
  const { rawBody, header, appSecret } = params;
  if (!header || !appSecret) return false;
  const m = /^sha256=([a-fA-F0-9]+)$/.exec(header.trim());
  if (!m) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  let received: Buffer;
  try {
    received = hexToBytes(m[1]);
  } catch {
    return false;
  }
  return safeEqual(expected, received);
}

/**
 * Rebuilds the public HTTPS URL Twilio used when signing the request.
 * The API may run behind a reverse proxy, so normalize from forwarded
 * headers before hashing — same as the original edge function.
 */
export function getPublicUrl(req: {
  protocol: string;
  headers: Record<string, string | string[] | undefined>;
  originalUrl: string;
}): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'] ?? req.headers['host'];
  const proto =
    (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) ??
    req.protocol;
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
  return `${proto}://${host}${req.originalUrl}`;
}

/** Convenience: true when HMAC enforcement is disabled via env flag (staging/first-boot only). */
export function isWebhookVerificationDisabled(): boolean {
  const v = process.env.WEBHOOK_VERIFY_DISABLED;
  return v === '1' || v?.toLowerCase() === 'true';
}
