import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Search,
  Phone,
  Mail,
  Sparkles,
  Users,
  Target,
  Trophy,
  Gauge,
  LayoutGrid,
  Download,
  MoreHorizontal,
  MessageSquare,
  Copy,
  Trash2,
  ArrowUpDown,
  Inbox,
} from "lucide-react";
import { useAccount } from "@/lib/account-context";
import { useRealtimeRefresh } from "@/lib/realtime-client";
import { fetchPipeline, stageTone, timeAgo, type LeadCard, type Pipeline } from "@/lib/pipeline";
import {
  LeadAvatar,
  ScoreBadge,
  SentimentBadge,
  StageBadge,
  AiSourceBadge,
} from "@/components/pipeline/badges";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/layout/StatCard";
import { EmptyState } from "@/components/layout/EmptyState";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { lgpdDeleteContact } from "@/lib/contacts";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/contacts")({
  head: () => ({
    meta: [
      { title: "Leads — Utalks" },
      { name: "description", content: "Lista de leads do agente Nina (SDR)." },
    ],
  }),
  component: LeadsPage,
});

type FlatLead = LeadCard & {
  stage_id: string;
  stage_name: string;
  stage_color: string;
  is_won: boolean;
  is_lost: boolean;
};

type SortKey = "score" | "activity" | "name";

function LeadsPage() {
  const { accountId } = useAccount();
  const [data, setData] = useState<Pipeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!accountId) {
        setLoading(false);
        return;
      }
      try {
        setData(await fetchPipeline(accountId));
      } catch {
        if (!opts.silent) setData(null);
      } finally {
        setLoading(false);
      }
    },
    [accountId],
  );

  // Leads mudam de estágio por classificação automática pós-ligação, não só
  // por ação do usuário nesta tela.
  useRealtimeRefresh(["contacts"], accountId, () => load({ silent: true }), {
    debounceMs: 1000,
  });

  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    fetchPipeline(accountId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [accountId]);

  const flat = useMemo<FlatLead[]>(() => {
    if (!data) return [];
    return data.stages.flatMap((s) =>
      s.leads.map((l) => ({
        ...l,
        stage_id: s.id,
        stage_name: s.name,
        stage_color: s.color,
        is_won: s.is_won,
        is_lost: s.is_lost,
      })),
    );
  }, [data]);

  const totals = useMemo(() => {
    const total = flat.length;
    const won = flat.filter((l) => l.is_won).length;
    const lost = flat.filter((l) => l.is_lost).length;
    const qualified = total - won - lost;
    const avgScore =
      total > 0 ? Math.round(flat.reduce((acc, l) => acc + (l.score ?? 0), 0) / total) : 0;
    return { total, won, lost, qualified, avgScore };
  }, [flat]);

  const filtered = useMemo(() => {
    let rows = flat;
    if (stageFilter !== "all") {
      rows = rows.filter((r) => r.stage_id === stageFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.name && r.name.toLowerCase().includes(q)) ||
          (r.phone_number && r.phone_number.toLowerCase().includes(q)) ||
          (r.email && r.email.toLowerCase().includes(q)),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === "name") {
        return (a.name ?? "").localeCompare(b.name ?? "") * dir;
      }
      if (sortKey === "activity") {
        const av = new Date(a.stage_changed_at ?? a.last_activity_at ?? 0).getTime();
        const bv = new Date(b.stage_changed_at ?? b.last_activity_at ?? 0).getTime();
        return (av - bv) * dir;
      }
      return ((a.score ?? 0) - (b.score ?? 0)) * dir;
    });
  }, [flat, search, stageFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  async function handleDelete(id: string) {
    if (!accountId) return;
    if (!confirm("Excluir definitivamente este lead (LGPD)?")) return;
    try {
      await lgpdDeleteContact(accountId, id);
      toast.success("Lead excluído");
      setData((prev) =>
        prev
          ? {
              ...prev,
              stages: prev.stages.map((s) => ({
                ...s,
                leads: s.leads.filter((l) => l.id !== id),
              })),
            }
          : prev,
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao excluir");
    }
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="w-full px-6 py-6">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Base completa de contatos qualificados pela Nina, com sentimento e score em tempo real.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to="/pipeline">
              <LayoutGrid className="h-3.5 w-3.5" />
              Ver Kanban
            </Link>
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" disabled>
            <Download className="h-3.5 w-3.5" />
            Exportar
          </Button>
        </div>
      </header>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total de leads" value={String(totals.total)} icon={Users} />
        <StatCard
          label="Em fluxo"
          value={String(totals.qualified)}
          icon={Target}
          delta={`${totals.total > 0 ? Math.round((totals.qualified / totals.total) * 100) : 0}% do total`}
          trend="neutral"
        />
        <StatCard
          label="Ganhos"
          value={String(totals.won)}
          icon={Trophy}
          delta={totals.lost > 0 ? `${totals.lost} perdidos` : "—"}
          trend={totals.won > totals.lost ? "up" : "neutral"}
        />
        <StatCard
          label="Score médio"
          value={String(totals.avgScore)}
          icon={Gauge}
          delta={
            totals.avgScore >= 75
              ? "Quente"
              : totals.avgScore >= 40
                ? "Morno"
                : totals.avgScore > 0
                  ? "Frio"
                  : "—"
          }
          trend={totals.avgScore >= 75 ? "up" : totals.avgScore >= 40 ? "neutral" : "down"}
        />
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou email…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip
            active={stageFilter === "all"}
            onClick={() => setStageFilter("all")}
            label="Todos"
            count={flat.length}
          />
          {data?.stages.map((s) => (
            <FilterChip
              key={s.id}
              active={stageFilter === s.id}
              onClick={() => setStageFilter(s.id)}
              label={s.name}
              count={s.leads.length}
              color={s.color}
            />
          ))}
        </div>
      </div>

      {/* Tabela em card */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={
            search || stageFilter !== "all" ? "Nenhum lead com esses filtros" : "Sem leads ainda"
          }
          description={
            search || stageFilter !== "all"
              ? "Ajuste os filtros ou limpe a busca."
              : "Os leads aparecem aqui após o primeiro atendimento da Nina."
          }
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/pipeline">Ver no Kanban</Link>
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 shadow-elevation-1">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-200 dark:border-slate-800 bg-muted/30 hover:bg-muted/30">
                <TableHead className="w-[36%] py-3 pl-4">
                  <SortButton
                    active={sortKey === "name"}
                    dir={sortDir}
                    onClick={() => toggleSort("name")}
                  >
                    Lead
                  </SortButton>
                </TableHead>
                <TableHead className="py-3">Stage</TableHead>
                <TableHead className="py-3">
                  <SortButton
                    active={sortKey === "score"}
                    dir={sortDir}
                    onClick={() => toggleSort("score")}
                  >
                    Score
                  </SortButton>
                </TableHead>
                <TableHead className="py-3">Sentimento</TableHead>
                <TableHead className="py-3">
                  <SortButton
                    active={sortKey === "activity"}
                    dir={sortDir}
                    onClick={() => toggleSort("activity")}
                  >
                    Última atividade
                  </SortButton>
                </TableHead>
                <TableHead className="w-10 py-3 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <LeadRow key={r.id} lead={r} onDelete={handleDelete} />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <p className="mt-4 text-center text-xs text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? "lead exibido" : "leads exibidos"} · Atualização
        em tempo real via Nina IA
      </p>
    </div>
  );
}

/* ─────────────── Sort button ─────────────── */

function SortButton({
  children,
  active,
  dir,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      <ArrowUpDown
        className={cn(
          "h-3 w-3 transition-transform",
          active && dir === "asc" && "rotate-180",
          !active && "opacity-40",
        )}
      />
    </button>
  );
}

/* ─────────────── Filter chip ─────────────── */

function FilterChip({
  active,
  onClick,
  label,
  count,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: string;
}) {
  const tone = color ? stageTone(color) : null;
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
        active
          ? "border-accent/40 bg-accent/10 text-accent shadow-elevation-1"
          : "border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 text-muted-foreground hover:border-accent/30 hover:bg-muted/40 hover:text-foreground",
      )}
    >
      {tone && <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />}
      <span>{label}</span>
      <span
        className={cn(
          "rounded-full px-1.5 text-[10px] tabular-nums",
          active ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

/* ─────────────── Lead row ─────────────── */

function LeadRow({ lead, onDelete }: { lead: FlatLead; onDelete: (id: string) => void }) {
  function copyPhone() {
    if (!lead.phone_number) return;
    navigator.clipboard.writeText(lead.phone_number);
    toast.success("Telefone copiado");
  }

  return (
    <TableRow className="border-gray-200 dark:border-slate-800 transition-colors hover:bg-muted/40">
      {/* Lead */}
      <TableCell className="py-3 pl-4">
        <div className="flex items-start gap-3">
          <LeadAvatar id={lead.id} name={lead.name} phone={lead.phone_number} className="h-9 w-9" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">
                {lead.name ?? lead.phone_number ?? "Sem nome"}
              </span>
              <AiSourceBadge source={lead.stage_source} className="ring-1 ring-accent/30" />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {lead.phone_number && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {lead.phone_number}
                </span>
              )}
              {lead.email && (
                <span className="inline-flex items-center gap-1 truncate">
                  <Mail className="h-3 w-3 shrink-0" />
                  <span className="truncate">{lead.email}</span>
                </span>
              )}
            </div>
            {lead.briefing?.dor && (
              <p className="mt-1 line-clamp-1 text-[11px] text-foreground/70">
                <Sparkles className="mr-1 inline h-3 w-3 text-accent" />
                {lead.briefing.dor}
              </p>
            )}
          </div>
        </div>
      </TableCell>

      {/* Stage */}
      <TableCell className="py-3">
        <StageBadge name={lead.stage_name} color={lead.stage_color} />
      </TableCell>

      {/* Score */}
      <TableCell className="py-3">
        <ScoreBadge score={lead.score} />
      </TableCell>

      {/* Sentimento */}
      <TableCell className="py-3">
        <SentimentBadge sentiment={lead.last_sentiment} />
        {!lead.last_sentiment && <span className="text-[11px] text-muted-foreground">—</span>}
      </TableCell>

      {/* Última atividade */}
      <TableCell className="py-3">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {timeAgo(lead.stage_changed_at ?? lead.last_activity_at)}
        </span>
      </TableCell>

      {/* Ações */}
      <TableCell className="py-3 pr-4 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem asChild>
              <Link to="/chat" className="cursor-pointer">
                <MessageSquare className="mr-2 h-3.5 w-3.5" />
                Abrir conversa
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/pipeline" className="cursor-pointer">
                <LayoutGrid className="mr-2 h-3.5 w-3.5" />
                Ver no Kanban
              </Link>
            </DropdownMenuItem>
            {lead.phone_number && (
              <DropdownMenuItem onClick={copyPhone}>
                <Copy className="mr-2 h-3.5 w-3.5" />
                Copiar telefone
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(lead.id)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Excluir (LGPD)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
