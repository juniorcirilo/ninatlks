import { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, Globe, Loader2, Plus, RefreshCw, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import {
  deleteWebhookEndpoint,
  fetchWebhookEndpoints,
  rotateWebhookEndpointSecret,
  type WebhookEndpoint,
} from "@/lib/webhook-endpoints";
import { fetchPersonas, type Persona } from "@/lib/personas";
import { WebhookEndpointDialog } from "@/components/settings/WebhookEndpointsPanel";
import { cn } from "@/lib/utils";

type DialogState = { mode: "create" } | { mode: "edit"; endpoint: WebhookEndpoint } | null;

/**
 * Webhooks deste agente especificamente — cada agente pode disparar pro seu
 * próprio n8n/CRM, com segredo e eventos próprios, sem depender de código.
 * Mostra também os destinos globais (agent_id nulo) só como referência: eles
 * já recebem os eventos deste agente, mas só são editáveis em Configurações
 * → Webhooks pra não duplicar edição de algo compartilhado por outras aba.
 */
export function AgentWebhooksTab({ agentId, agentName, accountId }: {
  agentId: string;
  agentName: string;
  accountId: string;
}) {
  const [items, setItems] = useState<WebhookEndpoint[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [endpoints, agents] = await Promise.all([
        fetchWebhookEndpoints(accountId, agentId),
        fetchPersonas(accountId),
      ]);
      setItems(endpoints);
      setPersonas(agents);
    } catch (e: any) {
      toast.error(e?.body?.message ?? "Não foi possível carregar os webhooks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, agentId]);

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      toast.success("Copiado");
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const rotate = async (endpoint: WebhookEndpoint) => {
    if (
      !confirm(
        `Gerar um novo segredo para "${endpoint.name}"? Quem valida a assinatura precisa ser atualizado, ou as entregas passam a ser recusadas.`,
      )
    )
      return;
    setBusyId(endpoint.id);
    try {
      const updated = await rotateWebhookEndpointSecret(accountId, endpoint.id);
      setItems((prev) => prev.map((i) => (i.id === endpoint.id ? updated : i)));
      setRevealed((r) => ({ ...r, [endpoint.id]: true }));
      toast.success("Novo segredo gerado.");
    } catch (e: any) {
      toast.error(e?.body?.message ?? "Não foi possível gerar o segredo");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (endpoint: WebhookEndpoint) => {
    if (!confirm(`Remover o destino "${endpoint.name}"?`)) return;
    setBusyId(endpoint.id);
    try {
      await deleteWebhookEndpoint(accountId, endpoint.id);
      setItems((prev) => prev.filter((i) => i.id !== endpoint.id));
      toast.success("Destino removido.");
    } catch (e: any) {
      toast.error(e?.body?.message ?? "Não foi possível remover o destino");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold">Webhooks de {agentName}</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Destinos (n8n, CRM, ERP…) que disparam quando este agente gera um evento — fim de
              ligação, transferência, reunião agendada. Cada agente pode ter os próprios destinos e
              segredos, configurados aqui, sem tocar em código.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDialog({ mode: "create" })}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3 w-3" /> Novo webhook
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/40 py-10 text-center text-[12px] text-muted-foreground">
            Nenhum webhook cadastrado para este agente.
            <br />
            Cadastre a URL do n8n (ou CRM/ERP) que deve receber os eventos dele.
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((endpoint) => {
              const show = revealed[endpoint.id] === true;
              const isGlobal = !endpoint.agent_id;
              return (
                <li
                  key={endpoint.id}
                  className="rounded-lg border border-border bg-muted/40 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <Webhook className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold">{endpoint.name}</span>
                          {!endpoint.active && (
                            <span className="rounded-full bg-slate-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400">
                              Inativo
                            </span>
                          )}
                          {isGlobal && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                              <Globe className="h-2.5 w-2.5" /> Global
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                          {endpoint.url}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {endpoint.events.length === 0 ? (
                            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">
                              Todos os eventos
                            </span>
                          ) : (
                            endpoint.events.map((e) => (
                              <span
                                key={e}
                                className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                              >
                                {e}
                              </span>
                            ))
                          )}
                        </div>
                        {isGlobal && (
                          <p className="mt-1.5 text-[10px] text-muted-foreground">
                            Compartilhado com todos os agentes — editar em Configurações → Webhooks.
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDialog({ mode: "edit", endpoint })}
                        disabled={isGlobal}
                        className="rounded-md border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(endpoint)}
                        disabled={busyId === endpoint.id || isGlobal}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Remover destino"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-1">
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Segredo
                    </span>
                    <input
                      readOnly
                      value={show ? endpoint.secret : "•".repeat(32)}
                      className="min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setRevealed((r) => ({ ...r, [endpoint.id]: !show }))}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                      aria-label={show ? "Ocultar segredo" : "Mostrar segredo"}
                    >
                      {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => copy(endpoint.secret, endpoint.id)}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                      aria-label="Copiar segredo"
                    >
                      {copied === endpoint.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void rotate(endpoint)}
                      disabled={busyId === endpoint.id || isGlobal}
                      className={cn(
                        "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-muted/40 px-2 text-[10px] text-muted-foreground hover:text-foreground",
                        (busyId === endpoint.id || isGlobal) && "cursor-not-allowed opacity-40",
                      )}
                    >
                      <RefreshCw className="h-3 w-3" /> Novo segredo
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {dialog && (
        <WebhookEndpointDialog
          accountId={accountId}
          personas={personas}
          endpoint={dialog.mode === "edit" ? dialog.endpoint : null}
          defaultAgentId={agentId}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null);
            setItems((prev) => {
              const exists = prev.some((i) => i.id === saved.id);
              return exists ? prev.map((i) => (i.id === saved.id ? saved : i)) : [...prev, saved];
            });
          }}
        />
      )}
    </div>
  );
}
