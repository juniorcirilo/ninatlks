import type { DbConnection, ReplyLanguage } from "@/lib/ai-agent";

export const errMsg = (e: unknown, fallback: string) =>
  (e as { body?: { message?: string | string[] }; message?: string })?.body?.message?.toString() ??
  (e as Error)?.message ??
  fallback;

export const EFFORTS: { value: string; label: string }[] = [
  { value: "default", label: "Padrão do modelo" },
  { value: "minimal", label: "Mínimo" },
  { value: "low", label: "Baixo" },
  { value: "medium", label: "Médio" },
  { value: "high", label: "Alto" },
  { value: "max", label: "Máximo" },
];

/** "auto" vale para a API como "" (mesmo idioma do cliente); Select não aceita valor vazio. */
export const LANGUAGES: { value: "auto" | ReplyLanguage; label: string }[] = [
  { value: "auto", label: "Mesmo idioma do cliente" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "en", label: "Inglês" },
  { value: "es", label: "Espanhol" },
];

export const MAX_FALLBACKS = 5;

export const CONN_LABEL: Record<DbConnection, string> = {
  postgresql: "PostgreSQL",
  mssql: "SQL Server",
};
