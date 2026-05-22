import { createFileRoute, Link } from "@tanstack/react-router";
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
} from "lucide-react";
import { useAccount } from "@/lib/account-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/layout/StatCard";
import { EmptyState } from "@/components/layout/EmptyState";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  type CampaignLite,
  type OwnerProductivity,
  type DuplicateGroup,
} from "@/lib/central";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, Download, GitMerge, ListPlus, FolderPlus, UserPlus, Tag, Rocket as RocketIcon, BarChart3, Shuffle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { mergeContacts } from "@/lib/contacts";
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
  component: CentralPage,
});

function CentralPage() {
  const { accountId } = useAccount();
  const [rows, setRows] = useState<CentralContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [selected, setSelected] = useState<CentralContact | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [dedupeOpen, setDedupeOpen] = useState(false);
  const [prodOpen, setProdOpen] = useState(false);
  
  

  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const clearPicked = () => setPicked(new Set());

  const load = async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const data = await fetchCentralContacts(accountId);
      setRows(data);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao carregar contatos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const filtered = useMemo(() => {
    let list = applyQuickFilter(rows, quick);
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
  }, [rows, search, quick]);

  const kpis = useMemo(() => {
    const total = rows.length;
    const hot = rows.filter((r) => (r.score ?? 0) >= 75).length;
    const customers = rows.filter((r) => r.lifecycle_stage === "customer").length;
    const delinquent = rows.filter((r) => r.lifecycle_stage === "delinquent").length;
    const inactive = rows.filter((r) => r.lifecycle_stage === "inactive").length;
    return { total, hot, customers, delinquent, inactive };
  }, [rows]);

  const counts = useMemo(() => {
    const map = new Map<QuickFilter, number>();
    QUICK_FILTERS.forEach((f) => map.set(f.id, applyQuickFilter(rows, f.id).length));
    return map;
  }, [rows]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-6">
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
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDedupeOpen(true)}>
            <GitMerge className="h-3.5 w-3.5" /> Duplicados
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              if (!filtered.length) { toast.error("Nada para exportar"); return; }
              downloadCsv(`contatos-${new Date().toISOString().slice(0, 10)}.csv`, contactsToCsv(filtered));
              toast.success(`${filtered.length} contato(s) exportado(s)`);
            }}
          >
            <Download className="h-3.5 w-3.5" /> Exportar
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setImportOpen(true)}>
            <Upload className="h-3.5 w-3.5" /> Importar CSV
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/listas">
              <ClipboardList className="h-3.5 w-3.5" /> Listas
            </Link>
          </Button>
          <Button asChild size="sm" className="gap-1.5">
            <Link to="/campanhas/nova">
              <Rocket className="h-3.5 w-3.5" /> Nova campanha
            </Link>
          </Button>
        </div>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total" value={String(kpis.total)} icon={Users} />
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
                  ? "border-violet-500/40 bg-violet-500/10 text-violet-300"
                  : "border-border bg-card text-muted-foreground hover:border-violet-500/30 hover:text-foreground",
              )}
            >
              {f.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] tabular-nums",
                  active ? "bg-violet-500/20 text-violet-200" : "bg-muted text-muted-foreground",
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
        <Card className="overflow-hidden border-border bg-card shadow-elevation-1">
          <div className="grid grid-cols-12 items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <div className="col-span-1 flex items-center">
              <Checkbox
                checked={picked.size > 0 && filtered.every((r) => picked.has(r.id))}
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
            {filtered.map((c) => (
              <ContactRow
                key={c.id}
                c={c}
                checked={picked.has(c.id)}
                onCheck={() => togglePick(c.id)}
                onOpen={() => setSelected(c)}
              />
            ))}
          </ul>
        </Card>
      )}

      <p className="mt-4 text-center text-xs text-muted-foreground">
        {filtered.length} de {rows.length} contatos exibidos
      </p>

      <ContactDrawer
        contact={selected}
        onClose={() => setSelected(null)}
        onChanged={(updated) => {
          setRows((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
          setSelected((prev) => (prev ? { ...prev, ...updated } : prev));
        }}
      />

      {picked.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex max-w-[95vw] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-2 shadow-elevation-3">
          <span className="text-xs text-muted-foreground">
            {picked.size} selecionado(s)
          </span>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setBulkOpen(true)}>
            <ListPlus className="h-3.5 w-3.5" /> Lista
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCampaignOpen(true)}>
            <RocketIcon className="h-3.5 w-3.5" /> Campanha
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOwnerOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" /> Responsável
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setTagOpen(true)}>
            <Tag className="h-3.5 w-3.5" /> Tag
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
        onDone={() => { clearPicked(); setBulkOpen(false); }}
      />

      <BulkOwnerDialog
        open={ownerOpen}
        onClose={() => setOwnerOpen(false)}
        accountId={accountId ?? ""}
        contactIds={Array.from(picked)}
        onDone={() => { clearPicked(); setOwnerOpen(false); load(); }}
      />

      <BulkTagDialog
        open={tagOpen}
        onClose={() => setTagOpen(false)}
        accountId={accountId ?? ""}
        contactIds={Array.from(picked)}
        onDone={() => { clearPicked(); setTagOpen(false); }}
      />

      <BulkCampaignDialog
        open={campaignOpen}
        onClose={() => setCampaignOpen(false)}
        accountId={accountId ?? ""}
        contacts={rows.filter((r) => picked.has(r.id)).map((r) => ({ id: r.id, phone_number: r.phone_number }))}
        onDone={() => { clearPicked(); setCampaignOpen(false); }}
      />

      <ImportCsvDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        accountId={accountId ?? ""}
        onDone={() => { setImportOpen(false); load(); }}
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
    </div>
  );
}

function BulkAddDialog({
  open, onClose, accountId, contactIds, onDone,
}: { open: boolean; onClose: () => void; accountId: string; contactIds: string[]; onDone: () => void }) {
  const [lists, setLists] = useState<ListLite[]>([]);
  const [target, setTarget] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !accountId) return;
    fetchLists(accountId).then((l) => {
      setLists(l);
      if (l[0]) setTarget(l[0].id);
    }).catch(() => {});
  }, [open, accountId]);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "new") {
        if (!newName.trim()) { toast.error("Dê um nome à lista"); return; }
        await createListFromContacts(accountId, newName.trim(), contactIds);
      } else {
        if (!target) { toast.error("Selecione uma lista"); return; }
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
            <Button size="sm" variant={mode === "existing" ? "default" : "outline"} onClick={() => setMode("existing")}>
              Lista existente
            </Button>
            <Button size="sm" variant={mode === "new" ? "default" : "outline"} onClick={() => setMode("new")} className="gap-1.5">
              <FolderPlus className="h-3.5 w-3.5" /> Nova lista
            </Button>
          </div>
          {mode === "existing" ? (
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                {lists.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name} ({l.member_count})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input placeholder="Nome da nova lista" value={newName} onChange={(e) => setNewName(e.target.value)} />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportCsvDialog({
  open, onClose, accountId, onDone,
}: { open: boolean; onClose: () => void; accountId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const res = await importContactsCsv(accountId, text);
      toast.success(`${res.created} contato(s) importado(s)${res.skipped ? `, ${res.skipped} ignorado(s)` : ""}`);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha no import");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar contatos de CSV</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Colunas reconhecidas: <code>nome</code>, <code>telefone</code>, <code>email</code>.
            Duplicados por telefone são atualizados.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-violet-500/10 file:px-3 file:py-1.5 file:text-violet-300 hover:file:bg-violet-500/20"
          />
          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Importando…
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkOwnerDialog({
  open, onClose, accountId, contactIds, onDone,
}: { open: boolean; onClose: () => void; accountId: string; contactIds: string[]; onDone: () => void }) {
  const [team, setTeam] = useState<TeamLite[]>([]);
  const [mode, setMode] = useState<"single" | "rr">("single");
  const [owner, setOwner] = useState<string>("__none");
  const [rrPicked, setRrPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !accountId) return;
    fetchTeam(accountId).then((t) => {
      setTeam(t);
      setRrPicked(new Set(t.map((x) => x.user_id)));
    }).catch(() => {});
  }, [open, accountId]);
  const toggleRr = (uid: string) =>
    setRrPicked((p) => { const n = new Set(p); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });
  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "rr") {
        const owners = Array.from(rrPicked);
        if (!owners.length) { toast.error("Selecione ao menos 1 operador"); return; }
        const r = await bulkAssignRoundRobin(contactIds, owners);
        toast.success(`${r.assigned} contato(s) distribuído(s) entre ${owners.length} operador(es)`);
      } else {
        await bulkAssignOwner(contactIds, owner === "__none" ? null : owner);
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
          <Button size="sm" variant={mode === "single" ? "default" : "outline"} onClick={() => setMode("single")}>
            Único
          </Button>
          <Button size="sm" variant={mode === "rr" ? "default" : "outline"} onClick={() => setMode("rr")} className="gap-1.5">
            <Shuffle className="h-3.5 w-3.5" /> Round-robin
          </Button>
        </div>
        {mode === "single" ? (
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Sem responsável</SelectItem>
              {team.map((t) => (
                <SelectItem key={t.user_id} value={t.user_id}>{t.name ?? t.email ?? t.user_id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="space-y-1.5 rounded-md border border-border bg-muted/20 p-3 text-xs">
            <p className="mb-1 text-muted-foreground">
              Distribui igualmente entre os operadores selecionados.
            </p>
            {team.map((t) => (
              <label key={t.user_id} className="flex cursor-pointer items-center gap-2">
                <Checkbox checked={rrPicked.has(t.user_id)} onCheckedChange={() => toggleRr(t.user_id)} />
                <span>{t.name ?? t.email ?? t.user_id}</span>
              </label>
            ))}
            {team.length === 0 && <p className="text-muted-foreground">Sem operadores na equipe.</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DedupeDialog({
  open, onClose, rows, onMerged,
}: { open: boolean; onClose: () => void; rows: CentralContact[]; onMerged: () => void }) {
  const groups = useMemo(() => (open ? findDuplicateGroups(rows) : []), [open, rows]);
  const [busy, setBusy] = useState<string | null>(null);
  const handleMerge = async (g: DuplicateGroup) => {
    const primary = pickPrimaryContact(g.contacts);
    const dupes = g.contacts.filter((c) => c.id !== primary.id).map((c) => c.id);
    if (!confirm(`Mesclar ${dupes.length} duplicado(s) em "${primary.name ?? primary.phone_number ?? primary.id}"?`)) return;
    setBusy(g.key);
    try {
      await mergeContacts(primary.id, dupes);
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
          <DialogTitle>Contatos duplicados ({groups.length} grupo{groups.length === 1 ? "" : "s"})</DialogTitle>
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
                <div key={`${g.kind}:${g.key}`} className="rounded-lg border border-border bg-muted/10 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs">
                      <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-violet-300">
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
                      {busy === g.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}
                      Mesclar
                    </Button>
                  </div>
                  <ul className="space-y-1 text-xs">
                    {g.contacts.map((c) => (
                      <li key={c.id} className="flex items-center justify-between rounded border border-border/60 bg-card px-2 py-1">
                        <span className={c.id === primary.id ? "font-semibold text-foreground" : "text-muted-foreground"}>
                          {c.id === primary.id && <span className="mr-1 text-[10px] text-emerald-400">PRIMÁRIO</span>}
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
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkTagDialog({
  open, onClose, accountId, contactIds, onDone,
}: { open: boolean; onClose: () => void; accountId: string; contactIds: string[]; onDone: () => void }) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !accountId) return;
    fetchTagSuggestions(accountId).then(setSuggestions).catch(() => {});
  }, [open, accountId]);
  const submit = async () => {
    if (!tag.trim()) { toast.error("Informe a tag"); return; }
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
                className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground hover:border-violet-500/40 hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkCampaignDialog({
  open, onClose, accountId, contacts, onDone,
}: { open: boolean; onClose: () => void; accountId: string; contacts: { id: string; phone_number: string | null }[]; onDone: () => void }) {
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);
  const [target, setTarget] = useState<string>("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !accountId) return;
    fetchEditableCampaigns(accountId).then((c) => {
      setCampaigns(c);
      if (c[0]) setTarget(c[0].id);
    }).catch(() => {});
  }, [open, accountId]);
  const submit = async () => {
    if (!target) { toast.error("Selecione uma campanha"); return; }
    setBusy(true);
    try {
      const res = await bulkAddToCampaign(accountId, target, contacts);
      toast.success(`${res.added} adicionado(s)${res.skipped ? `, ${res.skipped} sem telefone` : ""}`);
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
            <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
            <SelectContent>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} <span className="ml-1 text-[10px] text-muted-foreground">· {c.status}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || !campaigns.length}>
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductivityDialog({
  open, onClose, accountId,
}: { open: boolean; onClose: () => void; accountId: string }) {
  const [rows, setRows] = useState<OwnerProductivity[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !accountId) return;
    setLoading(true);
    fetchProductivity(accountId).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [open, accountId]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Produtividade por responsável</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem dados ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
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
                    <td className="px-2 py-2 text-right tabular-nums text-emerald-300">{r.customers}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-rose-300">{r.delinquent}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.last7d_calls}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.last7d_whatsapp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
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
}: {
  c: CentralContact;
  checked: boolean;
  onCheck: () => void;
  onOpen: () => void;
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
      className="grid cursor-pointer grid-cols-12 items-center gap-2 border-b border-border px-4 py-3 transition hover:bg-muted/30"
    >
      <div className="col-span-1 flex items-center" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={checked} onCheckedChange={onCheck} />
      </div>
      <div className="col-span-3 flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-[11px] font-semibold text-white">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {c.name ?? c.phone_number ?? "Sem nome"}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {c.phone_number && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone_number}</span>}
            {c.email && <span className="inline-flex items-center gap-1 truncate"><Mail className="h-3 w-3" />{c.email}</span>}
          </div>
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
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title="Ligar"
              onClick={() => window.open(`tel:${c.phone_number}`)}
            >
              <Phone className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title="WhatsApp"
              onClick={() =>
                window.open(
                  `https://wa.me/${(c.phone_number ?? "").replace(/\D/g, "")}`,
                  "_blank",
                )
              }
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="Abrir conversa"
          asChild
        >
          <Link to="/chat">
            <Sparkles className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </li>
  );
}

function ContactDrawer({
  contact,
  onClose,
  onChanged,
}: {
  contact: CentralContact | null;
  onClose: () => void;
  onChanged: (c: CentralContact) => void;
}) {
  const { accountId } = useAccount();
  const [timeline, setTimeline] = useState<{ calls: any[]; conversations: any[]; lists: any[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!contact || !accountId) return;
    setLoading(true);
    fetchContactTimeline(contact.id, accountId)
      .then(setTimeline)
      .catch(() => setTimeline({ calls: [], conversations: [], lists: [] }))
      .finally(() => setLoading(false));
  }, [contact, accountId]);

  if (!contact) return null;

  const handleSave = async (patch: Partial<CentralContact>) => {
    setSaving(true);
    try {
      await updateContactOps(contact.id, patch as any);
      onChanged({ ...contact, ...patch });
      toast.success("Atualizado");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao atualizar");
    } finally {
      setSaving(false);
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
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/20 p-3 text-xs">
            {contact.phone_number && (
              <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" />{contact.phone_number}</div>
            )}
            {contact.email && (
              <div className="flex items-center gap-1.5 truncate"><Mail className="h-3 w-3" />{contact.email}</div>
            )}
            <div className="flex items-center gap-1.5"><Clock className="h-3 w-3" />Última: {timeAgoShort(contact.last_activity_at)}</div>
            <div className="flex items-center gap-1.5"><PhoneCall className="h-3 w-3" />Ligação: {timeAgoShort(contact.last_call_at)}</div>
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
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(LIFECYCLE_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
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
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(OPERATIONAL_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {contact.phone_number && (
              <>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.open(`tel:${contact.phone_number}`)}>
                  <Phone className="h-3.5 w-3.5" /> Ligar
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.open(`https://wa.me/${(contact.phone_number ?? "").replace(/\D/g, "")}`, "_blank")}>
                  <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
                </Button>
              </>
            )}
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link to="/chat"><Bot className="h-3.5 w-3.5" /> Conversa</Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link to="/campanhas/nova"><Rocket className="h-3.5 w-3.5" /> Em campanha</Link>
            </Button>
          </div>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Timeline</h3>
            {loading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-3">
                {timeline?.calls.length === 0 && timeline?.conversations.length === 0 && timeline?.lists.length === 0 && (
                  <p className="text-xs text-muted-foreground">Sem histórico ainda.</p>
                )}
                {timeline?.calls.map((call) => (
                  <div key={call.id} className="rounded-lg border border-border bg-card p-3 text-xs">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 font-medium"><PhoneCall className="h-3 w-3" /> Ligação · {call.status}</span>
                      <span className="text-muted-foreground">{timeAgoShort(call.started_at)}</span>
                    </div>
                    {call.summary && <p className="text-muted-foreground">{call.summary}</p>}
                    {call.classification && (
                      <span className="mt-1 inline-block rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300">{call.classification}</span>
                    )}
                  </div>
                ))}
                {timeline?.conversations.map((conv) => (
                  <div key={conv.id} className="rounded-lg border border-border bg-card p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 font-medium"><MessageSquare className="h-3 w-3" /> Conversa #{conv.display_id}</span>
                      <span className="text-muted-foreground">{timeAgoShort(conv.last_activity_at)}</span>
                    </div>
                  </div>
                ))}
                {timeline?.lists.map((lm, i) => (
                  <div key={i} className="rounded-lg border border-border bg-card p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 font-medium"><ClipboardList className="h-3 w-3" /> Lista: {lm.contact_lists?.name ?? "—"}</span>
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
