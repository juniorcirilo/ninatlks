import { apiClient } from "@/lib/api-client";

export type StageColor = "slate" | "sky" | "violet" | "amber" | "cyan" | "emerald" | "rose";

export type Sentiment = "positive" | "neutral" | "negative";

export type LeadCard = {
  id: string;
  name: string | null;
  phone_number: string | null;
  email: string | null;
  score: number;
  source: string | null;
  stage_changed_at: string | null;
  last_activity_at: string | null;
  briefing: {
    dor?: string | null;
    fit?: string | null;
    objections?: string[];
    next_action?: string | null;
  } | null;
  last_sentiment: Sentiment | null;
  last_sentiment_score: number | null;
  auto_moved_at: string | null;
  stage_source: "classification" | "sentiment" | "agent_tool" | "manual" | null;
  stage_change_reason: string | null;
  last_call_id: string | null;
  last_call_direction: "inbound" | "outbound" | null;
  last_call_outcome_category: string | null;
  last_call_outcome_summary: string | null;
  last_call_started_at: string | null;
};

export type Stage = {
  id: string;
  name: string;
  position: number;
  color: StageColor;
  is_won: boolean;
  is_lost: boolean;
  leads: LeadCard[];
};

export type Pipeline = {
  pipeline_id: string;
  stages: Stage[];
};

/**
 * Tons semânticos por stage — usa tokens HSL do Viver de IA.
 * `dot` é a cor sólida (text-*); `bg` é o chip leve; `text` é o texto do chip.
 *
 * O app não tem alternância de tema (sem `.dark`/toggle — `:root` já é o
 * tema escuro por padrão, ver styles.css), então variantes `dark:` aqui
 * nunca ativavam: o texto ficava sempre na cor "clara" (ex.: `text-sky-700`),
 * baixo contraste sobre o fundo escuro real. `slate`/`violet`/`emerald`/`rose`
 * já usavam tokens semânticos (sempre corretos); `sky`/`amber`/`cyan` agora
 * usam só o tom que de fato renderiza, sem a variante morta.
 */
const COLOR_TONE: Record<
  StageColor,
  { dot: string; chipBg: string; chipText: string; ring: string }
> = {
  slate: {
    dot: "bg-muted-foreground",
    chipBg: "bg-muted",
    chipText: "text-foreground",
    ring: "ring-border",
  },
  sky: {
    dot: "bg-sky-500",
    chipBg: "bg-sky-500/10",
    chipText: "text-sky-300",
    ring: "ring-sky-500/30",
  },
  violet: {
    dot: "bg-accent",
    chipBg: "bg-accent/10",
    chipText: "text-accent",
    ring: "ring-accent/30",
  },
  amber: {
    dot: "bg-amber-500",
    chipBg: "bg-amber-500/10",
    chipText: "text-amber-300",
    ring: "ring-amber-500/30",
  },
  cyan: {
    dot: "bg-cyan-500",
    chipBg: "bg-cyan-500/10",
    chipText: "text-cyan-300",
    ring: "ring-cyan-500/30",
  },
  emerald: {
    dot: "bg-success",
    chipBg: "bg-success/10",
    chipText: "text-success",
    ring: "ring-success/30",
  },
  rose: {
    dot: "bg-destructive",
    chipBg: "bg-destructive/10",
    chipText: "text-destructive",
    ring: "ring-destructive/30",
  },
};

export function stageTone(color: string) {
  return COLOR_TONE[(color as StageColor) ?? "slate"] ?? COLOR_TONE.slate;
}

/** Compat antigo: alguns componentes ainda esperam .bg/.text/.ring/.dot */
export function stageToneLegacy(color: string) {
  const t = stageTone(color);
  return { bg: t.chipBg, text: t.chipText, ring: t.ring, dot: t.dot };
}

export async function fetchPipeline(accountId: string): Promise<Pipeline> {
  return apiClient.get<Pipeline>(`/accounts/${accountId}/pipeline`);
}

export async function moveLeadToStage(
  accountId: string,
  contactId: string,
  stageId: string,
  reason?: string,
): Promise<void> {
  await apiClient.post(`/accounts/${accountId}/pipeline/leads/${contactId}/move`, {
    stageId,
    reason,
  });
}

/** Origem legível do último movimento de estágio, para tooltip do badge "IA". */
export function stageSourceLabel(source: LeadCard["stage_source"]): string | null {
  switch (source) {
    case "classification":
      return "Movido pela IA · classificação da ligação";
    case "sentiment":
      return "Movido pela IA · análise de sentimento";
    case "agent_tool":
      return "Movido pela IA · durante a ligação";
    default:
      return null;
  }
}

export function scoreTone(score: number): { label: string; cls: string } {
  if (score >= 75) return { label: "Quente", cls: "bg-success/10 text-success ring-success/30" };
  if (score >= 40)
    return { label: "Morno", cls: "bg-amber-500/10 text-amber-300 ring-amber-500/30" };
  if (score > 0) return { label: "Frio", cls: "bg-sky-500/10 text-sky-300 ring-sky-500/30" };
  return { label: "—", cls: "bg-muted text-muted-foreground ring-border" };
}

export function sentimentTone(s: Sentiment | null): {
  label: string;
  emoji: string;
  cls: string;
} | null {
  if (!s) return null;
  if (s === "positive")
    return { label: "Positivo", emoji: "😊", cls: "bg-success/10 text-success ring-success/30" };
  if (s === "negative")
    return {
      label: "Negativo",
      emoji: "😞",
      cls: "bg-destructive/10 text-destructive ring-destructive/30",
    };
  return { label: "Neutro", emoji: "😐", cls: "bg-muted text-muted-foreground ring-border" };
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  return `${mo}mo`;
}

export function leadInitials(name: string | null, phone: string | null): string {
  const src = (name ?? "").trim();
  if (src) {
    const parts = src.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    return digits.slice(-2) || "?";
  }
  return "?";
}

/** Gradiente determinístico baseado no id do lead — paleta navy/indigo do tema. */
const AVATAR_GRADIENTS = [
  "from-indigo-500 to-violet-600",
  "from-sky-500 to-indigo-600",
  "from-violet-500 to-purple-600",
  "from-blue-500 to-indigo-600",
  "from-cyan-500 to-blue-600",
  "from-fuchsia-500 to-violet-600",
] as const;

export function avatarGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}
