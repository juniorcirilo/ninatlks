import { supabase } from "@/integrations/supabase/client";

const BUCKET = "attachments";

export interface UploadedAttachment {
  storagePath: string;
  mimeType: string;
  filename: string;
  fileSize: number;
  signedUrl: string;
}

/**
 * Upload a file to the private `attachments` bucket using the convention
 * `<accountId>/outgoing/<conversationId>/<timestamp>-<name>`. Returns the
 * internal storage path + a short-lived signed URL for immediate preview.
 */
export async function uploadOutgoingAttachment(params: {
  accountId: string;
  conversationId: string;
  file: File;
}): Promise<UploadedAttachment> {
  const { accountId, conversationId, file } = params;
  const safeName = file.name.replace(/[^a-z0-9._-]/gi, "_");
  const key = `${accountId}/outgoing/${conversationId}/${Date.now()}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(key, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
      cacheControl: "3600",
    });
  if (upErr) throw upErr;

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(key, 60 * 10);
  if (signErr || !signed) throw signErr ?? new Error("signed url failed");

  return {
    storagePath: `${BUCKET}/${key}`,
    mimeType: file.type || "application/octet-stream",
    filename: file.name,
    fileSize: file.size,
    signedUrl: signed.signedUrl,
  };
}

export function inferAttachmentKind(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}
