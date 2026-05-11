import { useEffect, useState } from "react";
import { Loader2, RefreshCw, AlertCircle, CheckCircle2, ShieldAlert } from "lucide-react";
import { useAccount } from "@/lib/account-context";
import { fetchWebhookDeliveries, type WebhookDelivery } from "@/lib/webhook-log";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export function WebhookDeliveriesPanel() {
  const { accountId } = useAccount();
  const [items, setItems] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const data = await fetchWebhookDeliveries(accountId, { limit: 30 });
      setItems(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-semibold">Últimas entregas</h3>
          <p className="text-[11px] text-muted-foreground">
            Histórico de chamadas recebidas. Limite: 30 mais recentes.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-[11px] hover:bg-muted"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Atualizar
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/40 py-10 text-center text-[12px] text-muted-foreground">
          Nenhuma chamada registrada ainda.
          <br />
          Quando seu CRM disparar um POST, aparecerá aqui.
        </div>
      ) : (
        <ScrollArea className="max-h-[420px]">
          <ul className="space-y-1.5">
            {items.map((d) => {
              const ok = (d.http_status ?? 0) >= 200 && (d.http_status ?? 0) < 300;
              const Icon = ok ? CheckCircle2 : d.signature_valid === false ? ShieldAlert : AlertCircle;
              const color = ok
                ? "text-emerald-700"
                : d.signature_valid === false
                  ? "text-amber-800"
                  : "text-rose-700";
              return (
                <li
                  key={d.id}
                  className="rounded-lg border border-border bg-muted/40 px-3 py-2"
                >
                  <div className="flex items-start gap-2">
                    <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", color)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[11px]">
                        <code className="font-mono text-foreground">{d.endpoint}</code>
                        <span className="text-muted-foreground">·</span>
                        <span className={cn("tabular-nums font-semibold", color)}>
                          {d.http_status ?? "—"}
                        </span>
                        {d.duration_ms != null && (
                          <>
                            <span className="text-muted-foreground">·</span>
                            <span className="tabular-nums text-muted-foreground">
                              {d.duration_ms}ms
                            </span>
                          </>
                        )}
                        <span className="ml-auto text-muted-foreground">
                          {new Date(d.created_at).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      {d.error && (
                        <div className="mt-1 text-[11px] text-rose-700">{d.error}</div>
                      )}
                      {d.payload_preview && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
                            Payload
                          </summary>
                          <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[10px] text-muted-foreground">
                            {d.payload_preview}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
