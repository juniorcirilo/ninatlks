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
} from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/lib/account-context";
import {
  fetchContactLists,
  fetchRetentionRules,
  upsertRetentionRule,
  deleteRetentionRule,
  fetchCampaigns,
  CAMPAIGN_KIND_LABEL,
  type ContactListRow,
  type CampaignKind,
  type RetentionRuleRow,
  type CampaignRow,
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
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

function parseCsv(csv: string): Array<{ name?: string | null; phoneNumber?: string | null; email?: string | null }> {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const nameIdx = headers.findIndex((h) => h === "name");
  const phoneIdx = headers.findIndex((h) => h === "phone_number" || h === "phone");
  const emailIdx = headers.findIndex((h) => h === "email");
  const rows: Array<{ name?: string | null; phoneNumber?: string | null; email?: string | null }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    rows.push({
      name: nameIdx >= 0 ? cols[nameIdx]?.trim() || null : null,
      phoneNumber: phoneIdx >= 0 ? cols[phoneIdx]?.trim() || null : null,
      email: emailIdx >= 0 ? cols[emailIdx]?.trim() || null : null,
    });
  }
  return rows;
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
  const [description, setDescription] = useState("");
  const [filterStage, setFilterStage] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickerListId, setPickerListId] = useState<string | null>(null);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const resetForm = () => {
    setName("");
    setDescription("");
    setKind("sdr");
    setFilterStage("");
    setFilterTag("");
    setCsvFile(null);
    setEditingId(null);
  };

  const startEdit = (r: ContactListRow) => {
    setEditingId(r.id);
    setName(r.name);
    setDescription(r.description ?? "");
    setKind((r.campaign_kind as CampaignKind) ?? "sdr");
    const f = (r.filters ?? {}) as Record<string, unknown>;
    setFilterStage(typeof f.stage_id === "string" ? f.stage_id : "");
    setFilterTag(typeof f.tag === "string" ? f.tag : "");
    setCsvFile(null);
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

  useEffect(() => {
    refresh();
  }, [refresh]);

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
          filters,
        });

        // 1. Optional CSV import (creates new contacts in the account)
        if (csvFile) {
          const csv = await csvFile.text();
          const importRes = await apiClient.post<{ imported: number }>(
            `/accounts/${accountId}/contacts/import`,
            { rows: parseCsv(csv) },
          );
          if (importRes.imported > 0) toast.success(`${importRes.imported} contatos importados do CSV`);
        }

        // 2. Append matching contacts to the list (only the ones not already members)
        const contactsData = await apiClient.get<Array<{ id: string }>>(
          `/accounts/${accountId}/contacts?blocked=false&limit=5000${stageValid ? `&stageId=${filterStage.trim()}` : ""}`,
        );
        const contacts = contactsData ?? [];

        if (contacts.length > 0) {
          const existingData = await apiClient.get<Array<{ contact_id: string }>>(
            `/accounts/${accountId}/contact-lists/${editingId}/members`,
          );
          const have = new Set((existingData ?? []).map((r) => r.contact_id));
          const toAdd = contacts
            .filter((c) => !have.has(c.id))
            .map((c) => c.id);
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
        const importRes = await apiClient.post<{ imported: number }>(
          `/accounts/${accountId}/contacts/import`,
          { rows: parseCsv(csv) },
        );
        if (importRes.imported > 0) toast.success(`${importRes.imported} contatos importados do CSV`);
      }

      // Build initial members based on filters
      const contactsData = await apiClient.get<Array<{ id: string }>>(
        `/accounts/${accountId}/contacts?blocked=false&limit=5000${stageValid ? `&stageId=${filterStage.trim()}` : ""}`,
      );
      const contacts = contactsData ?? [];

      const list = await apiClient.post<{ id: string }>(`/accounts/${accountId}/contact-lists`, {
        name: name.trim(),
        contactIds: contacts.map((c) => c.id),
      });

      if (contacts.length > 0) {
        toast.success(`Lista criada com ${contacts.length} contatos`);
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

  const onDelete = async (id: string) => {
    if (!confirm("Excluir esta lista?")) return;
    try {
      await apiClient.delete(`/accounts/${accountId}/contact-lists/${id}`);
      toast.success("Lista excluída");
      refresh();
    } catch (e: any) {
      toast.error(e?.body?.message ?? "Falha ao excluir");
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
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

      <div className="flex gap-1 border-b border-border">
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

      {tab === "retention" && <RetentionRulesPanel accountId={accountId} />}
      {tab === "compliance" && <CompliancePanel accountId={accountId} />}
      {tab === "dnc" && <DncPanel accountId={accountId} />}

      {tab === "lists" && (
        <>
          {creating && (
            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">
                {editingId ? "Editar lista" : "Criar lista"}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Nome">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex.: Leads quentes — Outubro"
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Tipo de operação">
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as CampaignKind)}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  >
                    {(Object.keys(CAMPAIGN_KIND_LABEL) as CampaignKind[]).map((k) => (
                      <option key={k} value={k}>
                        {CAMPAIGN_KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Descrição">
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Opcional"
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Filtro: stage_id (opcional)">
                  <input
                    value={filterStage}
                    onChange={(e) => setFilterStage(e.target.value)}
                    placeholder="UUID do stage do pipeline"
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono text-xs"
                  />
                </Field>
              </div>
              <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
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
                  <code className="font-mono">phone_number</code>,{" "}
                  <code className="font-mono">email</code>,{" "}
                  <code className="font-mono">company</code>,{" "}
                  <code className="font-mono">location</code>.
                </p>
                {csvFile && (
                  <p className="mt-1 text-[11px] text-primary">Arquivo: {csvFile.name}</p>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {editingId
                  ? "Ao salvar, novos contatos (do CSV e/ou que correspondam ao filtro) serão adicionados à lista. Contatos já presentes não são duplicados."
                  : "Sem CSV, a lista usa contatos já cadastrados (com telefone e não bloqueados). Sem filtros, importa todos."}
              </p>
              <div className="flex justify-end gap-2">
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
                  disabled={importing}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {editingId ? "Salvar alterações" : "Criar lista"}
                </button>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card">
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Users className="h-6 w-6" />
                Nenhuma lista criada ainda.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Nome</th>
                    <th className="px-4 py-2 font-medium">Tipo</th>
                    <th className="px-4 py-2 font-medium">Contatos</th>
                    <th className="px-4 py-2 font-medium">Criada em</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-4 py-2">
                        <div className="font-medium">{r.name}</div>
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
                            : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2 tabular-nums">{r.member_count}</td>
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
                            onClick={() => startEdit(r)}
                            title="Editar lista"
                            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => onDelete(r.id)}
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

  const onDelete = async (id: string) => {
    if (!accountId) return;
    if (!confirm("Excluir esta regra?")) return;
    try {
      await deleteRetentionRule(accountId, id);
      toast.success("Regra excluída");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao excluir");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4">
        <div className="text-sm text-muted-foreground">
          Regras detectam clientes <strong>inativos</strong> por X dias e os enfileiram
          automaticamente em uma campanha de retenção. Executam diariamente (cron).
        </div>
        <button
          onClick={() =>
            setEditing({
              name: "",
              enabled: true,
              inactive_days: 60,
              max_enrolls_per_run: 50,
              required_tag_ids: [],
            })
          }
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Nova regra
        </button>
      </div>

      {editing && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
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
              <select
                value={editing.target_campaign_id ?? ""}
                onChange={(e) =>
                  setEditing({ ...editing, target_campaign_id: e.target.value || null })
                }
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              >
                <option value="">— selecione —</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
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
            <Field label="Stage obrigatório (UUID, opcional)">
              <input
                value={editing.required_stage_id ?? ""}
                onChange={(e) =>
                  setEditing({ ...editing, required_stage_id: e.target.value || null })
                }
                placeholder="UUID do stage"
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono text-xs"
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

      <div className="rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <ShieldCheck className="h-6 w-6" />
            Nenhuma regra criada. Crie a primeira para reativar clientes inativos.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
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
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
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
                          onClick={() => onDelete(r.id)}
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
      <div className="flex h-40 items-center justify-center rounded-xl border border-border bg-card">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Define janelas de discagem por dia da semana, limite de tentativas por contato e disclaimer
        de gravação (LGPD/CDC). Aplicado em todas as campanhas que não sobrescreverem localmente.
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
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

  const onRemove = async (id: number) => {
    if (!accountId) return;
    if (!confirm("Remover este número do DNC?")) return;
    try {
      await removeFromDnc(accountId, id);
      toast.success("Removido");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao remover");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Números em DNC nunca recebem ligações automáticas — bloqueio é aplicado no dispatcher antes
        de qualquer chamada.
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
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

      <div className="rounded-xl border border-border bg-card">
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
            <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
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
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono">{r.phone_number}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.reason ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.notes ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => onRemove(r.id)}
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
          apiClient.get<Array<{ id: string; name: string | null; phone_number: string | null; email: string | null }>>(
            `/accounts/${accountId}/contacts?blocked=false&limit=2000`,
          ).then((data) => ({ data, error: null })),
          apiClient.get<Array<{ contact_id: string }>>(
            `/accounts/${accountId}/contact-lists/${listId}/members`,
          ).then((data) => ({ data, error: null })),
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
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        style={{ maxHeight: "85vh" }}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
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

        <div className="space-y-2 border-b border-border px-4 py-3">
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

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
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
