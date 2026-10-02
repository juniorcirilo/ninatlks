import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/lib/account-context";
import {
  WEBHOOK_EVENT_CATALOG,
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  fetchWebhookEndpoints,
  rotateWebhookEndpointSecret,
  updateWebhookEndpoint,
  type WebhookEndpoint,
} from "@/lib/webhook-endpoints";
import { fetchPersonas, type Persona } from "@/lib/personas";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type DialogState =
  | { mode: "create" }
  | { mode: "edit"; endpoint: WebhookEndpoint }
  | null;

/**
 * Cadastro dos destinos de envio. Vários por conta de propósito: o desfecho da
 * ligação normalmente vai para o n8n e a reunião agendada para o CRM, com
 * segredos separados.
 */
export function WebhookEndpointsPanel() {
  const { accountId, role } = useAccount();
  const [items, setItems] = useState<WebhookEndpoint[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const isAdmin = role === "admin";
  const agentName = (agentId: string | null) =>
    agentId ? personas.find((p) => p.id === agentId)?.name ?? "Agente removido" : null;

  const load = async () => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [endpoints, agents] = await Promise.all([
        fetchWebhookEndpoints(accountId),
        fetchPersonas(accountId),
      ]);
      setItems(endpoints);
      setPersonas(agents);
    } catch (e: any) {
      toast.error(e?.body?.message ?? "Não foi possível carregar os destinos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, isAdmin]);

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      toast.success("Copiado");
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const toggleActive = async (endpoint: WebhookEndpoint, active: boolean) => {
    if (!accountId) return;
    setBusyId(endpoint.id);
    // Otimista: o switch precisa responder na hora, e o único jeito de errar é
    // a requisição falhar — aí o catch devolve o valor anterior.
    setItems((prev) => prev.map((i) => (i.id === endpoint.id ? { ...i, active } : i)));
    try {
      await updateWebhookEndpoint(accountId, endpoint.id, { active });
    } catch (e: any) {
      setItems((prev) =>
        prev.map((i) => (i.id === endpoint.id ? { ...i, active: endpoint.active } : i)),
      );
      toast.error(e?.body?.message ?? "Não foi possível atualizar o destino");
    } finally {
      setBusyId(null);
    }
  };

  const rotate = async (endpoint: WebhookEndpoint) => {
    if (!accountId) return;
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
    if (!accountId) return;
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

  if (!isAdmin) {
    return (
      <p className="text-[12px] text-muted-foreground">
        Apenas administradores deste workspace podem ver e cadastrar destinos de webhook.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          Cada destino recebe os eventos que assinar, com o próprio segredo de assinatura.
        </p>
        <button
          type="button"
          onClick={() => setDialog({ mode: "create" })}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3 w-3" /> Novo destino
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-foreground/[0.08] bg-foreground/[0.02] py-10 text-center text-[12px] text-muted-foreground">
          Nenhum destino cadastrado.
          <br />
          Cadastre a URL do seu n8n, CRM ou ERP para receber os eventos.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((endpoint) => {
            const show = revealed[endpoint.id] === true;
            return (
              <li
                key={endpoint.id}
                className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-3"
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
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
                            endpoint.agent_id
                              ? "bg-cyan-500/15 text-cyan-300"
                              : "bg-foreground/[0.06] text-muted-foreground",
                          )}
                        >
                          <Bot className="h-2.5 w-2.5" />
                          {endpoint.agent_id ? agentName(endpoint.agent_id) : "Todos os agentes"}
                        </span>
                      </div>
                      <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                        {endpoint.url}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {endpoint.events.length === 0 ? (
                          <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">
                            Todos os eventos
                          </span>
                        ) : (
                          endpoint.events.map((e) => (
                            <span
                              key={e}
                              className="rounded-full bg-foreground/[0.06] px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                            >
                              {e}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={endpoint.active}
                      disabled={busyId === endpoint.id}
                      onCheckedChange={(v) => void toggleActive(endpoint, v)}
                      aria-label={endpoint.active ? "Desativar destino" : "Ativar destino"}
                    />
                    <button
                      type="button"
                      onClick={() => setDialog({ mode: "edit", endpoint })}
                      className="rounded-md border border-foreground/[0.08] bg-foreground/[0.04] px-2.5 py-1 text-[11px] font-medium hover:bg-foreground/[0.08]"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(endpoint)}
                      disabled={busyId === endpoint.id}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
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
                    className="min-w-0 flex-1 rounded-md border border-foreground/[0.06] bg-foreground/[0.02] px-2 py-1 font-mono text-[11px] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setRevealed((r) => ({ ...r, [endpoint.id]: !show }))
                    }
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-foreground/[0.06] bg-foreground/[0.02] text-muted-foreground hover:text-foreground"
                    aria-label={show ? "Ocultar segredo" : "Mostrar segredo"}
                  >
                    {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => copy(endpoint.secret, endpoint.id)}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-foreground/[0.06] bg-foreground/[0.02] text-muted-foreground hover:text-foreground"
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
                    disabled={busyId === endpoint.id}
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-foreground/[0.06] bg-foreground/[0.02] px-2 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <RefreshCw className="h-3 w-3" /> Novo segredo
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {dialog && accountId && (
        <WebhookEndpointDialog
          accountId={accountId}
          personas={personas}
          endpoint={dialog.mode === "edit" ? dialog.endpoint : null}
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

/**
 * Diálogo de criar/editar destino — usado tanto na aba global de Configurações
 * quanto na aba "Webhooks" de cada agente. `defaultAgentId` só vale na criação
 * (edição sempre parte do `agent_id` já salvo no destino).
 */
export function WebhookEndpointDialog({
  accountId,
  personas,
  endpoint,
  defaultAgentId,
  onClose,
  onSaved,
}: {
  accountId: string;
  personas: Persona[];
  endpoint: WebhookEndpoint | null;
  defaultAgentId?: string | null;
  onClose: () => void;
  onSaved: (saved: WebhookEndpoint) => void;
}) {
  const [name, setName] = useState(endpoint?.name ?? "");
  const [url, setUrl] = useState(endpoint?.url ?? "");
  const [method, setMethod] = useState<"GET" | "POST">(endpoint?.method ?? "POST");
  const [events, setEvents] = useState<string[]>(endpoint?.events ?? []);
  const [agentId, setAgentId] = useState<string | null>(
    endpoint?.agent_id ?? defaultAgentId ?? null,
  );
  const [saving, setSaving] = useState(false);

  const allEvents = events.length === 0;
  const canSave = useMemo(
    () => name.trim().length >= 2 && url.trim().length > 0,
    [name, url],
  );

  const toggleEvent = (event: string) => {
    setEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        url: url.trim(),
        method,
        events,
        agent_id: agentId,
      };
      const saved = endpoint
        ? await updateWebhookEndpoint(accountId, endpoint.id, payload)
        : await createWebhookEndpoint(accountId, payload);
      toast.success(endpoint ? "Destino atualizado." : "Destino cadastrado.");
      onSaved(saved);
    } catch (e: any) {
      toast.error(e?.body?.message ?? e?.message ?? "Erro ao salvar destino");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[14px]">
            {endpoint ? "Editar destino" : "Novo destino"}
          </DialogTitle>
          <p className="text-[12px] text-muted-foreground">
            Em POST, enviamos um JSON no corpo. Em GET, o mesmo JSON vai no parâmetro de query{" "}
            <code className="font-mono text-[11px]">payload</code> (útil quando o webhook do n8n
            só aceita GET). Nos dois casos vão os cabeçalhos{" "}
            <code className="font-mono text-[11px]">X-Nina-Event</code>,{" "}
            <code className="font-mono text-[11px]">X-Nina-Delivery</code>,{" "}
            <code className="font-mono text-[11px]">X-Nina-Timestamp</code> e{" "}
            <code className="font-mono text-[11px]">X-Nina-Signature</code>. A assinatura é{" "}
            <code className="font-mono text-[11px]">
              sha256=HMAC(segredo, "&lt;timestamp&gt;.&lt;corpo&gt;")
            </code>{" "}
            — o timestamp entra no que é assinado para você conseguir recusar replay. Até 5
            tentativas com espera crescente se o destino falhar.
          </p>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Nome
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="n8n — desfechos"
              className="w-full rounded-md border border-foreground/[0.08] bg-foreground/[0.02] px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div className="grid grid-cols-[88px_1fr] gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Método
              </label>
              <Select value={method} onValueChange={(v) => setMethod(v as "GET" | "POST")}>
                <SelectTrigger className="h-9 w-full bg-foreground/[0.02] text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="GET">GET</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                URL
              </label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://n8n.suaempresa.com/webhook/nina"
                className="w-full rounded-md border border-foreground/[0.08] bg-foreground/[0.02] px-3 py-2 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/40"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>
          <p className="-mt-1 text-[10px] text-muted-foreground">
            Use https sempre que o destino estiver na internet pública.
          </p>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
              Agente
            </label>
            <p className="mb-1.5 text-[10px] text-muted-foreground">
              Restrinja este destino a um agente específico — útil quando cada agente dispara pro
              seu próprio n8n. Deixe em "Todos os agentes" para um destino compartilhado.
            </p>
            <Select
              value={agentId ?? "__all__"}
              onValueChange={(v) => setAgentId(v === "__all__" ? null : v)}
            >
              <SelectTrigger className="h-9 w-full bg-foreground/[0.02] text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os agentes</SelectItem>
                {personas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
              Eventos
            </label>
            <button
              type="button"
              onClick={() => setEvents([])}
              className={cn(
                "mb-1.5 w-full rounded-md border px-3 py-2 text-left text-[11px]",
                allEvents
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-foreground/[0.06] bg-foreground/[0.02] text-muted-foreground hover:bg-foreground/[0.04]",
              )}
            >
              Todos os eventos
              <span className="block text-[10px] text-muted-foreground">
                Inclui eventos novos automaticamente.
              </span>
            </button>
            <div className="space-y-1">
              {WEBHOOK_EVENT_CATALOG.map((e) => {
                const checked = events.includes(e.event);
                return (
                  <button
                    key={e.event}
                    type="button"
                    onClick={() => toggleEvent(e.event)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left",
                      checked
                        ? "border-primary/40 bg-primary/10"
                        : "border-foreground/[0.06] bg-foreground/[0.02] hover:bg-foreground/[0.04]",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                        checked ? "border-primary bg-primary" : "border-foreground/[0.2]",
                      )}
                    >
                      {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-medium">{e.label}</span>
                      <span className="block font-mono text-[10px] text-muted-foreground">
                        {e.event}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">{e.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-foreground/[0.08] px-3 py-1.5 text-[11px] font-medium hover:bg-foreground/[0.04] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !canSave}
            className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
