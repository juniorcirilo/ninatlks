import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Plus,
  Users,
  Trash2,
  Rocket,
  ShieldCheck,
  Pencil,
  Clock,
  Ban,
  UserPlus,
  Search,
  X,
  Check,
  ChevronDown,
  DatabaseZap,
  Bot,
  RotateCcw,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/lib/account-context";
import { useRealtimeRefresh } from "@/lib/realtime-client";
import {
  fetchContactLists,
  fetchListCandidates,
  fetchRetentionRules,
  upsertRetentionRule,
  deleteRetentionRule,
  fetchCampaigns,
  CAMPAIGN_KIND_LABEL,
  type ContactListRow,
  type CampaignKind,
  type RetentionRuleRow,
  type CampaignRow,
  type ListCandidatesResult,
} from "@/lib/campaigns";
import {
  fetchDncList,
  addToDnc,
  removeFromDnc,
  fetchCompliancePolicy,
  saveCompliancePolicy,
  DEFAULT_COMPLIANCE_POLICY,
  type DncEntry,
  type CompliancePolicy,
} from "@/lib/compliance";
import { fetchPipeline, type Stage } from "@/lib/pipeline";
import { createManualContact } from "@/lib/central";
import { fetchPersonas, type Persona } from "@/lib/personas";
import {
  fieldsForCampaignKind,
  inferAgentKind,
  type TemplateField,
} from "@/lib/webhook-inbound-templates";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ListDocumentItem = {
  id: string;
  numero: string | null;
  valor: number | null;
  status: string | null;
  diasEmAtraso?: number | null;
  contactId: string;
  contactName: string | null;
  contactPhone: string | null;
  contactExternalId: string | null;
};
type ListDocumentsResult = { cobranca: ListDocumentItem[]; orcamento: ListDocumentItem[] };

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Unifica cobrança+orçamento por cliente (contactId — já é a unidade real de
 * "código do cliente": o casamento na ingestão dedupe por external_id, então
 * um cliente nunca tem mais de um contato aqui) — sem isso a mesma pessoa
 * aparecia uma vez por título/orçamento, repetindo nome/telefone à toa. */
function groupListDocumentsByClient(items: ListDocumentItem[]) {
  const groups = new Map<string, { contactName: string | null; contactPhone: string | null; contactExternalId: string | null; items: ListDocumentItem[] }>();
  for (const it of items) {
    if (!groups.has(it.contactId)) {
      groups.set(it.contactId, {
        contactName: it.contactName,
        contactPhone: it.contactPhone,
        contactExternalId: it.contactExternalId,
        items: [],
      });
    }
    groups.get(it.contactId)!.items.push(it);
  }
  return Array.from(groups.entries()).map(([contactId, g]) => ({ contactId, ...g }));
}

const TAB_CAPTION: Record<"lists" | "retention" | "compliance" | "dnc", string> = {
  lists: "Contatos agrupados por finalidade, para usar como público-alvo de campanhas.",
  retention: "Detecta clientes inativos por X dias e os enfileira numa campanha, todo dia.",
  compliance: "Horários permitidos para ligar e aviso de gravação, por dia da semana (LGPD).",
  dnc: "Números que nunca recebem ligação automática, mesmo que entrem numa lista.",
};

function parseCsv(csv: string): {
  rows: Array<{ name?: string | null; phoneNumber?: string | null; email?: string | null }>;
  skipped: number;
} {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { rows: [], skipped: 0 };
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const nameIdx = headers.findIndex((h) => h === "name");
  const phoneIdx = headers.findIndex((h) => h === "phone_number" || h === "phone");
  const emailIdx = headers.findIndex((h) => h === "email");
  const rows: Array<{ name?: string | null; phoneNumber?: string | null; email?: string | null }> =
    [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const name = nameIdx >= 0 ? cols[nameIdx]?.trim() || null : null;
    if (!name) {
      skipped++;
      continue;
    }
    rows.push({
      name,
      phoneNumber: phoneIdx >= 0 ? cols[phoneIdx]?.trim() || null : null,
      email: emailIdx >= 0 ? cols[emailIdx]?.trim() || null : null,
    });
  }
  return { rows, skipped };
}

type ImportResult = { created: number; updated: number; skipped: number };

/**
 * Resumo do upsert de contatos. A tela lia `imported`, campo que a API nunca
 * devolveu — o retorno sempre foi `{created, skipped}` — então o toast de
 * importação simplesmente não aparecia. Separar criados de atualizados também
 * evita anunciar "N importados" quando a carga só reencontrou quem já existia.
 */
function describeImport(res: ImportResult): string | null {
  const parts: string[] = [];
  if (res.created > 0) parts.push(`${res.created} contato(s) novo(s)`);
  if (res.updated > 0) parts.push(`${res.updated} já existente(s) atualizado(s)`);
  if (parts.length === 0) return null;
  return `CSV importado: ${parts.join(", ")}`;
}

/** Busca de estágio do funil por nome — evita colar um UUID de stage_id à mão. */
function StageCombobox({
  accountId,
  value,
  onChange,
}: {
  accountId: string | null;
  value: string;
  onChange: (stageId: string) => void;
}) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!accountId || loaded) return;
    fetchPipeline(accountId)
      .then((p) => setStages(p.stages ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [accountId, loaded]);

  useEffect(() => {
    if (!value) {
      setQuery("");
      return;
    }
    const match = stages.find((s) => s.id === value);
    if (match) setQuery(match.name);
  }, [value, stages]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const sorted = [...stages].sort((a, b) => a.position - b.position);
    if (!term || term === stages.find((s) => s.id === value)?.name.toLowerCase()) return sorted;
    return sorted.filter((s) => s.name.toLowerCase().includes(term));
  }, [stages, query, value]);

  return (
    <div className="relative">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (!e.target.value) onChange("");
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={
            loaded && stages.length === 0
              ? "Nenhum estágio cadastrado no funil"
              : "Buscar estágio do funil…"
          }
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 pr-7 text-sm"
        />
        {value && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange("")}
            title="Limpar filtro"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-gray-200 dark:border-slate-800 bg-popover shadow-md">
          {filtered.map((s) => (
            <li
              key={s.id}
              onMouseDown={() => {
                onChange(s.id);
                setQuery(s.name);
                setOpen(false);
              }}
              className="flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm hover:bg-muted"
            >
              {s.name}
              {s.id === value && <Check className="h-3.5 w-3.5 text-primary" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/listas")({
  head: () => ({
    meta: [
      { title: "Listas operacionais — Nina Talks" },
      {
        name: "description",
        content: "Listas de contatos para campanhas SDR, Cobrança, Pós-venda e Retenção.",
      },
    ],
  }),
  component: ListsPage,
});

function ListsPage() {
  const { accountId } = useAccount();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"lists" | "retention" | "compliance" | "dnc">("lists");
  const [rows, setRows] = useState<ContactListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // form
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CampaignKind>("sdr");
  // Agente dono desta lista — decide o "Tipo" (kind, abaixo) e os campos do
  // formulário manual automaticamente. Substitui a escolha manual de tipo:
  // cada agente já sabe qual operação ele faz.
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaId, setPersonaId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [filterStage, setFilterStage] = useState("");
  const [filterTag, setFilterTag] = useState("");
  // Sem isso, "sem CSV, sem filtro" varria a conta inteira e trazia junto
  // quem já é membro de outra lista (ex.: uma lista operacional alimentada
  // por webhook de agente). Default true — a mistura é o caso raro, não o
  // comum — mas o operador pode ligar para incluir de propósito.
  const [excludeListed, setExcludeListed] = useState(true);
  const [candidatesPreview, setCandidatesPreview] = useState<ListCandidatesResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  // Contato avulso adicionado na hora (puxado da base ou criado ali mesmo),
  // separado do CSV: cobre o caso de "faltou só um contato" sem exigir
  // arquivo para isso. Fica pendente até "Criar lista"/"Salvar alterações",
  // igual ao CSV — nada é gravado como membro antes disso.
  const [manualContacts, setManualContacts] = useState<
    Array<{ id: string; name: string; phone: string | null }>
  >([]);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickerListId, setPickerListId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<ContactListRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [listSearch, setListSearch] = useState("");
  const [listStatusFilter, setListStatusFilter] = useState<"all" | "aberta" | "finalizada">("all");
  const [finalizingId, setFinalizingId] = useState<string | null>(null);
  const [editingDocuments, setEditingDocuments] = useState<ListDocumentsResult | null>(null);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const resetForm = () => {
    setName("");
    setDescription("");
    setKind("sdr");
    setPersonaId("");
    setFilterStage("");
    setFilterTag("");
    setExcludeListed(true);
    setCsvFile(null);
    setManualContacts([]);
    setEditingId(null);
    setStep(0);
  };

  const startEdit = (r: ContactListRow) => {
    setEditingId(r.id);
    setName(r.name);
    setDescription(r.description ?? "");
    setKind((r.campaign_kind as CampaignKind) ?? "sdr");
    // Lista criada antes desta funcionalidade não tem agente salvo — fica sem
    // seleção, e o formulário manual cai de volta no conjunto genérico por tipo.
    setPersonaId(r.persona_id ?? "");
    const f = (r.filters ?? {}) as Record<string, unknown>;
    setFilterStage(typeof f.stage_id === "string" ? f.stage_id : "");
    setFilterTag(typeof f.tag === "string" ? f.tag : "");
    setExcludeListed(true);
    setCsvFile(null);
    setManualContacts([]);
    setCreating(true);
  };

  const refresh = useCallback(async () => {
    if (!accountId) return;
    try {
      setRows(await fetchContactLists(accountId));
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao carregar listas");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  // Lista gerada por sincronização de cobrança/orçamento carrega os títulos/
  // orçamentos linkados (operational_list_id) ao abrir a edição — sem isso
  // o operador só via nome/telefone dos contatos, sem saber qual título ou
  // orçamento exatamente colocou cada um ali.
  useEffect(() => {
    setExpandedClientId(null);
    if (!accountId || !editingId) {
      setEditingDocuments(null);
      return;
    }
    setLoadingDocuments(true);
    apiClient
      .get<ListDocumentsResult>(`/accounts/${accountId}/contact-lists/${editingId}/documents`)
      .then(setEditingDocuments)
      .catch(() => setEditingDocuments(null))
      .finally(() => setLoadingDocuments(false));
  }, [accountId, editingId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filteredRows = useMemo(() => {
    let list = rows;
    if (listStatusFilter !== "all") {
      list = list.filter((r) => (r.status ?? "aberta") === listStatusFilter);
    }
    const q = listSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.persona_name && r.persona_name.toLowerCase().includes(q)) ||
          (r.description && r.description.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [rows, listSearch, listStatusFilter]);

  async function toggleFinalize(r: ContactListRow) {
    if (!accountId || finalizingId) return;
    const nextStatus = (r.status ?? "aberta") === "finalizada" ? "aberta" : "finalizada";
    setFinalizingId(r.id);
    try {
      await apiClient.patch(`/accounts/${accountId}/contact-lists/${r.id}`, { status: nextStatus });
      toast.success(nextStatus === "finalizada" ? "Lista finalizada" : "Lista reaberta");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao atualizar status da lista");
    } finally {
      setFinalizingId(null);
    }
  }

  useEffect(() => {
    if (!accountId) return;
    fetchPersonas(accountId)
      .then((rows) => setPersonas(rows.filter((p) => p.enabled)))
      .catch(() => setPersonas([]));
  }, [accountId]);

  // O "Tipo" (campaign_kind) segue o agente escolhido, não é mais uma escolha
  // manual — mantém o rótulo/badge e o catálogo de fallback (fieldsForCampaignKind)
  // funcionando para quem ainda não cadastrou campos próprios no agente.
  useEffect(() => {
    if (!personaId) return;
    const p = personas.find((x) => x.id === personaId);
    if (p) setKind(inferAgentKind({ key: p.id, name: p.name }) as CampaignKind);
  }, [personaId, personas]);

  // A contagem de membros muda quando contatos entram/saem por import ou ação
  // em massa disparada de outra tela.
  useRealtimeRefresh(["contacts"], accountId, refresh, { debounceMs: 1000 });

  // Prévia de quantos contatos entrariam sem CSV — é o que dá ao operador
  // como saber, antes de salvar, se o toggle "excluir quem já está em outra
  // lista" está fazendo diferença. Só roda com o formulário aberto: a etapa
  // de importar via CSV/manual não depende disto, e evita chamada à toa.
  useEffect(() => {
    if (!accountId || !creating) {
      setCandidatesPreview(null);
      return;
    }
    const stageValid = filterStage.trim() && UUID_RE.test(filterStage.trim());
    // Sem estágio/tag/CSV não há filtro nenhum pra aplicar — a prévia (e o
    // salvamento, ver onCreate) não varre a conta inteira só porque o campo
    // está vazio. Mostra vazio direto, sem chamar a API à toa.
    if (!stageValid && !filterTag.trim() && !csvFile) {
      setCandidatesPreview({ contacts: [], totalEligible: 0, alreadyInOtherList: 0 });
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    fetchListCandidates(accountId, {
      stageId: stageValid ? filterStage.trim() : undefined,
      excludeListed,
    })
      .then((r) => {
        if (!cancelled) setCandidatesPreview(r);
      })
      .catch(() => {
        if (!cancelled) setCandidatesPreview(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, creating, filterStage, filterTag, csvFile, excludeListed]);

  const onCreate = async () => {
    if (!accountId || !name.trim()) {
      toast.error("Informe um nome");
      return;
    }
    try {
      setImporting(true);

      const filters: Record<string, unknown> = {};
      const stageValid = filterStage.trim() && UUID_RE.test(filterStage.trim());
      if (stageValid) filters.stage_id = filterStage.trim();
      if (filterTag.trim()) filters.tag = filterTag.trim();

      // EDIT MODE: update metadata + optionally append new contacts (CSV or filters)
      if (editingId) {
        await apiClient.patch(`/accounts/${accountId}/contact-lists/${editingId}`, {
          name: name.trim(),
          description: description.trim() || null,
          campaignKind: kind,
          personaId: personaId || null,
          filters,
        });

        // 1. Optional CSV import (creates new contacts in the account)
        if (csvFile) {
          const csv = await csvFile.text();
          const { rows: csvRows, skipped } = parseCsv(csv);
          if (skipped > 0)
            toast.warning(`${skipped} linha(s) do CSV ignorada(s) por falta de nome`);
          if (csvRows.length > 0) {
            const importRes = await apiClient.post<ImportResult>(
              `/accounts/${accountId}/contacts/import`,
              { rows: csvRows },
            );
            const msg = describeImport(importRes);
            if (msg) toast.success(msg);
          }
        }

        // 2. Append matching contacts to the list (only the ones not already members).
        // Só busca pelo filtro geral se há um motivo real pra isso (estágio,
        // tag ou CSV recém-importado) — sem isso a query "elegível e não
        // listado" varre a conta inteira, e qualquer contato que passou a se
        // qualificar entre abrir o formulário e clicar em salvar (ex.: criado
        // por uma campanha rodando em paralelo) entrava sem o operador ter
        // escolhido isso. Só picks manuais e CSV devem valer quando não há
        // filtro nenhum.
        const hasGeneralCriteria = Boolean(stageValid || filterTag.trim() || csvFile);
        const contacts = hasGeneralCriteria
          ? (
              await fetchListCandidates(accountId, {
                stageId: stageValid ? filterStage.trim() : undefined,
                excludeListed,
              })
            ).contacts
          : [];
        // Contato avulso soma aos que vieram do filtro — dedupe por id, porque
        // o mesmo contato pode ter sido pego pelo filtro e também adicionado à
        // mão.
        const candidateIds = Array.from(
          new Set([...contacts.map((c) => c.id), ...manualContacts.map((c) => c.id)]),
        );

        if (candidateIds.length > 0) {
          const existingData = await apiClient.get<Array<{ contact_id: string }>>(
            `/accounts/${accountId}/contact-lists/${editingId}/members`,
          );
          const have = new Set((existingData ?? []).map((r) => r.contact_id));
          const toAdd = candidateIds.filter((id) => !have.has(id));
          if (toAdd.length > 0) {
            const addRes = await apiClient.post<{ inserted: number }>(
              `/accounts/${accountId}/contact-lists/${editingId}/members`,
              { contactIds: toAdd },
            );
            const newCount = have.size + (addRes.inserted ?? toAdd.length);
            await apiClient.patch(`/accounts/${accountId}/contact-lists/${editingId}`, {
              memberCount: newCount,
            });
            toast.success(`Lista atualizada — ${toAdd.length} novo(s) contato(s) adicionado(s)`);
          } else {
            toast.success("Lista atualizada");
          }
        } else {
          toast.success("Lista atualizada");
        }

        resetForm();
        setCreating(false);
        refresh();
        return;
      }

      // CREATE MODE
      // 1. Import CSV first if provided
      if (csvFile) {
        const csv = await csvFile.text();
        const { rows: csvRows, skipped } = parseCsv(csv);
        if (skipped > 0) toast.warning(`${skipped} linha(s) do CSV ignorada(s) por falta de nome`);
        if (csvRows.length > 0) {
          const importRes = await apiClient.post<ImportResult>(
            `/accounts/${accountId}/contacts/import`,
            { rows: csvRows },
          );
          const msg = describeImport(importRes);
          if (msg) toast.success(msg);
        }
      }

      // Build initial members based on filters — mesmo motivo do modo edição:
      // só varre a conta pelo filtro geral quando há estágio/tag/CSV; picks
      // manuais sozinhos não devem trazer mais ninguém junto.
      const hasGeneralCriteria = Boolean(stageValid || filterTag.trim() || csvFile);
      const contacts = hasGeneralCriteria
        ? (
            await fetchListCandidates(accountId, {
              stageId: stageValid ? filterStage.trim() : undefined,
              excludeListed,
            })
          ).contacts
        : [];
      const contactIds = Array.from(
        new Set([...contacts.map((c) => c.id), ...manualContacts.map((c) => c.id)]),
      );

      const list = await apiClient.post<{ id: string }>(`/accounts/${accountId}/contact-lists`, {
        name: name.trim(),
        description: description.trim() || undefined,
        campaignKind: kind,
        personaId: personaId || undefined,
        contactIds,
      });

      if (contactIds.length > 0) {
        toast.success(`Lista criada com ${contactIds.length} contatos`);
      } else {
        toast.warning(
          "Lista criada, mas sem contatos. Importe um CSV ou adicione contatos em /contacts.",
        );
      }

      resetForm();
      setCreating(false);
      refresh();
    } catch (e: any) {
      toast.error(e?.body?.message ?? e?.message ?? "falha ao salvar lista");
    } finally {
      setImporting(false);
    }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/accounts/${accountId}/contact-lists/${deleteTarget.id}`);
      toast.success(`Lista "${deleteTarget.name}" excluída`);
      setDeleteTarget(null);
      refresh();
    } catch (e: any) {
      toast.error(e?.body?.message ?? "Falha ao excluir");
    } finally {
      setDeleting(false);
    }
  };

  const selectedPersona = personas.find((p) => p.id === personaId) ?? null;

  const agentPickerBlock = (
    <div className="space-y-2">
      <span className="text-xs font-medium text-muted-foreground">
        Agente — quem vai ligar para os contatos desta lista
      </span>
      <p className="text-[11px] text-muted-foreground">
        O tipo de operação e os campos do formulário de "adicionar contato específico" vêm
        automaticamente do agente escolhido (cadastrados na aba Dados dele, em Agentes de voz).
      </p>
      {personas.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-200 dark:border-slate-800 p-4 text-center text-xs text-muted-foreground">
          Nenhum agente cadastrado ainda. Crie um em{" "}
          <span className="font-medium text-foreground">Agentes de voz</span> antes de criar uma
          lista.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {personas.map((p) => {
            const active = personaId === p.id;
            const detectedKind = inferAgentKind({ key: p.id, name: p.name }) as CampaignKind;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPersonaId(p.id)}
                className={cn(
                  "flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-gray-200 dark:border-slate-800 hover:bg-muted/40",
                )}
              >
                <Bot className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                <span className="text-xs font-semibold">{p.name}</span>
                {p.description && (
                  <span className="text-[11px] text-muted-foreground">{p.description}</span>
                )}
                <span className="text-[10px] text-muted-foreground/70">
                  Tipo: {CAMPAIGN_KIND_LABEL[detectedKind]}
                  {p.variable_schema.length > 0
                    ? ` · ${p.variable_schema.length} campo(s) próprio(s)`
                    : " · sem campos próprios ainda"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const identityBlock = (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Nome">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Leads quentes — Outubro"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
      </Field>
      <Field label="Descrição">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Opcional"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
      </Field>
    </div>
  );

  const audienceBlock = (
    <div className="space-y-2">
      <Field label="Filtrar por estágio do funil (opcional)">
        <StageCombobox accountId={accountId} value={filterStage} onChange={setFilterStage} />
      </Field>
      <p className="text-[11px] text-muted-foreground">
        Sem filtro, a lista considera todos os contatos com telefone válido e não bloqueados.
      </p>

      <label className="flex items-start gap-2 rounded-md border border-gray-200 dark:border-slate-800 bg-muted/30 p-2.5">
        <input
          type="checkbox"
          checked={excludeListed}
          onChange={(e) => setExcludeListed(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 shrink-0"
        />
        <span className="text-xs">
          <span className="font-medium text-foreground">
            Não incluir contatos que já estão em outra lista
          </span>
          <span className="block text-[11px] text-muted-foreground">
            Desligue para trazer também quem já pertence a outra lista operacional (ex.:
            uma lista alimentada por webhook de agente) — por padrão elas ficam separadas.
          </span>
        </span>
      </label>

      <p className="text-[11px] text-muted-foreground">
        {previewLoading ? (
          "Calculando quantos contatos entrariam…"
        ) : candidatesPreview ? (
          <>
            <span className="font-medium text-foreground">
              {candidatesPreview.contacts.length}
            </span>{" "}
            contato(s) entrariam sem CSV
            {candidatesPreview.alreadyInOtherList > 0 && (
              <>
                {" "}
                — de {candidatesPreview.totalEligible} elegíveis,{" "}
                {candidatesPreview.alreadyInOtherList} já estão em outra lista (
                {excludeListed ? "deixados de fora" : "incluídos mesmo assim"}).
              </>
            )}
          </>
        ) : null}
      </p>
    </div>
  );

  const importBlock = (
    <div className="rounded-md border border-dashed border-gray-200 dark:border-slate-800 bg-muted/30 p-3">
      <label className="block text-xs font-medium text-foreground">
        {editingId
          ? "Adicionar contatos via CSV (opcional)"
          : "Importar contatos via CSV (opcional)"}
      </label>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
        className="mt-2 block w-full text-xs"
      />
      <p className="mt-1 text-[11px] text-muted-foreground">
        Colunas aceitas: <code className="font-mono">name</code> (obrigatório),{" "}
        <code className="font-mono">phone_number</code>, <code className="font-mono">email</code>,{" "}
        <code className="font-mono">company</code>, <code className="font-mono">location</code>.
      </p>
      {csvFile && <p className="mt-1 text-[11px] text-primary">Arquivo: {csvFile.name}</p>}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {editingId
          ? "Ao salvar, novos contatos (do CSV e/ou que correspondam ao filtro) serão adicionados à lista. Contatos já presentes não são duplicados."
          : "Sem CSV, a lista usa contatos já cadastrados (com telefone e não bloqueados). Sem filtros, importa todos."}
      </p>

      <div className="mt-3 border-t border-gray-200 dark:border-slate-800 pt-3">
        <ManualAddBlock
          accountId={accountId}
          campaignKind={kind}
          personaFields={selectedPersona?.variable_schema ?? []}
          fieldsLabel={selectedPersona?.name ?? CAMPAIGN_KIND_LABEL[kind]}
          added={manualContacts}
          onAdd={(c) => setManualContacts((prev) => [...prev, c])}
          onRemove={(id) => setManualContacts((prev) => prev.filter((c) => c.id !== id))}
        />
      </div>
    </div>
  );

  const wizardSteps = [
    // Não bloqueia sem agente: conta ainda sem nenhum cadastrado (ou lista que
    // realmente não é de um agente específico) continua criável, só sem o
    // preenchimento automático de campos.
    { title: "Agente", content: agentPickerBlock, canAdvance: true },
    { title: "Identidade", content: identityBlock, canAdvance: name.trim().length > 0 },
    { title: "Público-alvo", content: audienceBlock, canAdvance: true },
    { title: "Importar", content: importBlock, canAdvance: true },
  ];

  return (
    <div className="w-full space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Listas operacionais</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organize contatos por finalidade: SDR, Pós-venda, Cobrança e Retenção.
          </p>
        </div>
        {tab === "lists" && (
          <button
            onClick={() => setCreating((v) => !v)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Nova lista
          </button>
        )}
      </header>

      <div className="flex gap-1 border-b border-gray-200 dark:border-slate-800">
        <TabBtn
          active={tab === "lists"}
          onClick={() => setTab("lists")}
          icon={<Users className="h-3.5 w-3.5" />}
        >
          Listas de contatos
        </TabBtn>
        <TabBtn
          active={tab === "retention"}
          onClick={() => setTab("retention")}
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
        >
          Regras de retenção
        </TabBtn>
        <TabBtn
          active={tab === "compliance"}
          onClick={() => setTab("compliance")}
          icon={<Clock className="h-3.5 w-3.5" />}
        >
          Janelas & LGPD
        </TabBtn>
        <TabBtn
          active={tab === "dnc"}
          onClick={() => setTab("dnc")}
          icon={<Ban className="h-3.5 w-3.5" />}
        >
          DNC / Blocklist
        </TabBtn>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{TAB_CAPTION[tab]}</p>

      {tab === "retention" && <RetentionRulesPanel accountId={accountId} />}
      {tab === "compliance" && <CompliancePanel accountId={accountId} />}
      {tab === "dnc" && <DncPanel accountId={accountId} />}

      {tab === "lists" && (
        <>
          {creating && editingId && (
            <div className="space-y-4 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4">
              <h2 className="text-sm font-semibold">Editar lista</h2>
              {/* Lista sincronizada é sobrescrita pela próxima carga. Sem este
                  aviso, alguém adiciona contatos na mão, some tudo no dia
                  seguinte e o produto parece ter perdido dado. */}
              {rows.find((r) => r.id === editingId)?.external_key && (
                <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:text-amber-300">
                  Esta lista é sincronizada por integração externa. Contatos adicionados
                  aqui na mão saem na próxima carga do sistema de origem — para mudar quem
                  entra nela, mude a consulta que alimenta a integração.
                </p>
              )}
              {agentPickerBlock}
              {identityBlock}
              {audienceBlock}
              {importBlock}

              {loadingDocuments ? (
                <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando itens da lista…
                </div>
              ) : (
                editingDocuments &&
                (editingDocuments.cobranca.length > 0 || editingDocuments.orcamento.length > 0) && (() => {
                  const allItems = [...editingDocuments.cobranca, ...editingDocuments.orcamento];
                  const clients = groupListDocumentsByClient(allItems);
                  return (
                    <div className="space-y-2 border-t border-gray-200 dark:border-slate-800 pt-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Itens desta lista ({allItems.length} em {clients.length} cliente
                        {clients.length === 1 ? "" : "s"})
                      </h3>
                      <div className="max-h-72 overflow-y-auto rounded-md border border-gray-200 dark:border-slate-800 divide-y divide-border">
                        {clients.map((g) => {
                          const expanded = expandedClientId === g.contactId;
                          const total = g.items.reduce((acc, it) => acc + (it.valor ?? 0), 0);
                          return (
                            <div key={g.contactId} className={cn(expanded && "bg-primary/[0.06]")}>
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedClientId((prev) => (prev === g.contactId ? null : g.contactId))
                                }
                                className={cn(
                                  "flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left text-xs hover:bg-muted/40",
                                  expanded ? "border-primary" : "border-transparent",
                                )}
                              >
                                <ChevronDown
                                  className={cn(
                                    "h-3.5 w-3.5 shrink-0 transition-transform",
                                    expanded ? "text-primary" : "-rotate-90 text-muted-foreground",
                                  )}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className={cn("truncate", expanded ? "font-semibold text-foreground" : "font-medium")}>
                                    {g.contactName ?? "Sem nome"}
                                    {g.contactExternalId && (
                                      <span className="ml-1.5 font-normal text-muted-foreground">
                                        · cód. {g.contactExternalId}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-muted-foreground">{g.contactPhone ?? "—"}</div>
                                </div>
                                <span
                                  className={cn(
                                    "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                                    expanded ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                                  )}
                                >
                                  {g.items.length} item{g.items.length === 1 ? "" : "ns"}
                                </span>
                                <span className="shrink-0 tabular-nums font-medium">{BRL(total)}</span>
                              </button>
                              {expanded && (
                                <table className="w-full text-xs">
                                  <thead className="border-y border-border/50 bg-muted/20 text-left uppercase tracking-wider text-muted-foreground">
                                    <tr>
                                      <th className="py-1 pl-10 pr-3 font-medium">Nº</th>
                                      <th className="px-3 py-1 font-medium">Status</th>
                                      <th className="px-3 py-1 text-right font-medium">Valor</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.items.map((d) => (
                                      <tr key={d.id} className="border-b border-border/30 last:border-0">
                                        <td className="py-1.5 pl-10 pr-3 tabular-nums">{d.numero ?? "—"}</td>
                                        <td className="px-3 py-1.5">
                                          {d.status ?? "—"}
                                          {d.diasEmAtraso != null && d.diasEmAtraso > 0 && (
                                            <span className="ml-1 text-amber-600 dark:text-amber-400">
                                              ({d.diasEmAtraso}d atraso)
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-3 py-1.5 text-right tabular-nums">
                                          {d.valor != null ? BRL(d.valor) : "—"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()
              )}

              <div className="flex justify-end gap-2 border-t border-gray-200 dark:border-slate-800 pt-3">
                <button
                  onClick={() => {
                    resetForm();
                    setCreating(false);
                  }}
                  disabled={importing}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={onCreate}
                  disabled={importing || !name.trim()}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Salvar alterações
                </button>
              </div>
            </div>
          )}

          {creating && !editingId && (
            <div className="space-y-4 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4">
              <h2 className="text-sm font-semibold">Criar lista</h2>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                {wizardSteps.map((s, i) => (
                  <div key={s.title} className="flex items-center gap-2">
                    <div
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                        i < step
                          ? "border-primary bg-primary/10 text-primary"
                          : i === step
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-gray-200 dark:border-slate-800 text-muted-foreground",
                      )}
                    >
                      {i < step ? <Check className="h-3 w-3" /> : i + 1}
                    </div>
                    <span
                      className={cn(
                        i === step ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {s.title}
                    </span>
                    {i < wizardSteps.length - 1 && <div className="h-px w-4 bg-border" />}
                  </div>
                ))}
              </div>

              {wizardSteps[step].content}

              <div className="flex items-center justify-between border-t border-gray-200 dark:border-slate-800 pt-3">
                <div>
                  {step > 0 && (
                    <button
                      onClick={() => setStep((s) => s - 1)}
                      className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                    >
                      Voltar
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      resetForm();
                      setCreating(false);
                    }}
                    disabled={importing}
                    className="rounded-md border border-input bg-background px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  {step < wizardSteps.length - 1 ? (
                    <button
                      onClick={() => setStep((s) => s + 1)}
                      disabled={!wizardSteps[step].canAdvance}
                      className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      Avançar
                    </button>
                  ) : (
                    <button
                      onClick={onCreate}
                      disabled={importing || !name.trim()}
                      className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Criar lista
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative max-w-sm flex-1 min-w-[200px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  placeholder="Buscar por nome, agente ou descrição…"
                  className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
                />
              </div>
              <div className="flex gap-1 rounded-md border border-gray-200 dark:border-slate-800 p-0.5">
                {(["all", "aberta", "finalizada"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setListStatusFilter(s)}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                      listStatusFilter === s
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {s === "all" ? "Todas" : s === "aberta" ? "Abertas" : "Finalizadas"}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40">
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
                <Users className="h-6 w-6" />
                <span>Nenhuma lista criada ainda.</span>
                <button
                  onClick={() => setCreating(true)}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Plus className="h-4 w-4" /> Criar sua primeira lista
                </button>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
                <Search className="h-6 w-6" />
                <span>Nenhuma lista com esses filtros.</span>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 dark:border-slate-800 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Nome</th>
                    <th className="px-4 py-2 font-medium">Tipo</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Prontidão</th>
                    <th className="px-4 py-2 font-medium">Criada em</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-gray-200 dark:border-slate-800 last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{r.name}</span>
                          {r.external_key && (
                            <span
                              title={`Sincronizada por integração externa (chave: ${r.external_key}). A próxima carga sobrescreve os membros.`}
                              className="rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 ring-1 ring-inset ring-sky-500/30 dark:text-sky-300"
                            >
                              sincronizada
                            </span>
                          )}
                          {r.variable_keys?.length > 0 && (
                            <span
                              title={`Contatos trazem: ${r.variable_keys.join(", ")}`}
                              className="rounded-md bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-600 ring-1 ring-inset ring-cyan-500/30 dark:text-cyan-300"
                            >
                              {r.variable_keys.length} variáve
                              {r.variable_keys.length === 1 ? "l" : "is"}
                            </span>
                          )}
                        </div>
                        {r.description && (
                          <div className="text-xs text-muted-foreground">{r.description}</div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={cn(
                            "rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                            kindClass(r.campaign_kind),
                          )}
                        >
                          {r.campaign_kind
                            ? (CAMPAIGN_KIND_LABEL[r.campaign_kind as CampaignKind] ??
                              r.campaign_kind)
                            : (r.persona_name ?? "—")}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={cn(
                            "rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                            (r.status ?? "aberta") === "finalizada"
                              ? "bg-muted text-muted-foreground ring-border"
                              : "bg-emerald-500/10 text-emerald-600 ring-emerald-500/30 dark:text-emerald-400",
                          )}
                        >
                          {(r.status ?? "aberta") === "finalizada" ? "Finalizada" : "Aberta"}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="text-sm">
                          <span className="font-medium tabular-nums">{r.valid_phone_count}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            de {r.member_count} prontos
                          </span>
                        </div>
                        {r.member_count > 0 && (
                          <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                r.valid_phone_count >= r.member_count
                                  ? "bg-emerald-500"
                                  : "bg-amber-500",
                              )}
                              style={{
                                width: `${Math.round((r.valid_phone_count / r.member_count) * 100)}%`,
                              }}
                            />
                          </div>
                        )}
                        {r.member_count > 0 && r.valid_phone_count < r.member_count && (
                          <div className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                            {r.member_count - r.valid_phone_count} sem telefone válido
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() =>
                              navigate({
                                to: "/campanhas/nova",
                                search: { listId: r.id } as any,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                          >
                            <Rocket className="h-3 w-3" /> Campanha
                          </button>
                          <button
                            onClick={() => setPickerListId(r.id)}
                            title="Adicionar contatos existentes"
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
                          >
                            <UserPlus className="h-3 w-3" /> Contatos
                          </button>
                          <button
                            onClick={() => toggleFinalize(r)}
                            disabled={finalizingId === r.id}
                            title={(r.status ?? "aberta") === "finalizada" ? "Reabrir lista" : "Finalizar lista"}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                          >
                            {finalizingId === r.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (r.status ?? "aberta") === "finalizada" ? (
                              <RotateCcw className="h-3.5 w-3.5" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            {(r.status ?? "aberta") === "finalizada" ? "Reabrir" : "Finalizar"}
                          </button>
                          <button
                            onClick={() => startEdit(r)}
                            title="Editar lista"
                            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(r)}
                            title="Excluir lista"
                            className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {pickerListId && accountId && (
        <ContactPickerDialog
          accountId={accountId}
          listId={pickerListId}
          onClose={() => setPickerListId(null)}
          onDone={() => {
            setPickerListId(null);
            refresh();
          }}
        />
      )}

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.member_count > 0
                ? `Esta lista tem ${deleteTarget.member_count} contato(s). Os contatos continuam na base, só saem desta lista. Não dá pra desfazer.`
                : "Esta lista está vazia. Não dá pra desfazer."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                onDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function RetentionRulesPanel({ accountId }: { accountId: string | null }) {
  const [rules, setRules] = useState<RetentionRuleRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<RetentionRuleRow> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RetentionRuleRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const newRule = () =>
    setEditing({
      name: "",
      enabled: true,
      inactive_days: 60,
      max_enrolls_per_run: 50,
      required_tag_ids: [],
    });

  const refresh = useCallback(async () => {
    if (!accountId) return;
    try {
      const [r, c] = await Promise.all([fetchRetentionRules(accountId), fetchCampaigns(accountId)]);
      setRules(r);
      setCampaigns(c.filter((x) => x.campaign_kind === "retencao"));
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao carregar regras");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onSave = async () => {
    if (!accountId || !editing?.name?.trim()) {
      toast.error("Informe um nome");
      return;
    }
    try {
      await upsertRetentionRule(accountId, editing as any);
      toast.success("Regra salva");
      setEditing(null);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao salvar");
    }
  };

  const onDelete = async () => {
    if (!accountId || !deleteTarget) return;
    setDeleting(true);
    try {
      await deleteRetentionRule(accountId, deleteTarget.id);
      toast.success(`Regra "${deleteTarget.name}" excluída`);
      setDeleteTarget(null);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao excluir");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4">
        <div className="text-sm text-muted-foreground">
          Regras detectam clientes <strong>inativos</strong> por X dias e os enfileiram
          automaticamente em uma campanha de retenção. Executam diariamente (cron).
        </div>
        <button
          onClick={newRule}
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Nova regra
        </button>
      </div>

      {editing && (
        <div className="space-y-3 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4">
          <h2 className="text-sm font-semibold">
            {editing.id ? "Editar regra" : "Nova regra de retenção"}
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nome">
              <input
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Ex.: Clientes sem contato há 60 dias"
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              />
            </Field>
            <Field label="Dias de inatividade">
              <input
                type="number"
                min={1}
                max={365}
                value={editing.inactive_days ?? 60}
                onChange={(e) => setEditing({ ...editing, inactive_days: Number(e.target.value) })}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              />
            </Field>
            <Field label="Campanha de retenção (destino)">
              <Select
                value={editing.target_campaign_id ?? "__none__"}
                onValueChange={(v) =>
                  setEditing({ ...editing, target_campaign_id: v === "__none__" ? null : v })
                }
              >
                <SelectTrigger className="w-full bg-background text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— selecione —</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Máx. inscritos por execução">
              <input
                type="number"
                min={1}
                max={500}
                value={editing.max_enrolls_per_run ?? 50}
                onChange={(e) =>
                  setEditing({ ...editing, max_enrolls_per_run: Number(e.target.value) })
                }
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              />
            </Field>
            <Field label="Estágio obrigatório no funil (opcional)">
              <StageCombobox
                accountId={accountId}
                value={editing.required_stage_id ?? ""}
                onChange={(stageId) =>
                  setEditing({ ...editing, required_stage_id: stageId || null })
                }
              />
            </Field>
            <Field label="Ativada">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.enabled ?? true}
                  onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                />
                Sim, executar diariamente
              </label>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(null)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={onSave}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Salvar
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
            <ShieldCheck className="h-6 w-6" />
            <span>Nenhuma regra criada. Crie a primeira para reativar clientes inativos.</span>
            <button
              onClick={newRule}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Nova regra
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 dark:border-slate-800 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Regra</th>
                <th className="px-4 py-2 font-medium">Inatividade</th>
                <th className="px-4 py-2 font-medium">Campanha</th>
                <th className="px-4 py-2 font-medium">Última execução</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const camp = campaigns.find((c) => c.id === r.target_campaign_id);
                return (
                  <tr key={r.id} className="border-b border-gray-200 dark:border-slate-800 last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-4 py-2 tabular-nums">{r.inactive_days} dias</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {camp?.name ?? <span className="text-amber-600">— sem destino —</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {r.last_run_at
                        ? `${new Date(r.last_run_at).toLocaleString("pt-BR")} (${r.last_enrolled_count} novos)`
                        : "nunca"}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                          r.enabled
                            ? "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30"
                            : "bg-muted text-muted-foreground ring-border",
                        )}
                      >
                        {r.enabled ? "Ativa" : "Pausada"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setEditing(r)}
                          className="rounded-md p-1 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(r)}
                          className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              A regra para de rodar imediatamente. Clientes já enfileirados em campanhas por ela
              continuam na fila — não dá pra desfazer a exclusão da regra.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                onDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const WEEKDAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Seg" },
  { key: "tue", label: "Ter" },
  { key: "wed", label: "Qua" },
  { key: "thu", label: "Qui" },
  { key: "fri", label: "Sex" },
  { key: "sat", label: "Sáb" },
  { key: "sun", label: "Dom" },
];

function CompliancePanel({ accountId }: { accountId: string | null }) {
  const [policy, setPolicy] = useState<CompliancePolicy>(DEFAULT_COMPLIANCE_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    fetchCompliancePolicy(accountId)
      .then((p) => setPolicy({ ...DEFAULT_COMPLIANCE_POLICY, ...p }))
      .catch((e) => toast.error(e?.message ?? "falha ao carregar"))
      .finally(() => setLoading(false));
  }, [accountId]);

  const setHours = (day: string, value: [number, number] | null) => {
    setPolicy((p) => ({
      ...p,
      allowed_hours_local: { ...(p.allowed_hours_local ?? {}), [day]: value },
    }));
  };

  const onSave = async () => {
    if (!accountId) return;
    setSaving(true);
    try {
      await saveCompliancePolicy(accountId, policy);
      toast.success("Política salva");
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4 text-sm text-muted-foreground">
        Define janelas de discagem por dia da semana, limite de tentativas por contato e disclaimer
        de gravação (LGPD/CDC). Aplicado em todas as campanhas que não sobrescreverem localmente.
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4">
        <h3 className="mb-3 text-sm font-semibold">
          Janelas permitidas (horário local do contato)
        </h3>
        <div className="space-y-2">
          {WEEKDAYS.map((d) => {
            const range = policy.allowed_hours_local?.[d.key] ?? null;
            const enabled = range !== null;
            return (
              <div key={d.key} className="flex items-center gap-3">
                <label className="flex w-24 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setHours(d.key, e.target.checked ? [9, 20] : null)}
                  />
                  <span className="font-medium">{d.label}</span>
                </label>
                {enabled && range ? (
                  <div className="flex items-center gap-2 text-sm">
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={range[0]}
                      onChange={(e) => setHours(d.key, [Number(e.target.value), range[1]])}
                      className="w-16 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums"
                    />
                    <span className="text-muted-foreground">às</span>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={range[1]}
                      onChange={(e) => setHours(d.key, [range[0], Number(e.target.value)])}
                      className="w-16 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums"
                    />
                    <span className="text-muted-foreground">h</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">— sem ligações neste dia</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Máx. tentativas por dia, por contato">
          <input
            type="number"
            min={1}
            max={10}
            value={policy.max_attempts_per_day_per_contact ?? 2}
            onChange={(e) =>
              setPolicy({ ...policy, max_attempts_per_day_per_contact: Number(e.target.value) })
            }
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
        </Field>
        <Field label="Min. minutos entre tentativas">
          <input
            type="number"
            min={5}
            max={1440}
            value={policy.min_minutes_between_attempts ?? 120}
            onChange={(e) =>
              setPolicy({ ...policy, min_minutes_between_attempts: Number(e.target.value) })
            }
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
        </Field>
      </div>

      <Field label="Números de teste (sem restrição de janela/limite/intervalo)">
        <textarea
          rows={2}
          value={(policy.test_numbers ?? []).join("\n")}
          onChange={(e) =>
            setPolicy({
              ...policy,
              test_numbers: e.target.value
                .split(/[\n,]/)
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder={"+5511999999999\n+5511888888888"}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Um número por linha, em E.164. Pula janela de horário, limite diário e intervalo mínimo
          — DNC continua valendo mesmo pra esses números. Use só pra validar campanhas, não pra
          contatos reais.
        </p>
      </Field>

      <Field label="Disclaimer de gravação (LGPD)">
        <textarea
          rows={3}
          value={policy.recording_disclaimer ?? ""}
          onChange={(e) => setPolicy({ ...policy, recording_disclaimer: e.target.value })}
          placeholder="Texto que a IA fala no início para informar gravação"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
      </Field>

      <div className="flex justify-end">
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Salvar política
        </button>
      </div>
    </div>
  );
}

function DncPanel({ accountId }: { accountId: string | null }) {
  const [rows, setRows] = useState<DncEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<DncEntry | null>(null);
  const [removing, setRemoving] = useState(false);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      setRows(await fetchDncList(accountId));
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onAdd = async () => {
    if (!accountId || !phone.trim()) {
      toast.error("Informe o número (formato E.164)");
      return;
    }
    setSaving(true);
    try {
      await addToDnc({
        accountId,
        phoneNumber: phone.trim(),
        reason: reason.trim() || "manual",
        notes: notes.trim() || undefined,
      });
      toast.success("Número adicionado ao DNC");
      setPhone("");
      setReason("");
      setNotes("");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao adicionar");
    } finally {
      setSaving(false);
    }
  };

  const onRemove = async () => {
    if (!accountId || !removeTarget) return;
    setRemoving(true);
    try {
      await removeFromDnc(accountId, removeTarget.id);
      toast.success(`${removeTarget.phone_number} removido do DNC`);
      setRemoveTarget(null);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao remover");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4 text-sm text-muted-foreground">
        Números em DNC nunca recebem ligações automáticas — bloqueio é aplicado no dispatcher antes
        de qualquer chamada.
      </div>

      <div className="space-y-3 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4">
        <h3 className="text-sm font-semibold">Adicionar número</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Telefone (E.164)">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+5511999999999"
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono"
            />
          </Field>
          <Field label="Motivo">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="opt-out, reclamacao, ..."
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label="Notas (opcional)">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <button
            onClick={onAdd}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Ban className="h-6 w-6" />
            Nenhum número bloqueado.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 dark:border-slate-800 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Telefone</th>
                <th className="px-4 py-2 font-medium">Motivo</th>
                <th className="px-4 py-2 font-medium">Notas</th>
                <th className="px-4 py-2 font-medium">Adicionado em</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-200 dark:border-slate-800 last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono">{r.phone_number}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.reason ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.notes ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => setRemoveTarget(r)}
                      className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AlertDialog open={Boolean(removeTarget)} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {removeTarget?.phone_number} do DNC?</AlertDialogTitle>
            <AlertDialogDescription>
              Esse número volta a poder receber ligações automáticas assim que entrar numa lista ou
              campanha.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                onRemove();
              }}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function kindClass(kind: string | null): string {
  switch (kind) {
    case "sdr":
      return "bg-primary/10 text-primary ring-primary/20";
    case "cobranca":
      return "bg-amber-500/15 text-amber-400 ring-amber-500/30";
    case "retencao":
      return "bg-rose-500/15 text-rose-400 ring-rose-500/30";
    case "pos_venda":
      return "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30";
    default:
      return "bg-muted text-muted-foreground ring-border";
  }
}

type PickerContact = {
  id: string;
  name: string | null;
  phone_number: string | null;
  email: string | null;
};

type ManualContact = { id: string; name: string; phone: string | null };

type ContactVariables = {
  name: string | null;
  phone: string | null;
  email: string | null;
  externalId: string | null;
  variables: Record<string, unknown>;
};

/**
 * Contato avulso na etapa "Importar" do assistente: puxar alguém que já está
 * na base ou criar do zero, sem precisar montar um CSV para um único contato.
 * Fica em estado local (`added`) até o passo salvar — igual ao CSV, nada é
 * gravado como membro da lista antes do "Criar lista"/"Salvar alterações".
 */
function ManualAddBlock({
  accountId,
  campaignKind,
  personaFields,
  fieldsLabel,
  added,
  onAdd,
  onRemove,
}: {
  accountId: string | null;
  /** Tipo de operação da lista — usado só como fallback quando o agente não tem campos próprios. */
  campaignKind: string;
  /** Campos cadastrados no agente escolhido (aba Dados da persona) — têm prioridade sobre o catálogo genérico. */
  personaFields: TemplateField[];
  /** Nome exibido no rótulo da seção de campos (nome do agente, ou o tipo genérico sem agente escolhido). */
  fieldsLabel: string;
  added: ManualContact[];
  onAdd: (c: ManualContact) => void;
  onRemove: (id: string) => void;
}) {
  const [mode, setMode] = useState<"search" | "create">("search");

  // Busca
  const [allContacts, setAllContacts] = useState<PickerContact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  // Criação
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [creating, setCreating] = useState(false);

  const addedIds = useMemo(() => new Set(added.map((c) => c.id)), [added]);

  // Dados já conhecidos (variáveis do ingest) de cada contato puxado — buscados
  // sob demanda no momento da seleção, não junto da lista de 2000 (o objetivo
  // aqui é "espiar" o que já se sabe desse contato antes de confirmar, não
  // carregar isso pra todo mundo da busca).
  const [variablesById, setVariablesById] = useState<
    Record<string, { loading: boolean; data?: ContactVariables; error?: string }>
  >({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Campos conhecidos pro tipo de lista (parcela, valor_devedor_saldo…) —
  // formulário estruturado em vez de chave/valor livre, pra quem não é dev não
  // digitar a chave errada e a fala do agente ficar sem a variável.
  const [knownValues, setKnownValues] = useState<Record<string, string>>({});
  // Qualquer variável que o contato já tinha e não está no conjunto conhecido
  // (ex.: veio de uma carga antiga, ou tipo de lista mudou) — continua editável
  // como chave/valor livre, só não é o caminho principal.
  const [extraRows, setExtraRows] = useState<Array<{ key: string; value: string }>>([]);
  const [savingVars, setSavingVars] = useState(false);

  const knownFields = useMemo(
    () => (personaFields.length > 0 ? personaFields : fieldsForCampaignKind(campaignKind)),
    [personaFields, campaignKind],
  );

  const toggleExpanded = (contactId: string) => {
    if (expandedId === contactId) {
      setExpandedId(null);
      return;
    }
    const existing = variablesById[contactId]?.data?.variables ?? {};
    const knownNames = new Set(knownFields.map((f) => f.field));
    const values: Record<string, string> = {};
    for (const f of knownFields) {
      values[f.field] = existing[f.field] != null ? String(existing[f.field]) : "";
    }
    const extra = Object.entries(existing)
      .filter(([k]) => !knownNames.has(k))
      .map(([key, value]) => ({ key, value: String(value) }));
    setKnownValues(values);
    setExtraRows(extra);
    setExpandedId(contactId);
  };

  const saveVariables = async (contactId: string) => {
    if (!accountId) return;
    const fromKnown = Object.fromEntries(
      Object.entries(knownValues)
        .map(([k, v]) => [k, v.trim()] as const)
        .filter(([, v]) => v),
    );
    const fromExtra = Object.fromEntries(
      extraRows
        .map((r) => [r.key.trim(), r.value.trim()] as const)
        .filter(([k, v]) => k && v),
    );
    const variables = { ...fromKnown, ...fromExtra };
    if (Object.keys(variables).length === 0) {
      toast.error("Preencha ao menos um campo");
      return;
    }
    setSavingVars(true);
    try {
      const data = await apiClient.patch<ContactVariables>(
        `/accounts/${accountId}/contacts/${contactId}/variables`,
        { variables },
      );
      setVariablesById((prev) => ({ ...prev, [contactId]: { loading: false, data } }));
      toast.success("Dados salvos no contato");
      setExpandedId(null);
    } catch (e: any) {
      toast.error(e?.body?.message ?? e?.message ?? "Falha ao salvar dados");
    } finally {
      setSavingVars(false);
    }
  };

  const pullVariables = (contactId: string) => {
    if (!accountId) return;
    setVariablesById((prev) => ({ ...prev, [contactId]: { loading: true } }));
    apiClient
      .get<ContactVariables>(`/accounts/${accountId}/contacts/${contactId}/variables`)
      .then((data) =>
        setVariablesById((prev) => ({ ...prev, [contactId]: { loading: false, data } })),
      )
      .catch((e: any) =>
        setVariablesById((prev) => ({
          ...prev,
          [contactId]: { loading: false, error: e?.body?.message ?? e?.message ?? "erro" },
        })),
      );
  };

  const loadContacts = () => {
    if (!accountId || loaded || loading) return;
    setLoading(true);
    apiClient
      .get<PickerContact[]>(`/accounts/${accountId}/contacts?blocked=false&limit=2000`)
      .then((data) => setAllContacts(data ?? []))
      .catch(() => toast.error("Falha ao carregar contatos"))
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  };

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    return allContacts
      .filter((c) => c.phone_number && !addedIds.has(c.id))
      .filter(
        (c) =>
          !term ||
          (c.name ?? "").toLowerCase().includes(term) ||
          (c.phone_number ?? "").toLowerCase().includes(term) ||
          (c.email ?? "").toLowerCase().includes(term),
      )
      .slice(0, 20);
  }, [allContacts, query, addedIds]);

  const pick = (c: PickerContact) => {
    onAdd({ id: c.id, name: c.name ?? c.phone_number ?? "Sem nome", phone: c.phone_number });
    pullVariables(c.id);
    setQuery("");
    setOpen(false);
  };

  const createAndAdd = async () => {
    if (!accountId || !newName.trim()) {
      toast.error("Informe ao menos o nome");
      return;
    }
    setCreating(true);
    try {
      const id = await createManualContact(accountId, {
        name: newName.trim(),
        phone_number: newPhone.trim() || undefined,
        email: newEmail.trim() || undefined,
      });
      onAdd({ id, name: newName.trim(), phone: newPhone.trim() || null });
      setNewName("");
      setNewPhone("");
      setNewEmail("");
      toast.success("Contato criado e adicionado à lista");
    } catch (e: any) {
      toast.error(e?.body?.message ?? e?.message ?? "Falha ao criar contato");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">
          Adicionar contato específico (opcional)
        </span>
        <div className="flex gap-1 rounded-md border border-input bg-background p-0.5">
          <button
            type="button"
            onClick={() => setMode("search")}
            className={cn(
              "rounded px-2 py-0.5 text-[11px]",
              mode === "search"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Puxar existente
          </button>
          <button
            type="button"
            onClick={() => setMode("create")}
            className={cn(
              "rounded px-2 py-0.5 text-[11px]",
              mode === "create"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Criar novo
          </button>
        </div>
      </div>

      {mode === "search" ? (
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setOpen(true);
              loadContacts();
            }}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={loading ? "Carregando contatos…" : "Buscar por nome, telefone ou email…"}
            className="w-full rounded-md border border-input bg-background py-1.5 pl-9 pr-3 text-sm"
          />
          {open && loaded && (
            <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-gray-200 dark:border-slate-800 bg-popover shadow-md">
              {results.length === 0 ? (
                <li className="px-3 py-2 text-xs text-muted-foreground">
                  {query.trim()
                    ? "Nenhum contato com telefone encontrado"
                    : "Digite para buscar entre os contatos já cadastrados"}
                </li>
              ) : (
                results.map((c) => (
                  <li
                    key={c.id}
                    onMouseDown={() => pick(c)}
                    className="cursor-pointer px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    <div className="font-medium">{c.name ?? "Sem nome"}</div>
                    <div className="text-[11px] text-muted-foreground">{c.phone_number}</div>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
          <input
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder="Telefone"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
          <div className="flex gap-2">
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="E-mail (opcional)"
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={createAndAdd}
              disabled={creating || !newName.trim()}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
              Adicionar
            </button>
          </div>
        </div>
      )}

      {added.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {added.map((c) => {
            const v = variablesById[c.id];
            const varCount = v?.data ? Object.keys(v.data.variables ?? {}).length : 0;
            const expanded = expandedId === c.id;
            return (
              <li key={c.id}>
                <div className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-slate-800 bg-muted/50 py-1 pl-2.5 pr-1.5 text-[11px]">
                  <span className="font-medium">{c.name}</span>
                  {c.phone && <span className="text-muted-foreground">{c.phone}</span>}
                  {v?.loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                  {!v?.loading && v?.data && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(c.id)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                        varCount > 0
                          ? "bg-primary/10 text-primary hover:bg-primary/20"
                          : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20",
                      )}
                      title={
                        varCount > 0
                          ? "Ver/editar dados já conhecidos deste contato"
                          : "Nenhum dado ainda — clique para inserir manualmente"
                      }
                    >
                      <DatabaseZap className="h-3 w-3" />
                      {varCount > 0 ? `${varCount} dado${varCount > 1 ? "s" : ""}` : "sem dados — inserir"}
                      <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
                    </button>
                  )}
                  {!v?.loading && v?.error && (
                    <span className="text-[10px] text-rose-400" title={v.error}>
                      falha ao buscar dados
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemove(c.id)}
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                    aria-label={`Remover ${c.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                {expanded && (
                  <div className="mt-1.5 max-w-md space-y-3 rounded-md border border-gray-200 dark:border-slate-800 bg-muted/30 p-2.5">
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Campos de {fieldsLabel}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        Preencha o que souber — em branco, o agente simplesmente não menciona.
                      </p>
                      <div className="mt-1.5 space-y-1.5">
                        {knownFields.map((f) => (
                          <div key={f.field}>
                            <label className="block text-[10px] text-foreground">
                              {f.desc || f.field}{" "}
                              <code className="text-muted-foreground">({f.field})</code>
                            </label>
                            <input
                              value={knownValues[f.field] ?? ""}
                              onChange={(e) =>
                                setKnownValues((prev) => ({ ...prev, [f.field]: e.target.value }))
                              }
                              placeholder={f.example != null ? String(f.example) : ""}
                              className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-[11px]"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Campos extras (fora do padrão de {fieldsLabel})
                      </p>
                      <div className="mt-1.5 space-y-1.5">
                        {extraRows.map((row, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <input
                              value={row.key}
                              onChange={(e) =>
                                setExtraRows((prev) =>
                                  prev.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)),
                                )
                              }
                              placeholder="chave"
                              className="w-32 shrink-0 rounded-md border border-input bg-background px-2 py-1 font-mono text-[11px]"
                            />
                            <span className="shrink-0 text-[11px] text-muted-foreground">=</span>
                            <input
                              value={row.value}
                              onChange={(e) =>
                                setExtraRows((prev) =>
                                  prev.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)),
                                )
                              }
                              placeholder="valor"
                              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-[11px]"
                            />
                            <button
                              type="button"
                              onClick={() => setExtraRows((prev) => prev.filter((_, j) => j !== i))}
                              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                              aria-label="Remover linha"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setExtraRows((prev) => [...prev, { key: "", value: "" }])}
                          className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-[10px] font-medium hover:bg-muted"
                        >
                          <Plus className="h-3 w-3" /> Campo extra
                        </button>
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => void saveVariables(c.id)}
                        disabled={savingVars}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {savingVars && <Loader2 className="h-3 w-3 animate-spin" />}
                        Salvar dados
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ContactPickerDialog({
  accountId,
  listId,
  onClose,
  onDone,
}: {
  accountId: string;
  listId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [contacts, setContacts] = useState<PickerContact[]>([]);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [onlyWithPhone, setOnlyWithPhone] = useState(true);
  const [hideExisting, setHideExisting] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [{ data: cdata, error: cerr }, { data: mdata }] = await Promise.all([
          apiClient
            .get<
              Array<{
                id: string;
                name: string | null;
                phone_number: string | null;
                email: string | null;
              }>
            >(`/accounts/${accountId}/contacts?blocked=false&limit=2000`)
            .then((data) => ({ data, error: null })),
          apiClient
            .get<
              Array<{ contact_id: string }>
            >(`/accounts/${accountId}/contact-lists/${listId}/members`)
            .then((data) => ({ data, error: null })),
        ]);
        if (cerr) throw cerr;
        setContacts(cdata ?? []);
        setExisting(new Set((mdata ?? []).map((r) => r.contact_id)));
      } catch (e: any) {
        toast.error(e?.message ?? "Falha ao carregar contatos");
      } finally {
        setLoading(false);
      }
    })();
  }, [accountId, listId]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return contacts.filter((c) => {
      if (onlyWithPhone && !c.phone_number) return false;
      if (hideExisting && existing.has(c.id)) return false;
      if (!term) return true;
      return (
        (c.name ?? "").toLowerCase().includes(term) ||
        (c.phone_number ?? "").toLowerCase().includes(term) ||
        (c.email ?? "").toLowerCase().includes(term)
      );
    });
  }, [contacts, q, existing, onlyWithPhone, hideExisting]);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setPicked(new Set([...picked, ...filtered.map((c) => c.id)]));
  };

  const save = async () => {
    if (picked.size === 0) {
      toast.error("Selecione ao menos um contato");
      return;
    }
    setSaving(true);
    try {
      const rows = Array.from(picked).map((cid) => ({
        list_id: listId,
        contact_id: cid,
        account_id: accountId,
      }));
      const res = await apiClient.post<{ inserted: number }>(
        `/accounts/${accountId}/contact-lists/${listId}/members`,
        { contactIds: Array.from(picked) },
      );
      toast.success(`${res.inserted ?? picked.size} contato(s) adicionado(s) à lista`);
      onDone();
    } catch (e: any) {
      toast.error(e?.body?.message ?? "Falha ao adicionar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 shadow-xl"
        style={{ maxHeight: "85vh" }}
      >
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Adicionar contatos existentes à lista</h2>
            <p className="text-xs text-muted-foreground">
              {contacts.length} contatos na base · {existing.size} já na lista
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2 border-b border-gray-200 dark:border-slate-800 px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar nome, telefone ou email…"
              className="w-full rounded-md border border-input bg-background py-1.5 pl-9 pr-3 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={onlyWithPhone}
                onChange={(e) => setOnlyWithPhone(e.target.checked)}
              />
              Somente com telefone
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={hideExisting}
                onChange={(e) => setHideExisting(e.target.checked)}
              />
              Ocultar já presentes
            </label>
            <button
              onClick={selectAllVisible}
              className="ml-auto rounded-md border border-input px-2 py-1 hover:bg-muted"
            >
              Selecionar visíveis ({filtered.length})
            </button>
            {picked.size > 0 && (
              <button
                onClick={() => setPicked(new Set())}
                className="rounded-md border border-input px-2 py-1 hover:bg-muted"
              >
                Limpar ({picked.size})
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              Nenhum contato encontrado.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.slice(0, 500).map((c) => {
                const isExisting = existing.has(c.id);
                const isPicked = picked.has(c.id);
                return (
                  <li
                    key={c.id}
                    onClick={() => !isExisting && toggle(c.id)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-muted/40",
                      isExisting && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isPicked || isExisting}
                      disabled={isExisting}
                      onChange={() => toggle(c.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{c.name ?? "(sem nome)"}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {c.phone_number ?? "—"}
                        {c.email ? ` · ${c.email}` : ""}
                      </div>
                    </div>
                    {isExisting && (
                      <span className="text-[10px] uppercase text-muted-foreground">
                        já na lista
                      </span>
                    )}
                  </li>
                );
              })}
              {filtered.length > 500 && (
                <li className="px-4 py-2 text-center text-xs text-muted-foreground">
                  Mostrando 500 de {filtered.length}. Refine a busca para ver mais.
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 dark:border-slate-800 px-4 py-3">
          <span className="text-xs text-muted-foreground">{picked.size} selecionado(s)</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={saving || picked.size === 0}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Adicionar à lista
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
