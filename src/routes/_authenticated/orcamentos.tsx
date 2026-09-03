import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2,
  Search,
  Receipt,
  Wallet,
  TrendingUp,
  Download,
  FileText,
  Webhook,
  SlidersHorizontal,
  Pencil,
  Trash2,
  Sparkles,
  AlertTriangle,
  Flag,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { EmptyState } from "@/components/layout/EmptyState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAccount } from "@/lib/account-context";
import { getUiSetting, saveUiSetting } from "@/lib/user-prefs.functions";
import {
  listBrunoQuotes,
  listBrunoErpQuotes,
  downloadQuotePdf,
  updateQuote,
  deleteQuote,
  updateErpQuote,
  deleteErpQuote,
  type QuoteRow,
  type ErpQuoteRow,
} from "@/lib/agents/quotes.functions";
import { analyzeQuotes, type QuotesAnalysis } from "@/lib/agents/quotes-insights.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/orcamentos")({
  head: () => ({
    meta: [
      { title: "Orçamentos — Nina Talks" },
      { name: "description", content: "Orçamentos controlados pelo Bruno, o orçamentista IA da UBVA." },
    ],
  }),
  component: OrcamentosPage,
});

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })
    : "—";

const STATUS_LABEL: Record<string, string> = {
  gerado: "Gerado",
  aprovado: "Aprovado",
  recusado: "Recusado",
  expirado: "Expirado",
};
const QUOTE_STATUSES = ["gerado", "aprovado", "recusado", "expirado"] as const;

function OrcamentosPage() {
  const { accountId } = useAccount();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Funcionários IA"
        title="Orçamentos"
        description="Orçamentos controlados pelo Bruno, o orçamentista IA da UBVA — recebidos por integração e gerados em conversa."
      />

      <div className="px-6">
        <Tabs defaultValue="erp" className="w-full">
          <TabsList className="mb-4 bg-white/[0.04]">
            <TabsTrigger value="erp">Via integração (n8n)</TabsTrigger>
            <TabsTrigger value="chat">Gerados no chat (PDF)</TabsTrigger>
            <TabsTrigger value="insights" className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Insights IA
            </TabsTrigger>
          </TabsList>
          <TabsContent value="erp">
            <ErpQuotesTab accountId={accountId} />
          </TabsContent>
          <TabsContent value="chat">
            <ChatQuotesTab accountId={accountId} />
          </TabsContent>
          <TabsContent value="insights">
            <InsightsTab accountId={accountId} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/* ─────────────── Preferências (colunas/filtros) salvas no perfil ─────────────── */

type TabPrefs = { columns: string[]; statusFilter: string[]; search: string };

function usePrefs(key: string, defaultColumns: string[]) {
  const fnGet = useServerFn(getUiSetting);
  const fnSave = useServerFn(saveUiSetting);
  const [prefs, setPrefs] = useState<TabPrefs>({ columns: defaultColumns, statusFilter: [], search: "" });
  const loadedRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fnGet({ data: { key } })
      .then((r) => {
        const v = r?.value as Partial<TabPrefs> | null;
        if (v && typeof v === "object") {
          setPrefs({
            columns: Array.isArray(v.columns) && v.columns.length > 0 ? v.columns : defaultColumns,
            statusFilter: Array.isArray(v.statusFilter) ? v.statusFilter : [],
            search: typeof v.search === "string" ? v.search : "",
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        loadedRef.current = true;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (patch: Partial<TabPrefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        if (loadedRef.current) {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            fnSave({ data: { key, value: next } }).catch(() => {});
          }, 500);
        }
        return next;
      });
    },
    [fnSave, key],
  );

  return { prefs, update };
}

function ColumnsPopover({
  columns,
  visible,
  onToggle,
  statuses,
  statusFilter,
  onToggleStatus,
}: {
  columns: Array<{ key: string; label: string }>;
  visible: string[];
  onToggle: (key: string) => void;
  statuses: string[];
  statusFilter: string[];
  onToggleStatus: (status: string) => void;
}) {
  const activeFilters = statusFilter.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filtros
          {activeFilters > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px]">
              {activeFilters}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-4">
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Colunas visíveis
          </div>
          <div className="space-y-1.5">
            {columns.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm">
                <Checkbox checked={visible.includes(c.key)} onCheckedChange={() => onToggle(c.key)} />
                {c.label}
              </label>
            ))}
          </div>
        </div>
        {statuses.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Status
            </div>
            <div className="space-y-1.5">
              {statuses.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={statusFilter.includes(s)}
                    onCheckedChange={() => onToggleStatus(s)}
                  />
                  {STATUS_LABEL[s] ?? s}
                </label>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ─────────────── Via integração (n8n → ERP) ─────────────── */

const ERP_COLUMNS = [
  { key: "numero", label: "Nº Orçamento" },
  { key: "cliente", label: "Cliente" },
  { key: "telefone", label: "Telefone / Celular" },
  { key: "email", label: "Email" },
  { key: "vendedor", label: "Vendedor" },
  { key: "emissao", label: "Emissão" },
  { key: "previsao", label: "Previsão" },
  { key: "status", label: "Status" },
  { key: "valor", label: "Valor" },
];
const ERP_DEFAULT_COLUMNS = ERP_COLUMNS.map((c) => c.key);

function ErpQuotesTab({ accountId }: { accountId: string | null }) {
  const fnList = useServerFn(listBrunoErpQuotes);
  const fnUpdate = useServerFn(updateErpQuote);
  const fnDelete = useServerFn(deleteErpQuote);
  const { prefs, update } = usePrefs("orcamentos_erp", ERP_DEFAULT_COLUMNS);

  const [quotes, setQuotes] = useState<ErpQuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ErpQuoteRow | null>(null);
  const [deleting, setDeleting] = useState<ErpQuoteRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fnList({ data: { accountId } })
      .then((r) => setQuotes(Array.isArray(r?.quotes) ? r.quotes : []))
      .catch(() => setQuotes([]))
      .finally(() => setLoading(false));
  }, [accountId, fnList]);

  useEffect(() => {
    load();
  }, [load]);

  const statuses = useMemo(
    () => [...new Set(quotes.map((q) => q.statusOrcamento).filter((s): s is string => Boolean(s)))],
    [quotes],
  );

  const filtered = useMemo(() => {
    let rows = quotes;
    if (prefs.statusFilter.length > 0) {
      rows = rows.filter((r) => r.statusOrcamento && prefs.statusFilter.includes(r.statusOrcamento));
    }
    const q = prefs.search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.customerName && r.customerName.toLowerCase().includes(q)) ||
          (r.numeroOrcamento && r.numeroOrcamento.toLowerCase().includes(q)) ||
          (r.vendedorNome && r.vendedorNome.toLowerCase().includes(q)) ||
          (r.phoneNumber && r.phoneNumber.toLowerCase().includes(q)) ||
          (r.email && r.email.toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [quotes, prefs.search, prefs.statusFilter]);

  const totals = useMemo(() => {
    const total = quotes.length;
    const totalValue = quotes.reduce((acc, q) => acc + (q.valorTotal ?? 0), 0);
    const avgTicket = total > 0 ? totalValue / total : 0;
    return { total, totalValue, avgTicket };
  }, [quotes]);

  const col = (k: string) => prefs.columns.includes(k);

  async function handleSaveEdit(form: { phoneNumber: string; email: string }) {
    if (!accountId || !editing) return;
    setBusy(true);
    try {
      await fnUpdate({
        data: {
          accountId,
          contactId: editing.contactId,
          phoneNumber: form.phoneNumber.trim() || null,
          email: form.email.trim() || null,
        },
      });
      toast.success("Contato atualizado");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!accountId || !deleting) return;
    setBusy(true);
    try {
      await fnDelete({ data: { accountId, contactId: deleting.contactId } });
      toast.success("Orçamento removido");
      setDeleting(null);
      setQuotes((prev) => prev.filter((q) => q.contactId !== deleting.contactId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Orçamentos recebidos" value={String(totals.total)} icon={Webhook} />
        <StatCard label="Valor total" value={BRL(totals.totalValue)} icon={Wallet} />
        <StatCard label="Ticket médio" value={BRL(totals.avgTicket)} icon={TrendingUp} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={prefs.search}
            onChange={(e) => update({ search: e.target.value })}
            placeholder="Buscar por cliente, nº do orçamento, vendedor, telefone ou email…"
            className="pl-9"
          />
        </div>
        <ColumnsPopover
          columns={ERP_COLUMNS}
          visible={prefs.columns}
          onToggle={(k) =>
            update({ columns: col(k) ? prefs.columns.filter((c) => c !== k) : [...prefs.columns, k] })
          }
          statuses={statuses}
          statusFilter={prefs.statusFilter}
          onToggleStatus={(s) =>
            update({
              statusFilter: prefs.statusFilter.includes(s)
                ? prefs.statusFilter.filter((x) => x !== s)
                : [...prefs.statusFilter, s],
            })
          }
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title={prefs.search || prefs.statusFilter.length > 0 ? "Nenhum orçamento com esses filtros" : "Sem orçamentos recebidos ainda"}
          description={
            prefs.search || prefs.statusFilter.length > 0
              ? "Ajuste a busca ou os filtros."
              : "Orçamentos aparecem aqui assim que a integração n8n do Bruno (Configurações > Webhooks > Recebimento) sincronizar contatos."
          }
        />
      ) : (
        <Card className="overflow-hidden border-border bg-card shadow-elevation-1">
          <Table>
            <TableHeader>
              <TableRow className="border-border bg-muted/30 hover:bg-muted/30">
                {col("numero") && <TableHead className="py-3 pl-4">Nº Orçamento</TableHead>}
                {col("cliente") && <TableHead className="py-3">Cliente</TableHead>}
                {col("telefone") && <TableHead className="py-3">Telefone / Celular</TableHead>}
                {col("email") && <TableHead className="py-3">Email</TableHead>}
                {col("vendedor") && <TableHead className="py-3">Vendedor</TableHead>}
                {col("emissao") && <TableHead className="py-3">Emissão</TableHead>}
                {col("previsao") && <TableHead className="py-3">Previsão</TableHead>}
                {col("status") && <TableHead className="py-3">Status</TableHead>}
                {col("valor") && <TableHead className="py-3 text-right">Valor</TableHead>}
                <TableHead className="w-16 py-3 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((q) => (
                <TableRow key={q.contactId} className="border-border transition-colors hover:bg-muted/40">
                  {col("numero") && (
                    <TableCell className="py-3 pl-4 text-sm font-medium tabular-nums text-foreground">
                      {q.numeroOrcamento ?? "—"}
                    </TableCell>
                  )}
                  {col("cliente") && (
                    <TableCell className="py-3 text-sm font-medium text-foreground">
                      {q.customerName ?? "Sem nome"}
                    </TableCell>
                  )}
                  {col("telefone") && (
                    <TableCell className="py-3 text-sm tabular-nums text-muted-foreground">
                      {q.phoneNumber ?? "—"}
                    </TableCell>
                  )}
                  {col("email") && (
                    <TableCell className="py-3 text-sm text-muted-foreground">{q.email ?? "—"}</TableCell>
                  )}
                  {col("vendedor") && (
                    <TableCell className="py-3 text-sm text-muted-foreground">{q.vendedorNome ?? "—"}</TableCell>
                  )}
                  {col("emissao") && (
                    <TableCell className="py-3 text-xs tabular-nums text-muted-foreground">
                      {fmtDate(q.dataEmissao)}
                    </TableCell>
                  )}
                  {col("previsao") && (
                    <TableCell className="py-3 text-xs tabular-nums text-muted-foreground">
                      {fmtDate(q.dataPrevisao)}
                    </TableCell>
                  )}
                  {col("status") && (
                    <TableCell className="py-3">
                      {q.statusOrcamento ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {q.statusOrcamento}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                  {col("valor") && (
                    <TableCell className="py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                      {q.valorTotal != null ? BRL(q.valorTotal) : "—"}
                    </TableCell>
                  )}
                  <TableCell className="py-3 pr-4">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(q)} title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleting(q)}
                        title="Excluir"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <p className="text-center text-xs text-muted-foreground">
        <Webhook className="mr-1 inline h-3 w-3" />
        {filtered.length} {filtered.length === 1 ? "orçamento exibido" : "orçamentos exibidos"} · integração n8n
      </p>

      {editing && (
        <EditErpDialog
          quote={editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={handleSaveEdit}
        />
      )}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir orçamento de "{deleting?.customerName ?? "contato sem nome"}"?</AlertDialogTitle>
            <AlertDialogDescription>
              O contato continua na base — ele só sai da lista de orçamentos do Bruno. Não dá pra desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditErpDialog({
  quote,
  busy,
  onCancel,
  onSave,
}: {
  quote: ErpQuoteRow;
  busy: boolean;
  onCancel: () => void;
  onSave: (form: { phoneNumber: string; email: string }) => void;
}) {
  const [form, setForm] = useState({
    phoneNumber: quote.phoneNumber ?? "",
    email: quote.email ?? "",
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar contato do orçamento</DialogTitle>
          <DialogDescription>
            Só telefone/celular e email são editáveis aqui — os demais dados vêm da integração com o ERP.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Telefone / Celular</Label>
            <Input
              value={form.phoneNumber}
              onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))}
              placeholder="+55 11 99999-8888"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="cliente@empresa.com.br"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => onSave(form)} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────── Gerados no chat (PDF) ─────────────── */

const CHAT_COLUMNS = [
  { key: "data", label: "Data" },
  { key: "cliente", label: "Cliente" },
  { key: "projeto", label: "Projeto" },
  { key: "itens", label: "Itens" },
  { key: "margem", label: "Margem" },
  { key: "total", label: "Total" },
  { key: "status", label: "Status" },
];
const CHAT_DEFAULT_COLUMNS = CHAT_COLUMNS.map((c) => c.key);

function ChatQuotesTab({ accountId }: { accountId: string | null }) {
  const fnList = useServerFn(listBrunoQuotes);
  const fnDownload = useServerFn(downloadQuotePdf);
  const fnUpdate = useServerFn(updateQuote);
  const fnDelete = useServerFn(deleteQuote);
  const { prefs, update } = usePrefs("orcamentos_chat", CHAT_DEFAULT_COLUMNS);

  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<QuoteRow | null>(null);
  const [deleting, setDeleting] = useState<QuoteRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fnList({ data: { accountId } })
      .then((r) => setQuotes(Array.isArray(r?.quotes) ? r.quotes : []))
      .catch(() => setQuotes([]))
      .finally(() => setLoading(false));
  }, [accountId, fnList]);

  useEffect(() => {
    load();
  }, [load]);

  const statuses = useMemo(() => [...new Set(quotes.map((q) => q.status))], [quotes]);

  const filtered = useMemo(() => {
    let rows = quotes;
    if (prefs.statusFilter.length > 0) {
      rows = rows.filter((r) => prefs.statusFilter.includes(r.status));
    }
    const q = prefs.search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.customerName && r.customerName.toLowerCase().includes(q)) ||
          (r.projectDescription && r.projectDescription.toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [quotes, prefs.search, prefs.statusFilter]);

  const totals = useMemo(() => {
    const total = quotes.length;
    const totalValue = quotes.reduce((acc, q) => acc + q.total, 0);
    const avgTicket = total > 0 ? totalValue / total : 0;
    return { total, totalValue, avgTicket };
  }, [quotes]);

  const col = (k: string) => prefs.columns.includes(k);

  async function handleDownload(quote: QuoteRow) {
    if (!accountId || downloadingId) return;
    setDownloadingId(quote.id);
    try {
      const r = await fnDownload({ data: { accountId, quoteId: quote.id } });
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao baixar o orçamento");
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleSaveEdit(form: { customerName: string; projectDescription: string; status: string }) {
    if (!accountId || !editing) return;
    setBusy(true);
    try {
      await fnUpdate({
        data: {
          accountId,
          quoteId: editing.id,
          customerName: form.customerName.trim() || null,
          projectDescription: form.projectDescription.trim() || null,
          status: form.status as (typeof QUOTE_STATUSES)[number],
        },
      });
      toast.success("Orçamento atualizado");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!accountId || !deleting) return;
    setBusy(true);
    try {
      await fnDelete({ data: { accountId, quoteId: deleting.id } });
      toast.success("Orçamento excluído");
      setDeleting(null);
      setQuotes((prev) => prev.filter((q) => q.id !== deleting.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Orçamentos emitidos" value={String(totals.total)} icon={Receipt} />
        <StatCard label="Valor total" value={BRL(totals.totalValue)} icon={Wallet} />
        <StatCard label="Ticket médio" value={BRL(totals.avgTicket)} icon={TrendingUp} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={prefs.search}
            onChange={(e) => update({ search: e.target.value })}
            placeholder="Buscar por cliente ou projeto…"
            className="pl-9"
          />
        </div>
        <ColumnsPopover
          columns={CHAT_COLUMNS}
          visible={prefs.columns}
          onToggle={(k) =>
            update({ columns: col(k) ? prefs.columns.filter((c) => c !== k) : [...prefs.columns, k] })
          }
          statuses={statuses}
          statusFilter={prefs.statusFilter}
          onToggleStatus={(s) =>
            update({
              statusFilter: prefs.statusFilter.includes(s)
                ? prefs.statusFilter.filter((x) => x !== s)
                : [...prefs.statusFilter, s],
            })
          }
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={prefs.search || prefs.statusFilter.length > 0 ? "Nenhum orçamento com esses filtros" : "Sem orçamentos ainda"}
          description={
            prefs.search || prefs.statusFilter.length > 0
              ? "Ajuste a busca ou os filtros."
              : "Orçamentos aparecem aqui assim que o Bruno gera um PDF numa conversa (Playground IA ou canal conectado)."
          }
        />
      ) : (
        <Card className="overflow-hidden border-border bg-card shadow-elevation-1">
          <Table>
            <TableHeader>
              <TableRow className="border-border bg-muted/30 hover:bg-muted/30">
                {col("data") && <TableHead className="py-3 pl-4">Data</TableHead>}
                {col("cliente") && <TableHead className="py-3">Cliente</TableHead>}
                {col("projeto") && <TableHead className="py-3">Projeto</TableHead>}
                {col("itens") && <TableHead className="py-3">Itens</TableHead>}
                {col("margem") && <TableHead className="py-3">Margem</TableHead>}
                {col("total") && <TableHead className="py-3">Total</TableHead>}
                {col("status") && <TableHead className="py-3">Status</TableHead>}
                <TableHead className="w-24 py-3 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((q) => (
                <TableRow key={q.id} className="border-border transition-colors hover:bg-muted/40">
                  {col("data") && (
                    <TableCell className="py-3 pl-4 text-xs tabular-nums text-muted-foreground">
                      {new Date(q.createdAt).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                  )}
                  {col("cliente") && (
                    <TableCell className="py-3 text-sm font-medium text-foreground">
                      {q.customerName ?? "Sem nome"}
                    </TableCell>
                  )}
                  {col("projeto") && (
                    <TableCell className="py-3 max-w-[260px]">
                      <span className="line-clamp-1 text-sm text-muted-foreground">{q.projectDescription ?? "—"}</span>
                    </TableCell>
                  )}
                  {col("itens") && (
                    <TableCell className="py-3 text-sm tabular-nums text-muted-foreground">{q.items.length}</TableCell>
                  )}
                  {col("margem") && (
                    <TableCell className="py-3 text-sm tabular-nums text-muted-foreground">
                      {q.marginPct.toFixed(0)}%
                    </TableCell>
                  )}
                  {col("total") && (
                    <TableCell className="py-3 text-sm font-semibold tabular-nums text-foreground">
                      {BRL(q.total)}
                    </TableCell>
                  )}
                  {col("status") && (
                    <TableCell className="py-3">
                      <Badge variant="secondary" className="text-[10px]">
                        {STATUS_LABEL[q.status] ?? q.status}
                      </Badge>
                    </TableCell>
                  )}
                  <TableCell className="py-3 pr-4">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={downloadingId === q.id}
                        onClick={() => handleDownload(q)}
                        title="Baixar PDF"
                      >
                        {downloadingId === q.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(q)} title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleting(q)}
                        title="Excluir"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <p className="text-center text-xs text-muted-foreground">
        <FileText className="mr-1 inline h-3 w-3" />
        {filtered.length} {filtered.length === 1 ? "orçamento exibido" : "orçamentos exibidos"} · gerado em conversa
      </p>

      {editing && (
        <EditChatDialog quote={editing} busy={busy} onCancel={() => setEditing(null)} onSave={handleSaveEdit} />
      )}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir orçamento de "{deleting?.customerName ?? "cliente sem nome"}"?</AlertDialogTitle>
            <AlertDialogDescription>
              O PDF e o registro do orçamento são apagados. Não dá pra desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditChatDialog({
  quote,
  busy,
  onCancel,
  onSave,
}: {
  quote: QuoteRow;
  busy: boolean;
  onCancel: () => void;
  onSave: (form: { customerName: string; projectDescription: string; status: string }) => void;
}) {
  const [form, setForm] = useState({
    customerName: quote.customerName ?? "",
    projectDescription: quote.projectDescription ?? "",
    status: quote.status,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar orçamento</DialogTitle>
          <DialogDescription>Itens e valores vêm do cálculo original — só dados de negócio são editáveis aqui.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <Input value={form.customerName} onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Projeto</Label>
            <Textarea
              value={form.projectDescription}
              onChange={(e) => setForm((f) => ({ ...f, projectDescription: e.target.value }))}
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUOTE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => onSave(form)} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────── Insights IA ─────────────── */

const PRIORITY_STYLE: Record<string, string> = {
  alta: "border-destructive/40 bg-destructive/10 text-destructive",
  media: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  baixa: "border-border bg-muted text-muted-foreground",
};
const PRIORITY_LABEL: Record<string, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };

function InsightsTab({ accountId }: { accountId: string | null }) {
  const fnAnalyze = useServerFn(analyzeQuotes);
  const [analysis, setAnalysis] = useState<QuotesAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!accountId || loading) return;
    setLoading(true);
    try {
      const r = await fnAnalyze({ data: { accountId } });
      setAnalysis(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao analisar orçamentos");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          A IA lê os orçamentos atuais (integração + chat) e aponta quais precisam de atenção agora,
          com uma leitura de métricas e tendências.
        </p>
        <Button onClick={run} disabled={loading || !accountId} className="gap-1.5">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {analysis ? "Analisar novamente" : "Analisar com IA"}
        </Button>
      </div>

      {!analysis && !loading && (
        <EmptyState
          icon={Sparkles}
          title="Nenhuma análise ainda"
          description='Clique em "Analisar com IA" para ver quais orçamentos precisam de intervenção e um resumo de métricas.'
        />
      )}

      {loading && !analysis && (
        <div className="flex h-[30vh] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {analysis && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Orçamentos no ERP" value={String(analysis.metrics.totalErp)} icon={Webhook} />
            <StatCard
              label="Com prazo vencido"
              value={String(analysis.metrics.overdueCount)}
              icon={AlertTriangle}
              trend={analysis.metrics.overdueCount > 0 ? "down" : "neutral"}
            />
            <StatCard label="Precisam de intervenção" value={String(analysis.interventions.length)} icon={Flag} />
          </div>

          <Card className="border-border bg-card p-5 shadow-elevation-1">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              Leitura da IA
            </div>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {analysis.summary || "Sem resumo desta vez."}
            </p>
          </Card>

          {analysis.interventions.length === 0 ? (
            <EmptyState
              icon={Flag}
              title="Nenhum orçamento sinalizado"
              description="Com os dados atuais, a IA não encontrou orçamentos que precisem de intervenção imediata."
            />
          ) : (
            <Card className="overflow-hidden border-border bg-card shadow-elevation-1">
              <Table>
                <TableHeader>
                  <TableRow className="border-border bg-muted/30 hover:bg-muted/30">
                    <TableHead className="py-3 pl-4">Origem</TableHead>
                    <TableHead className="py-3">Orçamento</TableHead>
                    <TableHead className="py-3">Motivo</TableHead>
                    <TableHead className="w-24 py-3 pr-4">Prioridade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.interventions.map((it) => (
                    <TableRow key={`${it.source}-${it.id}`} className="border-border transition-colors hover:bg-muted/40">
                      <TableCell className="py-3 pl-4">
                        <Badge variant="secondary" className="text-[10px]">
                          {it.source === "erp" ? "ERP" : "Chat"}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3 text-sm font-medium text-foreground">{it.label}</TableCell>
                      <TableCell className="py-3 text-sm text-muted-foreground">{it.reason}</TableCell>
                      <TableCell className="py-3 pr-4">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold",
                            PRIORITY_STYLE[it.priority] ?? PRIORITY_STYLE.baixa,
                          )}
                        >
                          {PRIORITY_LABEL[it.priority] ?? it.priority}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Gerado em {new Date(analysis.generatedAt).toLocaleString("pt-BR")}
          </p>
        </>
      )}
    </div>
  );
}
