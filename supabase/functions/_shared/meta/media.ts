// Media pipeline: pulls inbound Meta media into Supabase Storage so the UI
// can render attachments without hitting Meta's short-lived URLs.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { downloadMedia, getMediaInfo } from "./whatsapp.ts";
import type { WhatsAppConfig } from "./config.ts";

const BUCKET = "attachments";

export interface StoredMedia {
  storagePath: string;          // "<account_id>/<message_id>/<file>"
  mimeType: string;
  fileSize: number;
  signedUrl?: string;            // 7-day signed URL for UI rendering
  sha256?: string;
}

/**
 * Download a WhatsApp inbound media asset and persist it to Storage.
 * Key convention: `<account_id>/whatsapp/<YYYY-MM>/<media_id>.<ext>`.
 * Bucket policy uses account_id as the first path segment — matches storage
 * RLS set up in `20260416210000_storage_buckets.sql`.
 */
export async function persistWhatsAppMedia(params: {
  admin: SupabaseClient;
  cfg: WhatsAppConfig;
  mediaId: string;
  accountId: string;
}): Promise<StoredMedia | null> {
  const { admin, cfg, mediaId, accountId } = params;
  try {
    const info = await getMediaInfo(cfg, mediaId);
    if (!info.url) return null;
    const blob = await downloadMedia(cfg, info.url);

    const ext = extensionFromMime(info.mimeType) ?? "bin";
    const ym = new Date().toISOString().slice(0, 7);
    const path = `${accountId}/whatsapp/${ym}/${mediaId}.${ext}`;

    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, blob, {
        contentType: info.mimeType,
        upsert: true,
        cacheControl: "3600",
      });
    if (upErr) {
      console.error("[meta/media] storage upload failed", upErr);
      return null;
    }

    const { data: signed } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 7);

    return {
      storagePath: `${BUCKET}/${path}`,
      mimeType: info.mimeType,
      fileSize: info.fileSize ?? blob.size,
      signedUrl: signed?.signedUrl,
      sha256: info.sha256,
    };
  } catch (err) {
    console.error("[meta/media] persist failed", err);
    return null;
  }
}

/**
 * Given a storage path (without bucket prefix), create a fresh signed URL
 * suitable for passing to WhatsApp as `link` when sending outbound.
 * Uses a short TTL to minimize leakage if the URL is logged downstream.
 */
export async function signStorageUrl(
  admin: SupabaseClient,
  storagePath: string,
  ttlSeconds = 300,
): Promise<string | null> {
  // Accept both "<bucket>/<path>" and raw "<path>" (assumes BUCKET).
  const [maybeBucket, ...rest] = storagePath.split("/");
  const bucket = rest.length ? maybeBucket : BUCKET;
  const key = rest.length ? rest.join("/") : storagePath;
  const { data } = await admin.storage.from(bucket).createSignedUrl(key, ttlSeconds);
  return data?.signedUrl ?? null;
}

function extensionFromMime(mime: string): string | undefined {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "video/mp4": "mp4",
    "video/3gpp": "3gp",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/plain": "txt",
  };
  return map[mime?.toLowerCase()];
}

/**
 * Map WhatsApp message `type` → smallint `content_type` used in messages table.
 * Defaults to 0 (text) for anything unknown.
 */
export function contentTypeFromWaType(type: string): number {
  switch (type) {
    case "image":
      return 1;
    case "document":
      return 2;
    case "video":
      return 3;
    case "audio":
    case "voice":
      return 4;
    default:
      return 0; // text / interactive / others rendered as text
  }
}
