// Painel "Gerando skill…": mostra em tempo real o que o IA Agent está
// fazendo — raciocínio, ferramentas usadas e o texto da skill sendo escrito —
// enquanto a chamada de streaming (SSE) ainda está em andamento.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Brain, CheckCircle2, Loader2, Wrench, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { generateAiSkillStream, type AiAgentSkill, type SkillGenEvent } from "@/lib/ai-agent";
import { errMsg } from "./shared";

type LogItem =
  | { kind: "info"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; tool: string; status: string; output?: string }
  | { kind: "warning"; text: string }
  | { kind: "error"; text: string };

const TOOL_STATUS_LABEL: Record<string, string> = {
  pending: "chamando…",
  running: "em execução…",
  completed: "concluída",
  error: "falhou",
};

/** Acumula eventos do stream numa lista de itens de log, mesclando os em andamento. */
function reduceEvents(items: LogItem[], ev: SkillGenEvent): LogItem[] {
  switch (ev.type) {
    case "connected":
      return [...items, { kind: "info", text: "Conectado — aguardando o modelo responder…" }];
    case "model_start":
      return [...items, { kind: "info", text: `Chamando o modelo "${ev.model}"…` }];
    case "model_failed":
      return [
        ...items,
        {
          kind: "warning",
          text: `"${ev.model}" falhou (${ev.error}) — tentando o próximo modelo.`,
        },
      ];
    case "reasoning": {
      const text = ev.part?.text?.trim();
      if (!text) return items;
      const last = items[items.length - 1];
      if (last?.kind === "reasoning") {
        return [...items.slice(0, -1), { kind: "reasoning", text: last.text + text }];
      }
      return [...items, { kind: "reasoning", text }];
    }
    case "tool_use": {
      const tool = ev.part?.tool ?? "ferramenta";
      const status = ev.part?.state?.status ?? "pending";
      const output = ev.part?.state?.output;
      const idx = [...items].reverse().findIndex((i) => i.kind === "tool" && i.tool === tool);
      if (idx === -1) return [...items, { kind: "tool", tool, status, output }];
      const realIdx = items.length - 1 - idx;
      const next = [...items];
      next[realIdx] = { kind: "tool", tool, status, output };
      return next;
    }
    case "error": {
      const e = typeof ev.error === "object" ? ev.error : undefined;
      const text =
        (typeof ev.error === "string" ? ev.error : undefined) ??
        e?.data?.message ??
        e?.message ??
        "Erro desconhecido";
      return [...items, { kind: "error", text }];
    }
    default:
      return items;
  }
}

export function SkillGenerationDialog({
  accountId,
  input,
  onDone,
  onClose,
}: {
  accountId: string;
  input: { name: string; description: string; personaId?: string };
  onDone: (skill: AiAgentSkill) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<LogItem[]>([]);
  const [status, setStatus] = useState<"running" | "done" | "error">("running");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  // Nunca deixa a tela "morta": se nenhum byte chegar em 20s é quase certo um
  // problema de rede/proxy, e um teto geral garante que, mesmo que o servidor
  // não encerre a conexão por algum motivo, o usuário recebe uma resposta.
  const CLIENT_TIMEOUT_MS = 100_000;

  useEffect(() => {
    // StrictMode/re-render não deve disparar a chamada duas vezes.
    if (startedRef.current) return;
    startedRef.current = true;
    const ctrl = new AbortController();
    const hardTimeout = window.setTimeout(() => {
      ctrl.abort();
      setStatus("error");
      setError(
        connectedRef.current
          ? "O IA Agent demorou demais para responder. Tente de novo ou escolha outro modelo em Configurações → Agente de IA → Modelos."
          : "Não foi possível confirmar a conexão com o servidor. Verifique sua internet e tente de novo.",
      );
    }, CLIENT_TIMEOUT_MS);
    const tick = window.setInterval(() => setElapsed((s) => s + 1), 1000);

    generateAiSkillStream(
      accountId,
      input,
      (ev) => {
        connectedRef.current = true;
        setConnected(true);
        if (ev.type === "done") {
          setStatus("done");
          return;
        }
        if (ev.type === "fatal_error") return; // tratado pelo catch abaixo
        setItems((prev) => reduceEvents(prev, ev));
      },
      ctrl.signal,
    )
      .then((skill) => {
        window.clearTimeout(hardTimeout);
        setStatus("done");
        window.setTimeout(() => onDone(skill), 600);
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        window.clearTimeout(hardTimeout);
        setStatus("error");
        setError(errMsg(e, "Não foi possível gerar a skill"));
      })
      .finally(() => window.clearInterval(tick));
    return () => {
      ctrl.abort();
      window.clearTimeout(hardTimeout);
      window.clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [items]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {status === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            {status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            {status === "error" && <AlertTriangle className="h-4 w-4 text-destructive" />}
            {status === "running"
              ? "Gerando skill…"
              : status === "done"
                ? "Skill gerada"
                : "Falha ao gerar a skill"}
          </DialogTitle>
          <DialogDescription>
            O IA Agent está analisando &quot;{input.name}&quot; — acompanhe o raciocínio e as
            ferramentas usadas em tempo real.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={logRef}
          className="max-h-96 space-y-2 overflow-y-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs"
        >
          {items.length === 0 && status === "running" && (
            <p className="text-muted-foreground">
              {connected
                ? "Conectado — aguardando o modelo responder…"
                : elapsed < 8
                  ? "Iniciando…"
                  : `Conectando ao servidor… (${elapsed}s)`}
            </p>
          )}
          {status === "running" && elapsed >= 20 && (
            <p className="text-amber-500">
              Ainda trabalhando ({elapsed}s) — alguns modelos demoram mais para responder.
            </p>
          )}
          {items.map((it, i) => (
            <div key={i} className={cn(it.kind === "reasoning" && "whitespace-pre-wrap")}>
              {it.kind === "info" && <p className="text-muted-foreground">• {it.text}</p>}
              {it.kind === "warning" && (
                <p className="flex items-start gap-1.5 text-amber-500">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {it.text}
                </p>
              )}
              {it.kind === "error" && (
                <p className="flex items-start gap-1.5 text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {it.text}
                </p>
              )}
              {it.kind === "reasoning" && (
                <p className="flex items-start gap-1.5 italic text-muted-foreground">
                  <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {it.text}
                </p>
              )}
              {it.kind === "tool" && (
                <p className="flex items-start gap-1.5">
                  <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <span>
                    <span className="font-medium">{it.tool}</span>{" "}
                    <span className="text-muted-foreground">
                      — {TOOL_STATUS_LABEL[it.status] ?? it.status}
                    </span>
                  </span>
                </p>
              )}
            </div>
          ))}
          {status === "running" && items.length > 0 && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> escrevendo…
            </p>
          )}
        </div>

        {status === "error" && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={onClose}>
              <X className="mr-1 h-4 w-4" /> Fechar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
