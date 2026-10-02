import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Search,
  Phone,
  MessageSquare,
  Sparkles,
  Users,
  Flame,
  TrendingDown,
  TrendingUp,
  Minus,
  Rocket,
  ClipboardList,
  X,
  Mail,
  Clock,
  PhoneCall,
  Bot,
  Plus,
  ArrowRightLeft,
  AlertTriangle,
  Pencil,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useAccount } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";
import { useRealtimeRefresh } from "@/lib/realtime-client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/layout/StatCard";
import { EmptyState } from "@/components/layout/EmptyState";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchCentralContacts,
  applyQuickFilter,
  fetchContactTimeline,
  updateContactOps,
  fetchLists,
  addContactsToList,
  createListFromContacts,
  importContactsCsv,
  fetchTeam,
  fetchCompany,
  updateCompany,
  bulkAssignOwner,
  bulkAssignRoundRobin,
  bulkSetLifecycle,
  bulkSetOperationalStatus,
  fetchTagSuggestions,
  bulkAddTag,
  fetchEditableCampaigns,
  bulkAddToCampaign,
  fetchProductivity,
  findDuplicateGroups,
  pickPrimaryContact,
  contactsToCsv,
  downloadCsv,
  createManualContact,
  parseCsv,
  detectContactColumns,
  QUICK_FILTERS,
  LIFECYCLE_LABEL,
  OPERATIONAL_LABEL,
  OPERATIONAL_TONE,
  timeAgoShort,
  type CentralContact,
  type QuickFilter,
  type LifecycleStage,
  type OperationalStatus,
  type ListLite,
  type TeamLite,
  type Company,
  type CampaignLite,
  type OwnerProductivity,
  type DuplicateGroup,
} from "@/lib/central";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Upload,
  Download,
  GitMerge,
  ListPlus,
  FolderPlus,
  UserPlus,
  Tag,
  Rocket as RocketIcon,
  BarChart3,
  Shuffle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { mergeContacts } from "@/lib/contacts";
import { startConversation } from "@/lib/inbox";
import { NewCallDialog } from "@/components/calls/NewCallDialog";
import { NewMeetingDialog } from "@/components/meetings/NewMeetingDialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/central")({
  head: () => ({
    meta: [
      { title: "Central de Contatos — Nina Talks" },
      {
        name: "description",
        content:
          "Central operacional inteligente: leads, clientes, cobrança, pós-venda e retenção em um só lugar.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    contactId: typeof search.contactId === "string" ? search.contactId : undefined,
  }),
  component: CentralPage,
});

/** Todos os agentes que já importaram este contato — `agent_names` (fonte
 * completa) com fallback pro único `source_agent_name` (mais recente) para
 * contatos sem membership de lista 'agent:<id>' nenhuma. */
function agentNamesOf(c: CentralContact): string[] {
  if (c.agent_names && c.agent_names.length > 0) return c.agent_names;
  return c.source_agent_name ? [c.source_agent_name] : [];
}

function CentralPage() {
  const { accountId } = useAccount();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { contactId } = Route.useSearch();
  const [rows, setRows] = useState<CentralContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [selected, setSelected] = useState<CentralContact | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaignSingle, setCampaignSingle] = useState<CentralContact | null>(null);
  const [dedupeOpen, setDedupeOpen] = useState(false);
  const [prodOpen, setProdOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [callTarget, setCallTarget] = useState<CentralContact | null>(null);
  const [whatsappBusyId, setWhatsappBusyId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<CentralContact | null>(null);
  const [meetingTarget, setMeetingTarget] = useState<CentralContact | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const handleWhatsApp = async (c: CentralContact) => {
    if (!accountId || !c.phone_number) return;
    setWhatsappBusyId(c.id);
    try {
      await startConversation(accountId, c.id);
      navigate({ to: "/inbox", search: { contactId: c.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao abrir conversa de WhatsApp");
    } finally {
      setWhatsappBusyId(null);
    }
  };

  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const clearPicked = () => setPicked(new Set());

  const load = async (opts: { silent?: boolean } = {}) => {
    if (!accountId) return;
    if (!opts.silent) setLoading(true);
    try {
      const data = await fetchCentralContacts(accountId);
      setRows(data);
    } catch (e: any) {
      if (!opts.silent) toast.error(e?.message ?? "Falha ao carregar contatos");
    } finally {
      if (!opts.silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Deep link vindo de Orçamentos (?contactId=...): abre o drawer desse
  // contato assim que a lista carregar. Mesmo padrão de inbox.tsx.
  useEffect(() => {
    if (!contactId || rows.length === 0) return;
    const match = rows.find((r) => r.id === contactId);
    if (match) setSelected(match);
  }, [contactId, rows]);

  // Contatos mudam por ligação atendida, import, e ações em massa de outro
  // operador. Refetch silencioso: a lista atualiza sem piscar o spinner.
  // Debounce maior porque import/bulk disparam um evento por linha.
  useRealtimeRefresh(["contacts"], accountId, () => load({ silent: true }), {
    debounceMs: 1000,
  });

  // Agentes distintos entre os contatos carregados — alimenta o filtro
  // "Importado por" sem precisar de uma chamada à parte. `agent_names` (a
  // lista operacional 'agent:<id>' de cada sync) é a fonte completa; cai
  // pra source_agent_name (só o mais recente) quando o contato não tem
  // membership de lista alguma — ex.: gravado antes dessa migration.
  const agentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      for (const n of agentNamesOf(r)) set.add(n);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    let list = applyQuickFilter(rows, quick);
    if (agentFilter !== "all") {
      list =
        agentFilter === "__none"
          ? list.filter((r) => agentNamesOf(r).length === 0)
          : list.filter((r) => agentNamesOf(r).includes(agentFilter));
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (r) =>
          (r.name && r.name.toLowerCase().includes(q)) ||
          (r.phone_number && r.phone_number.toLowerCase().includes(q)) ||
          (r.email && r.email.toLowerCase().includes(q)) ||
          (r.identifier && r.identifier.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [rows, search, quick, agentFilter]);

  // Busca/filtro muda o conjunto — volta pra página 1 pra não deixar o
  // operador "preso" numa página que não existe mais no resultado novo.
  useEffect(() => {
    setPage(1);
  }, [search, quick, agentFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Clampa depois de uma exclusão/merge reduzir o total: sem isso a página
  // ficava vazia em vez de voltar pra última válida.
  const currentPage = Math.min(page, pageCount);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
  );

  const kpis = useMemo(() => {
    const total = rows.length;
    const leads = rows.filter((r) => r.lifecycle_stage === "lead").length;
    const hot = rows.filter((r) => (r.score ?? 0) >= 75).length;
    const customers = rows.filter((r) => r.lifecycle_stage === "customer").length;
    const delinquent = rows.filter((r) => r.lifecycle_stage === "delinquent").length;
    const inactive = rows.filter((r) => r.lifecycle_stage === "inactive").length;
    return { total, leads, hot, customers, delinquent, inactive };
  }, [rows]);

  const counts = useMemo(() => {
    const map = new Map<QuickFilter, number>();
    QUICK_FILTERS.forEach((f) => map.set(f.id, applyQuickFilter(rows, f.id).length));
    return map;
  }, [rows]);

  // O backend limita a listagem a 1000 contatos (contacts.service.ts). Acima
  // disso a lista fica truncada silenciosamente — avisamos o usuário.
  const truncated = rows.length >= 1000;

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="w-full px-6 py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Central de Contatos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hub operacional inteligente — leads, clientes, cobrança, pós-venda e retenção.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setProdOpen(true)}>
            <BarChart3 className="h-3.5 w-3.5" /> Produtividade
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setDedupeOpen(true)}
          >
            <GitMerge className="h-3.5 w-3.5" /> Duplicados
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              if (!filtered.length) {
                toast.error("Nada para exportar");
                return;
              }
              downloadCsv(
                `contatos-${new Date().toISOString().slice(0, 10)}.csv`,
                contactsToCsv(filtered),
              );
              toast.success(`${filtered.length} contato(s) exportado(s)`);
            }}
          >
            <Download className="h-3.5 w-3.5" /> Exportar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="h-3.5 w-3.5" /> Importar CSV
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/listas">
              <ClipboardList className="h-3.5 w-3.5" /> Listas
            </Link>
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Novo contato
          </Button>
          <Button asChild size="sm" className="gap-1.5">
            <Link to="/campanhas/nova">
              <Rocket className="h-3.5 w-3.5" /> Nova campanha
            </Link>
          </Button>
        </div>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total" value={String(kpis.total)} icon={Users} />
        <StatCard label="Leads" value={String(kpis.leads)} icon={UserPlus} />
        <StatCard label="Quentes" value={String(kpis.hot)} icon={Flame} trend="up" />
        <StatCard label="Clientes" value={String(kpis.customers)} icon={TrendingUp} trend="up" />
        <StatCard
          label="Inadimplentes"
          value={String(kpis.delinquent)}
          icon={TrendingDown}
          trend="down"
        />
        <StatCard label="Inativos" value={String(kpis.inactive)} icon={Minus} />
      </div>

      {truncated && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Exibindo os 1000 contatos mais recentes. Pode haver mais contatos na conta — use a busca para
          encontrar contatos específicos ou exporte por lista.
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nome, telefone, email, código…"
            className="pl-9"
          />
        </div>
        {agentOptions.length > 0 && (
          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="w-[220px]">
              <Bot className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder="Importado por" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os agentes</SelectItem>
              <SelectItem value="__none">Sem agente de origem</SelectItem>
              {agentOptions.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {QUICK_FILTERS.map((f) => {
          const active = quick === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setQuick(f.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
                active
                  ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                  : "border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 text-muted-foreground hover:border-cyan-500/30 hover:text-foreground",
              )}
            >
              {f.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] tabular-nums",
                  active ? "bg-cyan-500/20 text-cyan-200" : "bg-muted text-muted-foreground",
                )}
              >
                {counts.get(f.id) ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum contato encontrado"
          description="Ajuste a busca ou os filtros para ver mais resultados."
        />
      ) : (
        <Card className="overflow-hidden border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 shadow-elevation-1">
          <div className="grid grid-cols-12 items-center gap-2 border-b border-gray-200 dark:border-slate-800 bg-muted/30 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <div className="col-span-1 flex items-center">
              <Checkbox
                checked={
                  filtered.length > 0 && filtered.every((r) => picked.has(r.id))
                    ? true
                    : filtered.some((r) => picked.has(r.id))
                      ? "indeterminate"
                      : false
                }
                onCheckedChange={(v) => {
                  if (v) setPicked(new Set(filtered.map((r) => r.id)));
                  else clearPicked();
                }}
              />
            </div>
            <div className="col-span-3">Contato</div>
            <div className="col-span-2">Status operacional</div>
            <div className="col-span-1 text-right">Score</div>
            <div className="col-span-2">Ciclo de vida</div>
            <div className="col-span-1">Última</div>
            <div className="col-span-2 text-right">Ações</div>
          </div>
          <ul>
            {paged.map((c) => (
              <ContactRow
                key={c.id}
                c={c}
                checked={picked.has(c.id)}
                onCheck={() => togglePick(c.id)}
                onOpen={() => setSelected(c)}
                onCall={() => setCallTarget(c)}
                onWhatsApp={() => handleWhatsApp(c)}
                whatsappBusy={whatsappBusyId === c.id}
                onEdit={() => setEditTarget(c)}
                onSchedule={() => setMeetingTarget(c)}
              />
            ))}
          </ul>
        </Card>
      )}

      {filtered.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {(currentPage - 1) * pageSize + 1}–
            {Math.min(currentPage * pageSize, filtered.length)} de {filtered.length} contatos
            {filtered.length !== rows.length ? ` (de ${rows.length} no total)` : ""}
          </p>
          <div className="flex items-center gap-3">
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="h-8 w-[110px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[25, 50, 100, 200].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} / página
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="min-w-[88px] text-center text-xs text-muted-foreground">
                Página {currentPage} de {pageCount}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={currentPage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      <ContactDrawer
        contact={selected}
        onClose={() => setSelected(null)}
        onChanged={(updated) => {
          setRows((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
          setSelected((prev) => (prev ? { ...prev, ...updated } : prev));
        }}
        onAddToCampaign={(c) => {
          setCampaignSingle(c);
          setCampaignOpen(true);
        }}
        onCall={(c) => setCallTarget(c)}
        onWhatsApp={handleWhatsApp}
        whatsappBusy={whatsappBusyId === selected?.id}
        onEdit={(c) => setEditTarget(c)}
        onSchedule={(c) => setMeetingTarget(c)}
      />

      <NewCallDialog
        open={!!callTarget}
        onOpenChange={(o) => !o && setCallTarget(null)}
        accountId={accountId ?? null}
        initialTo={callTarget?.phone_number ?? ""}
        contactId={callTarget?.id}
        onPlaced={() => setCallTarget(null)}
      />

      <EditContactDialog
        contact={editTarget}
        onClose={() => setEditTarget(null)}
        accountId={accountId ?? ""}
        onDone={(patch) => {
          if (editTarget) {
            setRows((prev) => prev.map((r) => (r.id === editTarget.id ? { ...r, ...patch } : r)));
            setSelected((prev) =>
              prev && prev.id === editTarget.id ? { ...prev, ...patch } : prev,
            );
          }
          setEditTarget(null);
        }}
      />

      {accountId && (
        <NewMeetingDialog
          open={!!meetingTarget}
          accountId={accountId}
          currentUserId={user?.id ?? null}
          presetContact={
            meetingTarget
              ? {
                  id: meetingTarget.id,
                  name: meetingTarget.name,
                  email: meetingTarget.email,
                  phone_number: meetingTarget.phone_number,
                }
              : null
          }
          onClose={() => setMeetingTarget(null)}
          onCreated={() => setMeetingTarget(null)}
        />
      )}

      {picked.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex max-w-[95vw] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-full border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 px-4 py-2 shadow-elevation-3">
          <span className="text-xs text-muted-foreground">{picked.size} selecionado(s)</span>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setBulkOpen(true)}>
            <ListPlus className="h-3.5 w-3.5" /> Lista
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setCampaignOpen(true)}
          >
            <RocketIcon className="h-3.5 w-3.5" /> Campanha
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setOwnerOpen(true)}
          >
            <UserPlus className="h-3.5 w-3.5" /> Responsável
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setTagOpen(true)}>
            <Tag className="h-3.5 w-3.5" /> Tag
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setStageOpen(true)}>
            <ArrowRightLeft className="h-3.5 w-3.5" /> Mover estágio
          </Button>
          <Button size="sm" variant="ghost" onClick={clearPicked}>
            Limpar
          </Button>
        </div>
      )}

      <BulkAddDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        accountId={accountId ?? ""}
        contactIds={Array.from(picked)}
        onDone={() => {
          clearPicked();
          setBulkOpen(false);
        }}
      />

      <BulkOwnerDialog
        open={ownerOpen}
        onClose={() => setOwnerOpen(false)}
        accountId={accountId ?? ""}
        contactIds={Array.from(picked)}
        onDone={() => {
          clearPicked();
          setOwnerOpen(false);
          load();
        }}
      />

      <BulkTagDialog
        open={tagOpen}
        onClose={() => setTagOpen(false)}
        accountId={accountId ?? ""}
        contactIds={Array.from(picked)}
        onDone={() => {
          clearPicked();
          setTagOpen(false);
        }}
      />

      <BulkStageDialog
        open={stageOpen}
        onClose={() => setStageOpen(false)}
        accountId={accountId ?? ""}
        contactIds={Array.from(picked)}
        onDone={() => {
          clearPicked();
          setStageOpen(false);
          load();
        }}
      />

      <BulkCampaignDialog
        open={campaignOpen}
        onClose={() => {
          setCampaignOpen(false);
          setCampaignSingle(null);
        }}
        accountId={accountId ?? ""}
        contacts={
          campaignSingle
            ? [{ id: campaignSingle.id, phone_number: campaignSingle.phone_number }]
            : rows.filter((r) => picked.has(r.id)).map((r) => ({ id: r.id, phone_number: r.phone_number }))
        }
        onDone={() => {
          clearPicked();
          setCampaignOpen(false);
          setCampaignSingle(null);
        }}
      />

      <ImportCsvDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        accountId={accountId ?? ""}
        onDone={() => {
          setImportOpen(false);
          load();
        }}
      />

      <ProductivityDialog
        open={prodOpen}
        onClose={() => setProdOpen(false)}
        accountId={accountId ?? ""}
      />

      <DedupeDialog
        open={dedupeOpen}
        onClose={() => setDedupeOpen(false)}
        rows={rows}
        onMerged={() => load()}
      />

      <NewContactDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        accountId={accountId ?? ""}
        onDone={() => {
          setNewOpen(false);
          load();
        }}
      />
    </div>
  );
}

function BulkAddDialog({
  open,
  onClose,
  accountId,
  contactIds,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  contactIds: string[];
  onDone: () => void;
}) {
  const [lists, setLists] = useState<ListLite[]>([]);
  const [target, setTarget] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !accountId) return;
    fetchLists(accountId)
      .then((l) => {
        setLists(l);
        if (l[0]) setTarget(l[0].id);
      })
      .catch(() => {});
  }, [open, accountId]);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "new") {
        if (!newName.trim()) {
          toast.error("Dê um nome à lista");
          return;
        }
        await createListFromContacts(accountId, newName.trim(), contactIds);
      } else {
        if (!target) {
          toast.error("Selecione uma lista");
          return;
        }
        await addContactsToList(target, accountId, contactIds);
      }
      toast.success(`${contactIds.length} contato(s) adicionado(s)`);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar {contactIds.length} contato(s) a uma lista</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === "existing" ? "default" : "outline"}
              onClick={() => setMode("existing")}
            >
              Lista existente
            </Button>
            <Button
              size="sm"
              variant={mode === "new" ? "default" : "outline"}
              onClick={() => setMode("new")}
              className="gap-1.5"
            >
              <FolderPlus className="h-3.5 w-3.5" /> Nova lista
            </Button>
          </div>
          {mode === "existing" ? (
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {lists.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name} ({l.member_count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              placeholder="Nome da nova lista"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportCsvDialog({
  open,
  onClose,
  accountId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    headers: string[];
    rows: string[][];
    cols: { iName: number; iPhone: number; iEmail: number };
  } | null>(null);

  const reset = () => {
    setFileName(null);
    setText(null);
    setPreview(null);
  };

  const handleFile = async (file: File) => {
    const raw = await file.text();
    const { headers, rows } = parseCsv(raw);
    if (!headers.length) {
      toast.error("Não foi possível ler o CSV — verifique se o arquivo tem cabeçalho.");
      return;
    }
    setFileName(file.name);
    setText(raw);
    setPreview({ headers, rows, cols: detectContactColumns(headers) });
  };

  const noIdentifier = preview && preview.cols.iPhone < 0 && preview.cols.iEmail < 0;

  const confirmImport = async () => {
    if (!text) return;
    setBusy(true);
    try {
      const res = await importContactsCsv(accountId, text);
      toast.success(
        `${res.created} contato(s) importado(s)${res.skipped ? `, ${res.skipped} ignorado(s)` : ""}`,
      );
      reset();
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha no import");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar contatos de CSV</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Colunas reconhecidas: <code>nome</code>, <code>telefone</code>, <code>email</code>.
            Duplicados por telefone ou email são atualizados, não duplicados.
          </p>
          {!preview ? (
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-cyan-500/10 file:px-3 file:py-1.5 file:text-cyan-300 hover:file:bg-cyan-500/20"
            />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-md border border-gray-200 dark:border-slate-800 bg-muted/20 px-3 py-2 text-xs">
                <span className="truncate text-foreground">{fileName}</span>
                <button
                  type="button"
                  onClick={reset}
                  className="shrink-0 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Trocar arquivo
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5",
                    preview.cols.iName >= 0
                      ? "bg-emerald-500/10 text-emerald-300"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  Nome {preview.cols.iName >= 0 ? "✓" : "não encontrado"}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5",
                    preview.cols.iPhone >= 0
                      ? "bg-emerald-500/10 text-emerald-300"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  Telefone {preview.cols.iPhone >= 0 ? "✓" : "não encontrado"}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5",
                    preview.cols.iEmail >= 0
                      ? "bg-emerald-500/10 text-emerald-300"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  Email {preview.cols.iEmail >= 0 ? "✓" : "não encontrado"}
                </span>
              </div>

              {noIdentifier ? (
                <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Nenhuma coluna de telefone ou email foi reconhecida — todas as{" "}
                  {preview.rows.length} linha(s) serão ignoradas. Renomeie a coluna para
                  "telefone" ou "email" e selecione o arquivo novamente.
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {preview.rows.length} linha(s) detectada(s). Pré-visualização das primeiras{" "}
                  {Math.min(5, preview.rows.length)}:
                </p>
              )}

              <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-slate-800">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-slate-800 bg-muted/30 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-2 py-1.5">Nome</th>
                      <th className="px-2 py-1.5">Telefone</th>
                      <th className="px-2 py-1.5">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-b border-border/60 last:border-0">
                        <td className="px-2 py-1.5 text-foreground">
                          {preview.cols.iName >= 0 ? r[preview.cols.iName] || "—" : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-foreground">
                          {preview.cols.iPhone >= 0 ? r[preview.cols.iPhone] || "—" : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-foreground">
                          {preview.cols.iEmail >= 0 ? r[preview.cols.iEmail] || "—" : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Importando…
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={busy}
          >
            Cancelar
          </Button>
          {preview && (
            <Button onClick={confirmImport} disabled={busy || !!noIdentifier}>
              {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Confirmar importação
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkOwnerDialog({
  open,
  onClose,
  accountId,
  contactIds,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  contactIds: string[];
  onDone: () => void;
}) {
  const [team, setTeam] = useState<TeamLite[]>([]);
  const [mode, setMode] = useState<"single" | "rr">("single");
  const [owner, setOwner] = useState<string>("__none");
  const [rrPicked, setRrPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !accountId) return;
    fetchTeam(accountId)
      .then((t) => {
        setTeam(t);
        setRrPicked(new Set(t.map((x) => x.user_id)));
      })
      .catch(() => {});
  }, [open, accountId]);
  const toggleRr = (uid: string) =>
    setRrPicked((p) => {
      const n = new Set(p);
      n.has(uid) ? n.delete(uid) : n.add(uid);
      return n;
    });
  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "rr") {
        const owners = Array.from(rrPicked);
        if (!owners.length) {
          toast.error("Selecione ao menos 1 operador");
          return;
        }
        const r = await bulkAssignRoundRobin(accountId, contactIds, owners);
        toast.success(
          `${r.assigned} contato(s) distribuído(s) entre ${owners.length} operador(es)`,
        );
      } else {
        await bulkAssignOwner(accountId, contactIds, owner === "__none" ? null : owner);
        toast.success("Responsável atualizado");
      }
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Atribuir responsável a {contactIds.length} contato(s)</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={mode === "single" ? "default" : "outline"}
            onClick={() => setMode("single")}
          >
            Único
          </Button>
          <Button
            size="sm"
            variant={mode === "rr" ? "default" : "outline"}
            onClick={() => setMode("rr")}
            className="gap-1.5"
          >
            <Shuffle className="h-3.5 w-3.5" /> Round-robin
          </Button>
        </div>
        {mode === "single" ? (
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Sem responsável</SelectItem>
              {team.map((t) => (
                <SelectItem key={t.user_id} value={t.user_id}>
                  {t.name ?? t.email ?? t.user_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="space-y-1.5 rounded-md border border-gray-200 dark:border-slate-800 bg-muted/20 p-3 text-xs">
            <p className="mb-1 text-muted-foreground">
              Distribui igualmente entre os operadores selecionados.
            </p>
            {team.map((t) => (
              <label key={t.user_id} className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={rrPicked.has(t.user_id)}
                  onCheckedChange={() => toggleRr(t.user_id)}
                />
                <span>{t.name ?? t.email ?? t.user_id}</span>
              </label>
            ))}
            {team.length === 0 && (
              <p className="text-muted-foreground">Sem operadores na equipe.</p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DedupeDialog({
  open,
  onClose,
  rows,
  onMerged,
}: {
  open: boolean;
  onClose: () => void;
  rows: CentralContact[];
  onMerged: () => void;
}) {
  const { accountId } = useAccount();
  const groups = useMemo(() => (open ? findDuplicateGroups(rows) : []), [open, rows]);
  const [busy, setBusy] = useState<string | null>(null);
  const handleMerge = async (g: DuplicateGroup) => {
    if (!accountId) return;
    const primary = pickPrimaryContact(g.contacts);
    const dupes = g.contacts.filter((c) => c.id !== primary.id).map((c) => c.id);
    if (
      !confirm(
        `Mesclar ${dupes.length} duplicado(s) em "${primary.name ?? primary.phone_number ?? primary.id}"?`,
      )
    )
      return;
    setBusy(g.key);
    try {
      await mergeContacts(accountId, primary.id, dupes);
      toast.success(`Mesclado: ${dupes.length} duplicado(s)`);
      onMerged();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha no merge");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Contatos duplicados ({groups.length} grupo{groups.length === 1 ? "" : "s"})
          </DialogTitle>
        </DialogHeader>
        {groups.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Nenhum duplicado detectado por telefone ou email.
          </p>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {groups.map((g) => {
              const primary = pickPrimaryContact(g.contacts);
              return (
                <div
                  key={`${g.kind}:${g.key}`}
                  className="rounded-lg border border-gray-200 dark:border-slate-800 bg-muted/10 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs">
                      <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-cyan-300">
                        {g.kind}
                      </span>{" "}
                      <span className="font-mono text-foreground">{g.key}</span>{" "}
                      <span className="text-muted-foreground">· {g.contacts.length} contatos</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={busy === g.key}
                      onClick={() => handleMerge(g)}
                    >
                      {busy === g.key ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <GitMerge className="h-3.5 w-3.5" />
                      )}
                      Mesclar
                    </Button>
                  </div>
                  <ul className="space-y-1 text-xs">
                    {g.contacts.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between rounded border border-border/60 bg-white dark:bg-slate-900/40 px-2 py-1"
                      >
                        <span
                          className={
                            c.id === primary.id
                              ? "font-semibold text-foreground"
                              : "text-muted-foreground"
                          }
                        >
                          {c.id === primary.id && (
                            <span className="mr-1 text-[10px] text-emerald-400">PRIMÁRIO</span>
                          )}
                          {c.name ?? c.phone_number ?? c.email ?? c.id}
                        </span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          score {c.score ?? 0} · {timeAgoShort(c.last_activity_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkTagDialog({
  open,
  onClose,
  accountId,
  contactIds,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  contactIds: string[];
  onDone: () => void;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !accountId) return;
    fetchTagSuggestions(accountId)
      .then(setSuggestions)
      .catch(() => {});
  }, [open, accountId]);
  const submit = async () => {
    if (!tag.trim()) {
      toast.error("Informe a tag");
      return;
    }
    setBusy(true);
    try {
      await bulkAddTag(accountId, contactIds, tag.trim());
      toast.success(`Tag aplicada a ${contactIds.length} contato(s)`);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aplicar tag a {contactIds.length} contato(s)</DialogTitle>
        </DialogHeader>
        <Input placeholder="Nome da tag" value={tag} onChange={(e) => setTag(e.target.value)} />
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.slice(0, 20).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setTag(s)}
                className="rounded-full border border-gray-200 dark:border-slate-800 bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground hover:border-cyan-500/40 hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkStageDialog({
  open,
  onClose,
  accountId,
  contactIds,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  contactIds: string[];
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"lifecycle" | "status">("lifecycle");
  const [lifecycle, setLifecycle] = useState<LifecycleStage>("lead");
  const [status, setStatus] = useState<OperationalStatus>("new");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "lifecycle") {
        await bulkSetLifecycle(accountId, contactIds, lifecycle);
        toast.success(
          `Ciclo de vida atualizado para ${contactIds.length} contato(s): ${LIFECYCLE_LABEL[lifecycle]}`,
        );
      } else {
        await bulkSetOperationalStatus(accountId, contactIds, status);
        toast.success(
          `Status operacional atualizado para ${contactIds.length} contato(s): ${OPERATIONAL_LABEL[status]}`,
        );
      }
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao mover estágio");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover {contactIds.length} contato(s) no funil</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={mode === "lifecycle" ? "default" : "outline"}
            onClick={() => setMode("lifecycle")}
          >
            Ciclo de vida
          </Button>
          <Button
            size="sm"
            variant={mode === "status" ? "default" : "outline"}
            onClick={() => setMode("status")}
          >
            Status operacional
          </Button>
        </div>
        {mode === "lifecycle" ? (
          <Select value={lifecycle} onValueChange={(v) => setLifecycle(v as LifecycleStage)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(LIFECYCLE_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Select value={status} onValueChange={(v) => setStatus(v as OperationalStatus)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(OPERATIONAL_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkCampaignDialog({
  open,
  onClose,
  accountId,
  contacts,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  contacts: { id: string; phone_number: string | null }[];
  onDone: () => void;
}) {
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);
  const [target, setTarget] = useState<string>("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !accountId) return;
    fetchEditableCampaigns(accountId)
      .then((c) => {
        setCampaigns(c);
        if (c[0]) setTarget(c[0].id);
      })
      .catch(() => {});
  }, [open, accountId]);
  const submit = async () => {
    if (!target) {
      toast.error("Selecione uma campanha");
      return;
    }
    setBusy(true);
    try {
      const res = await bulkAddToCampaign(accountId, target, contacts);
      toast.success(
        `${res.added} adicionado(s)${res.skipped ? `, ${res.skipped} sem telefone` : ""}`,
      );
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar {contacts.length} contato(s) a campanha</DialogTitle>
        </DialogHeader>
        {campaigns.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma campanha em rascunho/agendada/pausada. Crie uma campanha primeiro.
          </p>
        ) : (
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione…" />
            </SelectTrigger>
            <SelectContent>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}{" "}
                  <span className="ml-1 text-[10px] text-muted-foreground">· {c.status}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy || !campaigns.length}>
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductivityDialog({
  open,
  onClose,
  accountId,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
}) {
  const [rows, setRows] = useState<OwnerProductivity[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !accountId) return;
    setLoading(true);
    fetchProductivity(accountId)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [open, accountId]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Produtividade por responsável</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem dados ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-800 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-2">Operador</th>
                  <th className="px-2 py-2 text-right">Contatos</th>
                  <th className="px-2 py-2 text-right">Quentes</th>
                  <th className="px-2 py-2 text-right">Clientes</th>
                  <th className="px-2 py-2 text-right">Inadimpl.</th>
                  <th className="px-2 py-2 text-right">Calls 7d</th>
                  <th className="px-2 py-2 text-right">WA 7d</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user_id ?? "__none"} className="border-b border-border/60">
                    <td className="px-2 py-2 font-medium text-foreground">{r.name}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.contacts}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-amber-300">{r.hot}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-emerald-300">
                      {r.customers}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-rose-300">
                      {r.delinquent}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.last7d_calls}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.last7d_whatsapp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContactRow({
  c,
  checked,
  onCheck,
  onOpen,
  onCall,
  onWhatsApp,
  whatsappBusy,
  onEdit,
  onSchedule,
}: {
  c: CentralContact;
  checked: boolean;
  onCheck: () => void;
  onOpen: () => void;
  onCall: () => void;
  onWhatsApp: () => void;
  whatsappBusy?: boolean;
  onEdit: () => void;
  onSchedule: () => void;
}) {
  const initials = (c.name ?? c.phone_number ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const score = c.score ?? 0;
  const scoreTone =
    score >= 75
      ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
      : score >= 40
        ? "bg-amber-500/10 text-amber-300 ring-amber-500/30"
        : "bg-slate-500/10 text-slate-300 ring-slate-500/20";

  return (
    <li
      onClick={onOpen}
      className="grid cursor-pointer grid-cols-12 items-center gap-2 border-b border-gray-200 dark:border-slate-800 px-4 py-3 transition hover:bg-muted/30"
    >
      <div className="col-span-1 flex items-center" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={checked} onCheckedChange={onCheck} />
      </div>
      <div className="col-span-3 flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-white">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {c.name ?? c.phone_number ?? "Sem nome"}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {c.phone_number && (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {c.phone_number}
              </span>
            )}
            {c.email && (
              <span className="inline-flex items-center gap-1 truncate">
                <Mail className="h-3 w-3" />
                {c.email}
              </span>
            )}
          </div>
          {agentNamesOf(c).length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1" title="Importado pelos agentes">
              {agentNamesOf(c).map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300 ring-1 ring-cyan-500/20"
                >
                  <Bot className="h-2.5 w-2.5" />
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="col-span-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1",
            OPERATIONAL_TONE[c.operational_status],
          )}
        >
          {OPERATIONAL_LABEL[c.operational_status]}
        </span>
      </div>
      <div className="col-span-1 text-right">
        <span
          className={cn(
            "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1",
            scoreTone,
          )}
        >
          {score}
        </span>
      </div>
      <div className="col-span-2 text-xs text-foreground/80">
        {LIFECYCLE_LABEL[c.lifecycle_stage]}
      </div>
      <div className="col-span-1 text-[11px] tabular-nums text-muted-foreground">
        {timeAgoShort(c.last_activity_at)}
      </div>
      <div className="col-span-2 flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {c.phone_number && (
          <>
            <Button size="icon" variant="ghost" className="h-7 w-7" title="Ligar" onClick={onCall}>
              <Phone className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title="WhatsApp"
              disabled={whatsappBusy}
              onClick={onWhatsApp}
            >
              {whatsappBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MessageSquare className="h-3.5 w-3.5" />
              )}
            </Button>
          </>
        )}
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Abrir conversa" asChild>
          <Link to="/inbox" search={{ contactId: c.id }}>
            <Sparkles className="h-3.5 w-3.5" />
          </Link>
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="Editar contato"
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="Agendar reunião"
          onClick={onSchedule}
        >
          <CalendarPlus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

function ContactDrawer({
  contact,
  onClose,
  onChanged,
  onAddToCampaign,
  onCall,
  onWhatsApp,
  whatsappBusy,
  onEdit,
  onSchedule,
}: {
  contact: CentralContact | null;
  onClose: () => void;
  onChanged: (c: CentralContact) => void;
  onAddToCampaign: (c: CentralContact) => void;
  onCall: (c: CentralContact) => void;
  onWhatsApp: (c: CentralContact) => void;
  whatsappBusy?: boolean;
  onEdit: (c: CentralContact) => void;
  onSchedule: (c: CentralContact) => void;
}) {
  const { accountId } = useAccount();
  const [timeline, setTimeline] = useState<{
    calls: any[];
    conversations: any[];
    lists: any[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [company, setCompany] = useState<Company | null>(null);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companySaving, setCompanySaving] = useState(false);
  const [team, setTeam] = useState<TeamLite[]>([]);
  const [razaoSocial, setRazaoSocial] = useState("");
  const [nomeFantasia, setNomeFantasia] = useState("");

  useEffect(() => {
    if (!contact || !accountId) return;
    setLoading(true);
    fetchContactTimeline(contact.id, accountId)
      .then(setTimeline)
      .catch(() => setTimeline({ calls: [], conversations: [], lists: [] }))
      .finally(() => setLoading(false));
  }, [contact, accountId]);

  useEffect(() => {
    if (!contact?.company_id || !accountId) {
      setCompany(null);
      return;
    }
    setCompanyLoading(true);
    Promise.all([fetchCompany(accountId, contact.company_id), fetchTeam(accountId)])
      .then(([co, tm]) => {
        setCompany(co);
        setTeam(tm);
        setRazaoSocial(co.razao_social ?? "");
        setNomeFantasia(co.nome_fantasia ?? "");
      })
      .catch(() => setCompany(null))
      .finally(() => setCompanyLoading(false));
  }, [contact?.company_id, accountId]);

  if (!contact) return null;

  const handleSave = async (patch: Partial<CentralContact>) => {
    if (!accountId) return;
    setSaving(true);
    try {
      await updateContactOps(accountId, contact.id, patch as any);
      onChanged({ ...contact, ...patch });
      toast.success("Atualizado");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao atualizar");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCompany = async (
    patch: Partial<Pick<Company, "razao_social" | "nome_fantasia" | "vendedor_id">>,
  ) => {
    if (!accountId || !company) return;
    setCompanySaving(true);
    try {
      const updated = await updateCompany(accountId, company.id, patch);
      setCompany(updated);
      onChanged({
        ...contact,
        razao_social: updated.razao_social,
        nome_fantasia: updated.nome_fantasia,
        vendedor_id: updated.vendedor_id,
      });
      toast.success("Empresa atualizada");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao atualizar empresa");
    } finally {
      setCompanySaving(false);
    }
  };

  return (
    <Sheet open={!!contact} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center justify-between">
            <span>{contact.name ?? contact.phone_number ?? "Contato"}</span>
            <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-gray-200 dark:border-slate-800 bg-muted/20 p-3 text-xs">
            {contact.phone_number && (
              <div className="flex items-center gap-1.5">
                <Phone className="h-3 w-3" />
                {contact.phone_number}
              </div>
            )}
            {contact.email && (
              <div className="flex items-center gap-1.5 truncate">
                <Mail className="h-3 w-3" />
                {contact.email}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              Última: {timeAgoShort(contact.last_activity_at)}
            </div>
            <div className="flex items-center gap-1.5">
              <PhoneCall className="h-3 w-3" />
              Ligação: {timeAgoShort(contact.last_call_at)}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-muted/20 p-3">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Empresa
            </h3>
            {!contact.company_id ? (
              <p className="text-xs text-muted-foreground">Sem empresa vinculada.</p>
            ) : companyLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : company ? (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Razão social
                  </label>
                  <Input
                    value={razaoSocial}
                    onChange={(e) => setRazaoSocial(e.target.value)}
                    onBlur={() => {
                      const trimmed = razaoSocial.trim() || null;
                      if (trimmed !== (company.razao_social ?? null)) {
                        handleSaveCompany({ razao_social: trimmed });
                      }
                    }}
                    disabled={companySaving}
                    placeholder="Razão social"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Nome fantasia
                  </label>
                  <Input
                    value={nomeFantasia}
                    onChange={(e) => setNomeFantasia(e.target.value)}
                    onBlur={() => {
                      const trimmed = nomeFantasia.trim() || null;
                      if (trimmed !== (company.nome_fantasia ?? null)) {
                        handleSaveCompany({ nome_fantasia: trimmed });
                      }
                    }}
                    disabled={companySaving}
                    placeholder="Nome fantasia"
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Vendedor
                  </label>
                  <Select
                    value={company.vendedor_id ?? "__none"}
                    onValueChange={(v) =>
                      handleSaveCompany({ vendedor_id: v === "__none" ? null : v })
                    }
                    disabled={companySaving}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Sem vendedor</SelectItem>
                      {team.map((t) => (
                        <SelectItem key={t.user_id} value={t.user_id}>
                          {t.name ?? t.email ?? t.user_id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Falha ao carregar dados da empresa.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Ciclo de vida
              </label>
              <Select
                value={contact.lifecycle_stage}
                onValueChange={(v) => handleSave({ lifecycle_stage: v as LifecycleStage })}
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LIFECYCLE_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Status operacional
              </label>
              <Select
                value={contact.operational_status}
                onValueChange={(v) => handleSave({ operational_status: v as OperationalStatus })}
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(OPERATIONAL_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {contact.phone_number && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => onCall(contact)}
                >
                  <Phone className="h-3.5 w-3.5" /> Ligar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={whatsappBusy}
                  onClick={() => onWhatsApp(contact)}
                >
                  {whatsappBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <MessageSquare className="h-3.5 w-3.5" />
                  )}{" "}
                  WhatsApp
                </Button>
              </>
            )}
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link to="/inbox" search={{ contactId: contact.id }}>
                <Bot className="h-3.5 w-3.5" /> Conversa
              </Link>
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onEdit(contact)}>
              <Pencil className="h-3.5 w-3.5" /> Editar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => onSchedule(contact)}
            >
              <CalendarPlus className="h-3.5 w-3.5" /> Agendar reunião
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!contact.phone_number}
              title={
                contact.phone_number
                  ? undefined
                  : "Contato sem telefone não pode ser adicionado a uma campanha de voz"
              }
              onClick={() => onAddToCampaign(contact)}
            >
              <Rocket className="h-3.5 w-3.5" /> Em campanha
            </Button>
          </div>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Timeline
            </h3>
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-3">
                {timeline?.calls.length === 0 &&
                  timeline?.conversations.length === 0 &&
                  timeline?.lists.length === 0 && (
                    <p className="text-xs text-muted-foreground">Sem histórico ainda.</p>
                  )}
                {timeline?.calls.map((call) => (
                  <div
                    key={call.id}
                    className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-3 text-xs"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <PhoneCall className="h-3 w-3" /> Ligação · {call.status}
                      </span>
                      <span className="text-muted-foreground">{timeAgoShort(call.started_at)}</span>
                    </div>
                    {call.summary && <p className="text-muted-foreground">{call.summary}</p>}
                    {call.classification && (
                      <span className="mt-1 inline-block rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300">
                        {call.classification}
                      </span>
                    )}
                  </div>
                ))}
                {timeline?.conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <MessageSquare className="h-3 w-3" /> Conversa #{conv.display_id}
                      </span>
                      <span className="text-muted-foreground">
                        {timeAgoShort(conv.last_activity_at)}
                      </span>
                    </div>
                  </div>
                ))}
                {timeline?.lists.map((lm, i) => (
                  <div key={i} className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <ClipboardList className="h-3 w-3" /> Lista: {lm.contact_lists?.name ?? "—"}
                      </span>
                      <span className="text-muted-foreground">{timeAgoShort(lm.added_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NewContactDialog({
  open,
  onClose,
  accountId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Informe o nome do contato");
      return;
    }
    if (!phone.trim() && !email.trim()) {
      toast.error("Informe telefone ou email");
      return;
    }
    setBusy(true);
    try {
      await createManualContact(accountId, {
        name: name.trim(),
        phone_number: phone.trim(),
        email: email.trim(),
      });
      toast.success("Contato criado");
      setName("");
      setPhone("");
      setEmail("");
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao criar contato");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo contato</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Nome *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome completo"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Telefone</label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+55 11 99999-9999"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@exemplo.com"
              type="email"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={busy || !name.trim()}>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Criar contato
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditContactDialog({
  contact,
  onClose,
  accountId,
  onDone,
}: {
  contact: CentralContact | null;
  onClose: () => void;
  accountId: string;
  onDone: (patch: {
    name: string | null;
    phone_number: string | null;
    email: string | null;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!contact) return;
    setName(contact.name ?? "");
    setPhone(contact.phone_number ?? "");
    setEmail(contact.email ?? "");
  }, [contact]);

  const handleSubmit = async () => {
    if (!contact) return;
    if (!name.trim()) {
      toast.error("Informe o nome do contato");
      return;
    }
    setBusy(true);
    try {
      await updateContactOps(accountId, contact.id, {
        name: name.trim(),
        phone_number: phone.trim() || null,
        email: email.trim() || null,
      });
      toast.success("Contato atualizado");
      onDone({
        name: name.trim(),
        phone_number: phone.trim() || null,
        email: email.trim() || null,
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao atualizar contato");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!contact} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar contato</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Nome *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome completo"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Telefone</label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+55 11 99999-9999"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@exemplo.com"
              type="email"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
