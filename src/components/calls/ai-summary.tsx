import { useEffect, useState } from "react";
import { Sparkles, Smile, Meh, Frown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { generateCallSummary, type TranscriptTurn } from "@/lib/calls";

/** Ícone de sentimento por turno da transcrição — não confundir com o `SentimentBadge` (chip com rótulo) de `@/components/pipeline/badges`. */
export function TurnSentimentIcon({
  sentiment,
}: {
  sentiment: "positive" | "neutral" | "negative" | null | undefined;
}) {
  if (!sentiment) return null;
  const Icon = sentiment === "positive" ? Smile : sentiment === "negative" ? Frown : Meh;
  const cls =
    sentiment === "positive"
      ? "text-emerald-600"
      : sentiment === "negative"
        ? "text-rose-600"
        : "text-muted-foreground";
  return <Icon className={cn("h-3.5 w-3.5", cls)} />;
}

export function TranscriptTurnRow({
  turn,
  agentName = "Nina",
}: {
  turn: TranscriptTurn;
  agentName?: string;
}) {
  const isAgent = turn.role === "agent" || turn.role === "assistant";
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs",
        isAgent
          ? "border-primary/15 bg-primary/[0.05] text-foreground"
          : "border-border bg-muted/40 text-foreground",
      )}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
        <span className={isAgent ? "text-primary" : "text-sky-400"}>
          {isAgent ? agentName : "Lead"}
        </span>
        <TurnSentimentIcon sentiment={turn.sentiment} />
      </div>
      <p className="leading-relaxed text-foreground/85">{turn.text}</p>
    </div>
  );
}

export function AiSummaryBlock({
  accountId,
  callId,
  initial,
  onUpdate,
}: {
  accountId: string | null;
  callId: string;
  initial: string | null;
  onUpdate: (s: string) => void;
}) {
  const [text, setText] = useState<string | null>(initial);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setText(initial);
  }, [initial, callId]);

  const generate = async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const result = await generateCallSummary(accountId, callId, true);
      if (result.ok && result.ai_summary) {
        setText(result.ai_summary);
        onUpdate(result.ai_summary);
        toast.success("Resumo gerado");
      } else {
        toast.error(result.error ?? "Não foi possível gerar o resumo");
      }
    } catch (e: any) {
      const apiError = e?.body?.error as string | undefined;
      toast.error(apiError ?? e?.message ?? "Erro ao gerar resumo");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
          <Sparkles className="h-3 w-3" />
          Resumo IA
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="rounded-md border border-primary/30 bg-card px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
        >
          {loading ? "Gerando…" : text ? "Regenerar" : "Gerar resumo"}
        </button>
      </div>
      {text ? (
        <div className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/85">{text}</div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Nenhum resumo ainda. Clique em “Gerar resumo” para criar um briefing executivo desta
          ligação.
        </p>
      )}
    </div>
  );
}
