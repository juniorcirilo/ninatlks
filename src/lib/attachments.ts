import { apiClient } from "@/lib/api-client";

export interface UploadedAttachment {
  storagePath: string;
  mimeType: string;
  filename: string;
  fileSize: number;
  signedUrl: string;
}

/**
 * Upload a file to the private `attachments` bucket (MinIO) using the
 * convention `<accountId>/outgoing/<conversationId>/<timestamp>-<name>`.
 * The backend issues a presigned PUT URL (and a presigned GET URL for
 * immediate preview) — the browser uploads the file bytes directly to
 * MinIO, never through the Node process.
 */
export async function uploadOutgoingAttachment(params: {
  accountId: string;
  conversationId: string;
  file: File;
}): Promise<UploadedAttachment> {
  const { accountId, conversationId, file } = params;
  const contentType = file.type || "application/octet-stream";

  const { storagePath, uploadUrl, signedUrl, mimeType } = await apiClient.post<{
    storagePath: string;
    uploadUrl: string;
    signedUrl: string;
    mimeType: string;
  }>(`/accounts/${accountId}/attachments/presign`, {
    conversationId,
    filename: file.name,
    contentType,
  });

  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });
  if (!res.ok) throw new Error(`falha ao enviar arquivo (HTTP ${res.status})`);

  return {
    storagePath,
    mimeType,
    filename: file.name,
    fileSize: file.size,
    signedUrl,
  };
}

export function inferAttachmentKind(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}
