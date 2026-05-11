import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { AlertTriangle, Bot, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/account-context";

const POLL_INTERVAL_MS = 45_000;

export function NotificationToasts() {
  const { accountId } = useAccount();
  const seenSignals = useRef<Set<number>>(new Set());
  const seenEvals = useRef<Set<number>>(new Set());
  const initialized = useRef(false);

  useEffect(() => {
    if (!accountId) return;
    const acct = accountId;
    let cancelled = false;
    let inFlight = false;

    async function poll() {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
        const oneMinAgo = new Date(Date.now() - 60_000).toISOString();

        const [signalsRes, evalsRes] = await Promise.all([
          supabase
            .from("conversation_signals")
            .select("id, kind, severity, conversation_id, detected_at")
            .eq("account_id", acct)
            .gte("severity", 0.75)
            .gte("detected_at", fiveMinAgo)
            .order("detected_at", { ascending: false })
            .limit(5),
          supabase
            .from("eval_runs")
            .select("id, name, status, finished_at, win_rate")
            .eq("account_id", acct)
            .not("finished_at", "is", null)
            .gte("finished_at", oneMinAgo)
            .order("finished_at", { ascending: false })
            .limit(3),
        ]);

        if (cancelled) return;

        // First poll: just seed seen sets — don't spam old items
        if (!initialized.current) {
          (signalsRes.data ?? []).forEach((s) => seenSignals.current.add(s.id));
          (evalsRes.data ?? []).forEach((e) => seenEvals.current.add(e.id));
          initialized.current = true;
          return;
        }

        for (const s of signalsRes.data ?? []) {
          if (seenSignals.current.has(s.id)) continue;
          seenSignals.current.add(s.id);
          const sev = Number(s.severity);
          const flavour = sev >= 0.85 ? toast.error : toast.warning;
          flavour(`Sinal crítico: ${labelForKind(s.kind)}`, {
            description: `Severidade ${(sev * 100).toFixed(0)}%`,
            duration: 15000,
            icon: <AlertTriangle className="h-4 w-4" />,
          });
        }

        for (const e of evalsRes.data ?? []) {
          if (seenEvals.current.has(e.id)) continue;
          seenEvals.current.add(e.id);
          toast.success(`Avaliação concluída: ${e.name}`, {
            description:
              e.win_rate != null
                ? `Win-rate ${(Number(e.win_rate) * 100).toFixed(0)}%`
                : "Resultado disponível",
            duration: 15000,
            icon: <Bot className="h-4 w-4" />,
          });
        }
      } catch (err) {
        console.warn("[notifications] poll failed", err);
      } finally {
        inFlight = false;
      }
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [accountId]);

  return null;
}

function labelForKind(kind: string): string {
  const map: Record<string, string> = {
    pause_long: "pausa longa",
    hesitation: "hesitação",
    typing_burst: "rajada de digitação",
    typing_then_deleted: "digitou e apagou",
    caps_lock_burst: "caps lock",
    emoji_escalation: "escalada de emoji",
    sentiment_shift: "mudança de tom",
    voice_pitch_up: "tom da voz subiu",
    voice_pitch_down: "tom da voz caiu",
    voice_volume_drop: "queda de volume",
    speech_rate_up: "fala acelerou",
    filler_words: "palavras de hesitação",
    interrupted: "interrupção",
    silence_after_question: "silêncio após pergunta",
  };
  return map[kind] ?? kind;
}
