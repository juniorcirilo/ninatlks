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
} from "@/lib/central";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, ListPlus, FolderPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
          <div className="grid grid-cols-12 gap-2 border-b border-border bg-muted/30 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <div className="col-span-4">Contato</div>
            <div className="col-span-2">Status operacional</div>
            <div className="col-span-1 text-right">Score</div>
            <div className="col-span-2">Ciclo de vida</div>
            <div className="col-span-1">Última</div>
            <div className="col-span-2 text-right">Ações</div>
          </div>
          <ul>
            {filtered.map((c) => (
              <ContactRow key={c.id} c={c} onOpen={() => setSelected(c)} />
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
    </div>
  );
}

function ContactRow({ c, onOpen }: { c: CentralContact; onOpen: () => void }) {
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
      <div className="col-span-4 flex items-center gap-3">
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
