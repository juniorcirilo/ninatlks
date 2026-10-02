import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search, Phone, Mail, UserPlus, RefreshCw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { EmptyState } from "@/components/layout/EmptyState";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  useTablePrefs,
  ColumnsFilterPopover,
  usePagination,
  paginate,
  TablePagination,
} from "@/components/layout/TableFilters";
import { useAccount } from "@/lib/account-context";
import {
  fetchCentralContacts,
  timeAgoShort,
  OPERATIONAL_LABEL,
  type CentralContact,
  type OperationalStatus,
} from "@/lib/central";
import { fetchAgentSources, runAgentSource } from "@/lib/agent-sources";
import { truncateAgentContacts } from "@/lib/agents/novos-clientes.functions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * Nome do agente cujos contatos importados aparecem aqui. Filtro por nome
 * (não id) porque é assim que o operador reconhece o agente — o id de
 * persona muda entre contas/ambientes.
 */
const AGENT_NAME = "Larissa";

const COLUMNS = [
  { key: "client_id", label: "Client ID" },
  { key: "telefone", label: "Telefone" },
  { key: "email", label: "Email" },
  { key: "empresa", label: "Empresa" },
  { key: "atividade", label: "Última atividade" },
];
const DEFAULT_COLUMNS = COLUMNS.map((c) => c.key);

export const Route = createFileRoute("/_authenticated/novos-clientes")({
  head: () => ({
    meta: [
      { title: "Novos clientes — Nina Talks" },
      {
        name: "description",
        content: `Contatos importados pelo agente ${AGENT_NAME}.`,
      },
    ],
  }),
  component: NovosClientesPage,
});

export function NovosClientesPage() {
  const { accountId } = useAccount();
  const navigate = useNavigate();
  const fnTruncate = useServerFn(truncateAgentContacts);
  const { prefs, update } = useTablePrefs("novos_clientes", DEFAULT_COLUMNS);

  const [rows, setRows] = useState<CentralContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [confirmTruncate, setConfirmTruncate] = useState(false);
  const [truncating, setTruncating] = useState(false);

  const load = useCallback(
    (opts: { silent?: boolean } = {}) => {
      if (!accountId) return;
      if (!opts.silent) setLoading(true);
      fetchCentralContacts(accountId)
        .then(setRows)
        .catch((e: any) => toast.error(e?.message ?? "Falha ao carregar contatos"))
        .finally(() => {
          if (!opts.silent) setLoading(false);
        });
    },
    [accountId],
  );

  useEffect(() => {
    load();
  }, [load]);

  const fromAgent = useMemo(
    () =>
      rows.filter(
        (r) => (r.source_agent_name ?? "").trim().toLowerCase() === AGENT_NAME.toLowerCase(),
      ),
    [rows],
  );

  // O id da persona é o que sincroniza/trunca de verdade — vem do próprio
  // contato já carregado (source_agent_id), sem precisar de outra chamada.
  const agentId = fromAgent[0]?.source_agent_id ?? null;

  const statuses = useMemo(
    () => [...new Set(fromAgent.map((r) => r.operational_status).filter(Boolean))],
    [fromAgent],
  );

  const filtered = useMemo(() => {
    let list = fromAgent;
    if (prefs.statusFilter.length > 0) {
      list = list.filter((r) => prefs.statusFilter.includes(r.operational_status));
    }
    const q = prefs.search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          (r.name && r.name.toLowerCase().includes(q)) ||
          (r.external_id && r.external_id.toLowerCase().includes(q)) ||
          (r.phone_number && r.phone_number.toLowerCase().includes(q)) ||
          (r.email && r.email.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [fromAgent, prefs.search, prefs.statusFilter]);

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

  const col = (k: string) => prefs.columns.includes(k);

  /** Busca agora a fonte de dados do agente (Configurações > Webhooks >
   * Fontes de Dados) e recarrega a lista em seguida — mesmo padrão de
   * Orçamentos/Cobranças. */
  async function handleSync() {
    if (!accountId || syncing) return;
    setSyncing(true);
    try {
      const sources = await fetchAgentSources(accountId);
      const source = sources.find(
        (s) => (s.agent_name ?? "").trim().toLowerCase() === AGENT_NAME.toLowerCase(),
      );
      if (!source) {
        toast.error(
          `Nenhuma fonte de dados configurada para ${AGENT_NAME} em Configurações > Webhooks > Fontes de Dados.`,
        );
        return;
      }
      const result = await runAgentSource(accountId, source.id);
      if (result.ok) {
        toast.success(
          `Sincronizado: ${result.created} novo(s), ${result.updated} atualizado(s), ${result.skipped} ignorado(s).`,
        );
        load();
      } else {
        toast.error(result.error ?? "Falha ao sincronizar");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  async function handleTruncate() {
    if (!agentId || truncating) return;
    setTruncating(true);
    try {
      const { deleted } = await fnTruncate({ data: { agentId } });
      toast.success(`${deleted} contato(s) removido(s).`);
      setConfirmTruncate(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao truncar");
    } finally {
      setTruncating(false);
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
    <div className="w-full">
      <PageHeader
        eyebrow="SDR"
        title="Novos clientes"
        description={`Contatos importados pelo agente ${AGENT_NAME} — ${fromAgent.length} no total.`}
      />

      <AlertDialog open={confirmTruncate} onOpenChange={setConfirmTruncate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar todos os contatos de {AGENT_NAME}?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove todos os contatos importados por este agente, junto com conversas, ligações e
              títulos/orçamentos vinculados a eles. Não dá pra desfazer.
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

      <div className="px-6 py-6">
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Contatos importados" value={String(fromAgent.length)} icon={UserPlus} />
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={prefs.search}
              onChange={(e) => update({ search: e.target.value })}
              placeholder="Buscar nome, código, telefone ou email…"
              className="pl-9"
            />
          </div>
          <ColumnsFilterPopover
            columns={COLUMNS}
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
            statusLabel={OPERATIONAL_LABEL}
          />
          <Button variant="outline" size="sm" className="gap-1.5" disabled={syncing} onClick={handleSync}>
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
            Sincronizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            disabled={fromAgent.length === 0 || !agentId}
            onClick={() => setConfirmTruncate(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Truncar
          </Button>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="Nenhum contato encontrado"
            description={
              fromAgent.length === 0
                ? `Ainda não há contatos importados pelo agente ${AGENT_NAME}.`
                : "Ajuste a busca ou os filtros para ver mais resultados."
            }
          />
        ) : (
          <Card className="overflow-hidden border-border bg-card shadow-elevation-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contato</TableHead>
                  {col("client_id") && <TableHead>Client ID</TableHead>}
                  {col("telefone") && <TableHead>Telefone</TableHead>}
                  {col("email") && <TableHead>Email</TableHead>}
                  {col("empresa") && <TableHead>Empresa</TableHead>}
                  {col("atividade") && <TableHead className="text-right">Última atividade</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => navigate({ to: "/central", search: { contactId: c.id } })}
                  >
                    <TableCell className="font-medium text-foreground">
                      {c.name ?? "Sem nome"}
                    </TableCell>
                    {col("client_id") && (
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {c.external_id ?? "—"}
                      </TableCell>
                    )}
                    {col("telefone") && (
                      <TableCell className="text-muted-foreground">
                        {c.phone_number ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Phone className="h-3.5 w-3.5" />
                            {c.phone_number}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    )}
                    {col("email") && (
                      <TableCell className="text-muted-foreground">
                        {c.email ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Mail className="h-3.5 w-3.5" />
                            {c.email}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    )}
                    {col("empresa") && (
                      <TableCell className="text-muted-foreground">
                        {c.nome_fantasia ?? c.razao_social ?? "—"}
                      </TableCell>
                    )}
                    {col("atividade") && (
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                        {timeAgoShort(c.last_activity_at)}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="px-4 pb-4">
              <TablePagination
                itemCount={filtered.length}
                totalCount={fromAgent.length}
                itemLabel="contatos"
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
      </div>
    </div>
  );
}
