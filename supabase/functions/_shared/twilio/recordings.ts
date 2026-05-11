// Recording pipeline: download a Twilio Recording and persist it to
// Supabase Storage (bucket `voice-recordings`).
// Key convention: <account_id>/YYYY-MM/<call_sid>.<ext>

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import type { TwilioCredentials } from "./client.ts";

const BUCKET = "voice-recordings";

export interface PersistedRecording {
  storagePath: string;
  mimeType: string;
  fileSize: number;
  signedUrl?: string;
  sha256Hint?: string;
}

/**
 * Pull the recording bytes from Twilio using Basic auth + store in bucket.
 * We download the `.mp3` rendition (Twilio also supports wav); mp3 is ~10x
 * smaller and ideal for in-browser playback.
 */
export async function persistTwilioRecording(params: {
  admin: SupabaseClient;
  credentials: TwilioCredentials;
  accountId: string;
  callSid: string;
  recordingSid: string;
}): Promise<PersistedRecording | null> {
  const { admin, credentials, accountId, callSid, recordingSid } = params;
  const user = credentials.apiKey ?? credentials.accountSid;
  const pass = credentials.apiSecret ?? credentials.authToken ?? "";
  const url = `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Recordings/${recordingSid}.mp3`;

  try {
    const r = await fetch(url, {
      headers: { Authorization: `Basic ${btoa(`${user}:${pass}`)}` },
    });
    if (!r.ok) {
      console.error("[twilio/recordings] download failed", r.status, await r.text());
      return null;
    }
    const blob = await r.blob();

    const ym = new Date().toISOString().slice(0, 7);
    const path = `${accountId}/${ym}/${callSid}.mp3`;

    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, blob, {
        contentType: "audio/mpeg",
        upsert: true,
        cacheControl: "3600",
      });
    if (upErr) {
      console.error("[twilio/recordings] upload failed", upErr);
      return null;
    }

    const { data: signed } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 7);

    return {
      storagePath: `${BUCKET}/${path}`,
      mimeType: "audio/mpeg",
      fileSize: blob.size,
      signedUrl: signed?.signedUrl,
    };
  } catch (err) {
    console.error("[twilio/recordings] persist failed", err);
    return null;
  }
}

/**
 * Produce a signed URL for the stored recording (used by UI + transcription job).
 */
export async function signRecordingUrl(
  admin: SupabaseClient,
  storagePath: string,
  ttlSeconds = 60 * 60,
): Promise<string | null> {
  const [maybeBucket, ...rest] = storagePath.split("/");
  const bucket = rest.length ? maybeBucket : BUCKET;
  const key = rest.length ? rest.join("/") : storagePath;
  const { data } = await admin.storage.from(bucket).createSignedUrl(key, ttlSeconds);
  return data?.signedUrl ?? null;
}
