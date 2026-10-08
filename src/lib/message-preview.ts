import type { ConversationMessage } from "@/lib/inbox";

const MEDIA_LABEL: Record<string, string> = {
  image: "📷 Foto",
  video: "🎥 Vídeo",
  audio: "🎵 Áudio",
  document: "📄 Documento",
  sticker: "Figurinha",
};

export function mediaLabel(kind?: string | null): string | null {
  return kind ? (MEDIA_LABEL[kind] ?? null) : null;
}

/** Texto curto de uma mensagem para prévias (resposta, encaminhar). */
export function previewOf(m: ConversationMessage): string {
  const a = m.content_attributes ?? {};
  const label = mediaLabel(a.kind);
  const text = a.caption || m.content || "";
  if (label) return a.caption ? `${label} ${a.caption}` : label;
  return text || "Mensagem";
}
