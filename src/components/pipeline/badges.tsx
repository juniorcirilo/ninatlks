import { Sparkles, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { OUTCOME_LABEL } from "@/lib/calls";
import {
  scoreTone,
  sentimentTone,
  stageTone,
  stageSourceLabel,
  leadInitials,
  avatarGradient,
  type Sentiment,
  type LeadCard,
} from "@/lib/pipeline";

/** Badges/avatar compartilhados entre o Kanban (`/pipeline`) e a tabela de leads (`/contacts`) — mesma leitura visual em ambos os lugares. */

export function LeadAvatar({
  id,
  name,
  phone,
  className,
}: {
  id: string;
  name: string | null;
  phone: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[11px] font-semibold text-white shadow-elevation-1",
        avatarGradient(id),
        className ?? "h-8 w-8",
      )}
    >
      {leadInitials(name, phone)}
    </div>
  );
}

export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  const tone = scoreTone(score);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 tabular-nums",
        tone.cls,
        className,
      )}
    >
      {score}
      <span className="opacity-70">{tone.label}</span>
    </span>
  );
}

export function SentimentBadge({
  sentiment,
  className,
}: {
  sentiment: Sentiment | null;
  className?: string;
}) {
  const tone = sentimentTone(sentiment);
  if (!tone) return null;
  const Icon =
    sentiment === "positive" ? TrendingUp : sentiment === "negative" ? TrendingDown : Minus;
  return (
    <span
      title={`Sentimento: ${tone.label}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1",
        tone.cls,
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {tone.label}
    </span>
  );
}

export function StageBadge({
  name,
  color,
  className,
}: {
  name: string;
  color: string;
  className?: string;
}) {
  const tone = stageTone(color);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1",
        tone.chipBg,
        tone.chipText,
        tone.ring,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
      {name}
    </span>
  );
}

/** Chip de outcome da última ligação — reaproveita o vocabulário já usado em `/calls`. */
export function OutcomeBadge({
  category,
  className,
}: {
  category: string | null;
  className?: string;
}) {
  if (!category) return null;
  const outcome = OUTCOME_LABEL[category] ?? OUTCOME_LABEL.other;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset",
        outcome.cls,
        className,
      )}
    >
      {outcome.label}
    </span>
  );
}

/**
 * Badge "IA" persistente: ao contrário do antigo heurístico por
 * `auto_moved_at` (só nos 5min após o move), reflete `stage_source` sempre —
 * o card não perde a atribuição assim que a janela de tempo passa.
 */
export function AiSourceBadge({
  source,
  className,
}: {
  source: LeadCard["stage_source"];
  className?: string;
}) {
  const label = stageSourceLabel(source);
  if (!label) return null;
  return (
    <span
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-accent",
        className,
      )}
    >
      <Sparkles className="h-2.5 w-2.5" />
      IA
    </span>
  );
}
