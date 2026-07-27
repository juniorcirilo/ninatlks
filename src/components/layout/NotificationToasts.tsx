import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { AlertTriangle, Bot, Bell } from "lucide-react";
import { useAccount } from "@/lib/account-context";

const POLL_INTERVAL_MS = 45_000;

export function NotificationToasts() {
  const { accountId } = useAccount();

  useEffect(() => {
    if (!accountId) return;
    const acct = accountId;
    let cancelled = false;

    async function poll() {
      // Notification polling requires backend endpoints for conversation_signals
      // and eval_runs which are not yet ported.
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
