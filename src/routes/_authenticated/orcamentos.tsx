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
  Pencil,
  Trash2,
  Sparkles,
  AlertTriangle,
  Flag,
  ExternalLink,
  RefreshCw,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { downloadXls } from "@/lib/export-xls";
import {
  useTablePrefs,
  ColumnsFilterPopover,
  usePagination,
  paginate,
  TablePagination,
} from "@/components/layout/TableFilters";
import {
  listSofiaQuotes,
  listSofiaErpQuotes,
  downloadQuotePdf,
  updateQuote,
  deleteQuote,
  updateErpQuote,
  deleteErpQuote,
  truncateQuotes,
  type QuoteRow,
  type ErpQuoteRow,
} from "@/lib/agents/quotes.functions";
import { analyzeQuotes, type QuotesAnalysis } from "@/lib/agents/quotes-insights.functions";
import { fetchAgentSources, runAgentSource, resolveAgentSourceFailure, fetchAgentSourceFailures, type RunResult } from "@/lib/agent-sources";
import { listCompanies, createCompany, type CompanyListRow } from "@/lib/central";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/orcamentos")({
  head: () => ({
    meta: [
      { title: "Orçamentos — Utalks" },
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

interface SyncFailure {
  label: string;
  externalId?: string;
  vendedor?: string;
  reason: string;
  details: Record<string, unknown>;
}

const humanizeKey = (key: string) =>
  key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());

const fmtValue = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

/** Mesmo texto que `ingest_agent_contact` devolve quando bloqueia uma linha
 * de cobrança/orçamento sem empresa vinculada (ver migration
 * IngestRequireCompanyForDocuments20260908050000). */
const isEmpresaNaoIdentificada = (reason: string) => reason.includes("empresa não identificada");

const DETAILS_KNOWN_KEYS = new Set(["nome", "telefone", "email", "codigoCliente", "motivo"]);

const STATUS_LABEL: Record<string, string> = {
  gerado: "Gerado",
  aprovado: "Aprovado",
  recusado: "Recusado",
  expirado: "Expirado",
};
const QUOTE_STATUSES = ["gerado", "aprovado", "recusado", "expirado"] as const;

export function OrcamentosPage() {
  const { accountId } = useAccount();
  const fnTruncate = useServerFn(truncateQuotes);
  const [confirmTruncate, setConfirmTruncate] = useState(false);
  const [truncating, setTruncating] = useState(false);

  async function handleTruncate() {
    if (!accountId || truncating) return;
    setTruncating(true);
    try {
      const { deleted } = await fnTruncate({ data: { accountId } });
      toast.success(`${deleted} orçamento(s) removido(s).`);
      setConfirmTruncate(false);
      // erp/chat vivem em sub-componentes com estado próprio — reload
      // completo é o jeito simples de garantir que as duas listas zerem.
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao truncar");
      setTruncating(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Funcionários IA"
        title="Orçamentos"
        description="Orçamentos controlados pelo Bruno, o orçamentista IA da UBVA — recebidos por integração e gerados em conversa."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={() => setConfirmTruncate(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Truncar
          </Button>
        }
      />

      <AlertDialog open={confirmTruncate} onOpenChange={setConfirmTruncate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar todos os orçamentos?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove todos os orçamentos desta conta — os recebidos por integração (ERP) e os
              gerados em chat. Os contatos continuam existindo. Não dá pra desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={truncating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleTruncate();
              }}
              disabled={truncating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {truncating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Truncar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="px-6">
        <Tabs defaultValue="erp" className="w-full">
          <TabsList className="mb-4 bg-foreground/[0.04]">
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


/* ─────────────── Via integração (n8n → ERP) ─────────────── */

const ERP_COLUMNS = [
  { key: "numero", label: "Nº Orçamento" },
  { key: "cliente", label: "Cliente" },
  { key: "razao_social", label: "Razão Social" },
  { key: "nome_fantasia", label: "Nome Fantasia" },
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
  const fnList = useServerFn(listSofiaErpQuotes);
  const fnUpdate = useServerFn(updateErpQuote);
  const fnDelete = useServerFn(deleteErpQuote);
  const { prefs, update } = useTablePrefs("orcamentos_erp", ERP_DEFAULT_COLUMNS);

  const [quotes, setQuotes] = useState<ErpQuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ErpQuoteRow | null>(null);
  const [deleting, setDeleting] = useState<ErpQuoteRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [syncAgentId, setSyncAgentId] = useState<string | null>(null);
  const [syncPreview, setSyncPreview] = useState<RunResult | null>(null);
  const [syncFailures, setSyncFailures] = useState<SyncFailure[] | null>(null);
  const [failuresOpen, setFailuresOpen] = useState(false);
  const [selectedFailure, setSelectedFailure] = useState<SyncFailure | null>(null);
  const [companiesOptions, setCompaniesOptions] = useState<CompanyListRow[]>([]);
  const [resolveCompanyId, setResolveCompanyId] = useState<string>("");
  const [resolveNewName, setResolveNewName] = useState("");
  const [resolving, setResolving] = useState(false);

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

  // Falhas da última corrida sobrevivem ao fechamento do modal (ver
  // PersistAgentSourceSyncFailures) — carrega ao abrir a tela pra dar pra
  // investigar "por que só X dos Y chegaram" sem precisar sincronizar de novo.
  useEffect(() => {
    if (!accountId) return;
    fetchAgentSources(accountId)
      .then((sources) => {
        const source = sources.find((s) => s.document_kind === "orcamento");
        if (!source) return;
        setSourceId(source.id);
        setSyncAgentId(source.agent_id);
        return fetchAgentSourceFailures(accountId, source.id);
      })
      .then((failures) => setSyncFailures(failures && failures.length > 0 ? failures : null))
      .catch(() => {});
  }, [accountId]);

  /** Busca agora a fonte de dados da Sofia (Configurações > Webhooks >
   * Fontes de Dados) e recarrega a tabela em seguida. */
  async function handleSync() {
    if (!accountId || syncing) return;
    setSyncing(true);
    try {
      const sources = await fetchAgentSources(accountId);
      const source = sources.find((s) => s.document_kind === "orcamento");
      if (!source) {
        toast.error("Nenhuma fonte de dados configurada para o agente de orçamentos em Configurações > Webhooks > Fontes de Dados.");
        return;
      }
      setSourceId(source.id);
      const result = await runAgentSource(accountId, source.id);
      if (result.ok) {
        toast.success(
          `Sincronizado: ${result.created} novo(s), ${result.updated} atualizado(s), ${result.skipped} ignorado(s).`,
        );
        setSyncAgentId(result.agentId ?? null);
        setSyncPreview(result);
        setSyncFailures(result.failures.length > 0 ? result.failures : null);
        setFailuresOpen(false);
      } else {
        toast.error(result.error ?? "Falha ao sincronizar");
      }
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (!accountId || !selectedFailure || !isEmpresaNaoIdentificada(selectedFailure.reason)) return;
    listCompanies(accountId).then(setCompaniesOptions).catch(() => {});
    setResolveCompanyId("");
    setResolveNewName("");
  }, [accountId, selectedFailure]);

  /** Resolve manualmente uma falha de "empresa não identificada": cria a
   * empresa (se o operador digitou um nome novo) ou usa a selecionada, e
   * reenvia a linha pro ingest com companyId já resolvido. */
  async function handleResolveFailure() {
    if (!accountId || !selectedFailure || !syncAgentId || resolving) return;
    const d = selectedFailure.details;
    setResolving(true);
    try {
      let companyId = resolveCompanyId;
      if (!companyId && resolveNewName.trim()) {
        const created = await createCompany(accountId, { name: resolveNewName.trim() });
        companyId = created.id;
      }
      if (!companyId) {
        toast.error("Selecione uma empresa existente ou informe o nome para criar uma nova.");
        return;
      }
      const variables = Object.fromEntries(
        Object.entries(d).filter(([k]) => !DETAILS_KNOWN_KEYS.has(k)),
      );
      const result = await resolveAgentSourceFailure(accountId, {
        agent: syncAgentId,
        phone: String(d.telefone ?? ""),
        name: d.nome != null ? String(d.nome) : null,
        email: d.email != null ? String(d.email) : null,
        variables,
        companyId,
      });
      if (result.skipped) {
        toast.error(result.reason ?? "Não foi possível gravar esta linha.");
        return;
      }
      toast.success("Orçamento gravado com a empresa selecionada.");
      setSyncFailures((prev) => (prev ? prev.filter((f) => f !== selectedFailure) : prev));
      setSelectedFailure(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao resolver");
    } finally {
      setResolving(false);
    }
  }

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
          (r.externalId && r.externalId.toLowerCase().includes(q)) ||
          (r.numeroOrcamento && r.numeroOrcamento.toLowerCase().includes(q)) ||
          (r.vendedorNome && r.vendedorNome.toLowerCase().includes(q)) ||
          (r.phoneNumber && r.phoneNumber.toLowerCase().includes(q)) ||
          (r.email && r.email.toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [quotes, prefs.search, prefs.statusFilter]);

  const pagination = usePagination(filtered.length);
  // Busca/filtro muda o conjunto — volta pra página 1 pra não deixar o
  // operador "preso" numa página que não existe mais no resultado novo.
  useEffect(() => {
    pagination.setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.search, prefs.statusFilter]);
  const paged = useMemo(
    () => paginate(filtered, pagination.start, pagination.pageSize),
    [filtered, pagination.start, pagination.pageSize],
  );

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
      await fnDelete({ data: { accountId, orcamentoId: deleting.id } });
      toast.success("Orçamento removido");
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
        <ColumnsFilterPopover
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
          statusLabel={STATUS_LABEL}
        />
        <Button variant="outline" size="sm" className="gap-1.5" disabled={syncing} onClick={handleSync}>
          <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
          Sincronizar
        </Button>
        {syncFailures && syncFailures.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-amber-500 hover:text-amber-500"
            onClick={() => setFailuresOpen(true)}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {syncFailures.length} pendência(s) da última sincronização
          </Button>
        )}
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
        <Card className="overflow-hidden border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 shadow-elevation-1">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-200 dark:border-slate-800 bg-muted/30 hover:bg-muted/30">
                {col("numero") && <TableHead className="py-3 pl-4">Nº Orçamento</TableHead>}
                {col("cliente") && <TableHead className="py-3">Cliente</TableHead>}
                {col("razao_social") && <TableHead className="py-3">Razão Social</TableHead>}
                {col("nome_fantasia") && <TableHead className="py-3">Nome Fantasia</TableHead>}
                {col("telefone") && <TableHead className="py-3">Telefone / Celular</TableHead>}
                {col("email") && <TableHead className="py-3">Email</TableHead>}
                {col("vendedor") && <TableHead className="py-3">Vendedor</TableHead>}
                {col("emissao") && <TableHead className="py-3">Emissão</TableHead>}
                {col("previsao") && <TableHead className="py-3">Previsão</TableHead>}
                {col("status") && <TableHead className="py-3">Status</TableHead>}
                {col("valor") && <TableHead className="py-3 text-right">Valor</TableHead>}
                <TableHead className="w-24 py-3 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((q) => (
                <TableRow key={q.id} className="border-gray-200 dark:border-slate-800 transition-colors hover:bg-muted/40">
                  {col("numero") && (
                    <TableCell className="py-3 pl-4 text-sm font-medium tabular-nums text-foreground">
                      {q.numeroOrcamento ?? "—"}
                    </TableCell>
                  )}
                  {col("cliente") && (
                    <TableCell className="py-3 text-sm font-medium tabular-nums text-foreground">
                      {q.externalId ?? "Sem código"}
                    </TableCell>
                  )}
                  {col("razao_social") && (
                    <TableCell className="py-3 text-sm text-muted-foreground">{q.razaoSocial ?? "—"}</TableCell>
                  )}
                  {col("nome_fantasia") && (
                    <TableCell className="py-3 text-sm text-muted-foreground">{q.nomeFantasia ?? "—"}</TableCell>
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
                      <Button variant="ghost" size="icon" className="h-7 w-7" asChild title="Ver na Central de Contatos">
                        <a href={`/central?contactId=${q.contactId}`}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
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
          <div className="px-4 pb-4">
            <TablePagination
              itemCount={filtered.length}
              totalCount={quotes.length}
              itemLabel="orçamentos"
              page={pagination.page}
              pageCount={pagination.pageCount}
              onPageChange={pagination.setPage}
              pageSize={pagination.pageSize}
              onPageSizeChange={(n) => {
                pagination.setPageSize(n);
                pagination.setPage(1);
              }}
              start={pagination.start}
              end={pagination.end}
            />
          </div>
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
              Só este orçamento some da lista — o contato e os demais orçamentos dele continuam. Não dá pra desfazer.
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

      <Dialog open={Boolean(syncPreview)} onOpenChange={(o) => !o && setSyncPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Sincronização concluída</DialogTitle>
            <DialogDescription>
              {syncPreview?.created} novo(s) · {syncPreview?.updated} atualizado(s) · {syncPreview?.skipped} ignorado(s)
              {syncPreview && syncPreview.failures.length > 0 && ` · ${syncPreview.failures.length} pendente(s) de empresa`}
            </DialogDescription>
          </DialogHeader>
          {syncPreview?.operationalList ? (
            <a
              href="/listas"
              className="flex items-center gap-2 rounded-md border border-gray-200 dark:border-slate-800 bg-muted/30 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted/60"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Lista operacional criada: <span className="font-semibold">{syncPreview.operationalList.name}</span> —{" "}
              {syncPreview.operationalList.itemCount} orçamento(s) novo(s)
              <ExternalLink className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
            </a>
          ) : (
            syncPreview?.ok && (
              <p className="text-xs text-muted-foreground">
                Nenhum orçamento novo nesta corrida — os títulos trazidos já estavam numa lista operacional em aberto.
              </p>
            )
          )}
          <Tabs defaultValue="dados" className="w-full">
            <TabsList className="mb-2 bg-foreground/[0.04]">
              <TabsTrigger value="dados">Dados</TabsTrigger>
              <TabsTrigger value="empresas">Empresas</TabsTrigger>
            </TabsList>
            <TabsContent value="dados" className="max-h-[50vh] space-y-2 overflow-y-auto py-1">
              {syncPreview?.sample.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma linha nesta corrida.</p>
              ) : (
                syncPreview?.sample.map((row, i) => (
                  <div key={i} className="rounded-md border border-gray-200 dark:border-slate-800 bg-muted/30 p-3">
                    {Object.entries(row).map(([key, value]) => (
                      <div key={key} className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
                        <span className="text-muted-foreground">{humanizeKey(key)}</span>
                        <span className="text-right font-medium text-foreground">{fmtValue(value)}</span>
                      </div>
                    ))}
                  </div>
                ))
              )}
              <p className="text-[11px] text-muted-foreground">
                Mostra até 3 linhas de amostra — a tabela já foi atualizada com tudo que foi sincronizado.
              </p>
            </TabsContent>
            <TabsContent value="empresas" className="max-h-[50vh] space-y-2 overflow-y-auto py-1">
              {!syncPreview || syncPreview.companies.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum cliente processado nesta corrida.</p>
              ) : (
                syncPreview.companies.map((c, i) => (
                  <div key={c.companyId ?? `none-${i}`} className="rounded-md border border-gray-200 dark:border-slate-800 bg-muted/30 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-foreground">{c.companyName}</p>
                      {c.externalId && (
                        <span className="font-mono text-[10px] text-muted-foreground">{c.externalId}</span>
                      )}
                    </div>
                    <div className="mt-1.5 space-y-0.5">
                      {c.contacts.map((ct, j) => (
                        <p key={j} className="text-xs text-muted-foreground">
                          {ct.name ?? "(sem nome)"} <span className="font-mono">{ct.phone}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>
          <DialogFooter>
            {syncFailures && syncFailures.length > 0 && (
              <Button
                variant="outline"
                className="gap-1.5 text-amber-500 hover:text-amber-500"
                onClick={() => {
                  setSyncPreview(null);
                  setFailuresOpen(true);
                }}
              >
                <AlertTriangle className="h-4 w-4" />
                Ver {syncFailures.length} pendência(s) de empresa
              </Button>
            )}
            <Button variant="outline" onClick={() => setSyncPreview(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={failuresOpen} onOpenChange={setFailuresOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Itens não sincronizados</DialogTitle>
            <DialogDescription>
              {syncFailures?.length} orçamento(s) da fonte não chegaram a ser gravados no banco.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto py-2">
            {syncFailures?.map((f, i) => {
              const meta = [f.externalId && `Código: ${f.externalId}`, f.vendedor && `Vendedor: ${f.vendedor}`]
                .filter(Boolean)
                .join(" · ");
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedFailure(f)}
                  className="w-full rounded-md border border-gray-200 dark:border-slate-800 bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                >
                  <p className="text-sm font-medium text-foreground">{f.label}</p>
                  {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
                  <p className="text-xs text-muted-foreground">{f.reason}</p>
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                if (!syncFailures) return;
                const variableKeys = Array.from(
                  new Set(syncFailures.flatMap((f) => Object.keys(f.details))),
                ).filter((k) => !DETAILS_KNOWN_KEYS.has(k));
                downloadXls(
                  "itens-nao-sincronizados-orcamentos",
                  [
                    { key: "label", label: "Cliente" },
                    { key: "externalId", label: "Código" },
                    { key: "vendedor", label: "Vendedor" },
                    { key: "reason", label: "Motivo" },
                    { key: "telefone", label: "Telefone" },
                    { key: "email", label: "Email" },
                    ...variableKeys.map((k) => ({ key: k, label: humanizeKey(k) })),
                  ],
                  syncFailures.map((f) => ({ ...f, ...f.details })),
                );
              }}
            >
              <Download className="h-4 w-4" />
              Baixar .xls
            </Button>
            <Button variant="outline" onClick={() => setFailuresOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedFailure)} onOpenChange={(o) => !o && setSelectedFailure(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedFailure?.label}</DialogTitle>
            <DialogDescription>{selectedFailure?.reason}</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[50vh] grid-cols-1 gap-x-6 gap-y-1.5 overflow-y-auto py-2 sm:grid-cols-2">
            {selectedFailure &&
              Object.entries(selectedFailure.details).map(([key, value]) => (
                <div key={key} className="flex items-baseline justify-between gap-3 border-b border-border/50 py-1.5 text-sm">
                  <span className="text-muted-foreground">{humanizeKey(key)}</span>
                  <span className="text-right font-medium text-foreground">{fmtValue(value)}</span>
                </div>
              ))}
          </div>
          {selectedFailure && isEmpresaNaoIdentificada(selectedFailure.reason) && (
            <div className="space-y-2 rounded-md border border-dashed border-gray-200 dark:border-slate-800 bg-muted/30 p-3">
              <p className="text-xs font-medium text-foreground">
                Selecione a empresa ou crie uma nova para gravar este orçamento:
              </p>
              <Select
                value={resolveCompanyId}
                onValueChange={(v) => {
                  setResolveCompanyId(v);
                  setResolveNewName("");
                }}
                disabled={resolving}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Empresa existente…" />
                </SelectTrigger>
                <SelectContent>
                  {companiesOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.razao_social ? ` — ${c.razao_social}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                ou
                <span className="h-px flex-1 bg-border" />
              </div>
              <Input
                value={resolveNewName}
                onChange={(e) => {
                  setResolveNewName(e.target.value);
                  if (e.target.value) setResolveCompanyId("");
                }}
                placeholder="Nome de uma empresa nova"
                disabled={resolving}
              />
              <Button
                onClick={handleResolveFailure}
                disabled={resolving || (!resolveCompanyId && !resolveNewName.trim())}
                className="w-full gap-1.5"
              >
                {resolving && <Loader2 className="h-4 w-4 animate-spin" />}
                Gravar com esta empresa
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedFailure(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  const fnList = useServerFn(listSofiaQuotes);
  const fnDownload = useServerFn(downloadQuotePdf);
  const fnUpdate = useServerFn(updateQuote);
  const fnDelete = useServerFn(deleteQuote);
  const { prefs, update } = useTablePrefs("orcamentos_chat", CHAT_DEFAULT_COLUMNS);

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

  const pagination = usePagination(filtered.length);
  // Busca/filtro muda o conjunto — volta pra página 1 pra não deixar o
  // operador "preso" numa página que não existe mais no resultado novo.
  useEffect(() => {
    pagination.setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.search, prefs.statusFilter]);
  const paged = useMemo(
    () => paginate(filtered, pagination.start, pagination.pageSize),
    [filtered, pagination.start, pagination.pageSize],
  );

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
        <ColumnsFilterPopover
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
          statusLabel={STATUS_LABEL}
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
        <Card className="overflow-hidden border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 shadow-elevation-1">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-200 dark:border-slate-800 bg-muted/30 hover:bg-muted/30">
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
              {paged.map((q) => (
                <TableRow key={q.id} className="border-gray-200 dark:border-slate-800 transition-colors hover:bg-muted/40">
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
          <div className="px-4 pb-4">
            <TablePagination
              itemCount={filtered.length}
              totalCount={quotes.length}
              itemLabel="orçamentos"
              page={pagination.page}
              pageCount={pagination.pageCount}
              onPageChange={pagination.setPage}
              pageSize={pagination.pageSize}
              onPageSizeChange={(n) => {
                pagination.setPageSize(n);
                pagination.setPage(1);
              }}
              start={pagination.start}
              end={pagination.end}
            />
          </div>
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
  baixa: "border-gray-200 dark:border-slate-800 bg-muted text-muted-foreground",
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

          <Card className="border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-5 shadow-elevation-1">
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
            <Card className="overflow-hidden border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 shadow-elevation-1">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-200 dark:border-slate-800 bg-muted/30 hover:bg-muted/30">
                    <TableHead className="py-3 pl-4">Origem</TableHead>
                    <TableHead className="py-3">Orçamento</TableHead>
                    <TableHead className="py-3">Motivo</TableHead>
                    <TableHead className="w-24 py-3 pr-4">Prioridade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.interventions.map((it) => (
                    <TableRow key={`${it.source}-${it.id}`} className="border-gray-200 dark:border-slate-800 transition-colors hover:bg-muted/40">
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
