// Playground para testar os Funcionários IA (Bruno, Ana, Carla).
// Conversa real contra o Lovable AI Gateway via serverFn askBruno/askAna/askCarla.
// Mostra trace de tools executadas (útil pra debug e demo).

import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Loader2, SendHorizonal, Wrench } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAccount } from "@/lib/account-context";
import { askBruno } from "@/lib/agents/bruno.functions";
import { askAna } from "@/lib/agents/ana.functions";
import { askCarla } from "@/lib/agents/carla.functions";
import { listAgents, type AgentKind } from "@/lib/agents/registry.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/agents-playground")({
  head: () => ({
    meta: [
      { title: "Playground IA — Nexus" },
      { name: "description", content: "Teste os Funcionários IA (Bruno, Ana, Carla) em tempo real com trace de ferramentas." },
    ],
  }),
  component: PlaygroundPage,
});

type Msg = { role: "user" | "assistant"; content: string; trace?: Array<{ tool: string; args: string; result: string }> };

function PlaygroundPage() {
  const { accountId } = useAccount();
  const fnList = useServerFn(listAgents);
  const fnBruno = useServerFn(askBruno);
  const fnAna = useServerFn(askAna);
  const fnCarla = useServerFn(askCarla);

  const [agents, setAgents] = useState<Array<{ key: AgentKind; name: string; description: string; first_message: string; installed: boolean }>>([]);
  const [active, setActive] = useState<AgentKind>("bruno");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    fnList({ data: { accountId } })
      .then((r) => setAgents(Array.isArray(r?.agents) ? r.agents : []))
      .catch(() => setAgents([]));
  }, [accountId, fnList]);

  useEffect(() => {
    const a = agents.find((x) => x.key === active);
    setMessages(a ? [{ role: "assistant", content: a.first_message }] : []);
  }, [active, agents]);

  async function send() {
    if (!accountId || !input.trim() || busy) return;
    const userText = input.trim();
    setInput("");
    const history = messages
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setBusy(true);
    try {
      const payload = { data: { accountId, userMessage: userText, history } };
      const r = active === "bruno" ? await fnBruno(payload)
        : active === "ana" ? await fnAna(payload)
        : await fnCarla(payload);
      setMessages((prev) => [...prev, { role: "assistant", content: r?.reply ?? "", trace: Array.isArray(r?.trace) ? r.trace : [] }]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao chamar o agente");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Funcionários IA"
        title="Playground IA"
        description="Teste os Funcionários IA em tempo real. Veja o que cada agente faz nos bastidores."
      />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Sidebar de agentes */}
        <div className="space-y-2">
          {(agents ?? []).map((a) => (
            <button
              key={a.key}
              onClick={() => setActive(a.key)}
              className={cn(
                "w-full text-left rounded-lg border p-3 transition hover:bg-muted",
                active === a.key ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                <span className="font-medium">{a.name}</span>
                {a.installed && <Badge variant="secondary" className="ml-auto text-[10px]">instalado</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{a.description}</p>
            </button>
          ))}
        </div>

        {/* Chat */}
        <Card className="flex flex-col h-[calc(100vh-260px)] min-h-[480px]">
          <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                )}>
                  {m.content || <span className="italic opacity-60">(vazio)</span>}
                  {m.trace && m.trace.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-border/40 pt-2">
                      {(m.trace ?? []).map((t, j) => (
                        <details key={j} className="text-xs">
                          <summary className="cursor-pointer flex items-center gap-1 text-muted-foreground">
                            <Wrench className="h-3 w-3" /> {t.tool}
                          </summary>
                          <pre className="mt-1 max-h-40 overflow-auto rounded bg-background p-2 text-[10px]">
{`args: ${t.args}\nresult: ${t.result}`}
                          </pre>
                        </details>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> pensando...
                </div>
              </div>
            )}
          </CardContent>
          <div className="border-t p-3 flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={`Fale com ${agents.find((a) => a.key === active)?.name ?? "o agente"}...`}
              disabled={busy}
            />
            <Button onClick={send} disabled={busy || !input.trim()}>
              <SendHorizonal className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
