import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Users, Trash2, Rocket, ShieldCheck, Pencil, Clock, Ban, UserPlus, Search } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/lib/account-context";
import { supabase } from "@/integrations/supabase/client";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/listas")({
  head: () => ({
    meta: [
      { title: "Listas operacionais — Nina Talks" },
      { name: "description", content: "Listas de contatos para campanhas SDR, Cobrança, Pós-venda e Retenção." },
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
        const { error: uerr } = await (supabase as any)
          .from("contact_lists")
          .update({
            name: name.trim(),
            description: description.trim() || null,
            campaign_kind: kind,
            filters,
          })
          .eq("id", editingId);
        if (uerr) throw uerr;

        // 1. Optional CSV import (creates new contacts in the account)
        if (csvFile) {
          const csv = await csvFile.text();
          const { data: importRes, error: importErr } = await (supabase as any).functions.invoke(
            "contacts-import-csv",
            { body: { csv } },
          );
          if (importErr) throw new Error(importErr.message ?? "falha ao importar CSV");
          const imported = importRes?.imported ?? 0;
          if (imported > 0) toast.success(`${imported} contatos importados do CSV`);
        }

        // 2. Append matching contacts to the list (only the ones not already members)
        let cq = (supabase as any)
          .from("contacts")
          .select("id")
          .eq("account_id", accountId)
          .not("phone_number", "is", null)
          .eq("blocked", false)
          .limit(5000);
        if (stageValid) cq = cq.eq("stage_id", filterStage.trim());
        const { data: cdata, error: cerr } = await cq;
        if (cerr) throw cerr;

        if (cdata && cdata.length > 0) {
          const { data: existing } = await (supabase as any)
            .from("contact_list_members")
            .select("contact_id")
            .eq("list_id", editingId);
          const have = new Set((existing ?? []).map((r: any) => r.contact_id));
          const toAdd = cdata
            .filter((c: any) => !have.has(c.id))
            .map((c: any) => ({ list_id: editingId, contact_id: c.id, account_id: accountId }));
          if (toAdd.length > 0) {
            const { error: ierr } = await (supabase as any)
              .from("contact_list_members")
              .insert(toAdd);
            if (ierr) throw ierr;
            const newCount = have.size + toAdd.length;
            await (supabase as any)
              .from("contact_lists")
              .update({ member_count: newCount })
              .eq("id", editingId);
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
        const { data: importRes, error: importErr } = await (supabase as any).functions.invoke(
          "contacts-import-csv",
          { body: { csv } },
        );
        if (importErr) throw new Error(importErr.message ?? "falha ao importar CSV");
        const imported = importRes?.imported ?? 0;
        if (imported > 0) toast.success(`${imported} contatos importados do CSV`);
      }

      // Build initial members based on filters
      let contactsQuery = (supabase as any)
        .from("contacts")
        .select("id")
        .eq("account_id", accountId)
        .not("phone_number", "is", null)
        .eq("blocked", false)
        .limit(5000);
      if (stageValid) contactsQuery = contactsQuery.eq("stage_id", filterStage.trim());

      const { data: cdata, error: cerr } = await contactsQuery;
      if (cerr) throw cerr;

      const { data: list, error } = await (supabase as any)
        .from("contact_lists")
        .insert({
          account_id: accountId,
          name: name.trim(),
          description: description.trim() || null,
          campaign_kind: kind,
          filters,
          is_dynamic: false,
          member_count: cdata?.length ?? 0,
        })
        .select()
        .single();
      if (error) throw error;

      if (cdata && cdata.length > 0) {
        const members = cdata.map((c: any) => ({
          list_id: list.id,
          contact_id: c.id,
          account_id: accountId,
        }));
        await (supabase as any).from("contact_list_members").insert(members);
        toast.success(`Lista criada com ${cdata.length} contatos`);
      } else {
        toast.warning("Lista criada, mas sem contatos. Importe um CSV ou adicione contatos em /contacts.");
      }

      resetForm();
      setCreating(false);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao salvar lista");
    } finally {
      setImporting(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm("Excluir esta lista?")) return;
    const { error } = await (supabase as any).from("contact_lists").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Lista excluída");
    refresh();
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
        <TabBtn active={tab === "lists"} onClick={() => setTab("lists")} icon={<Users className="h-3.5 w-3.5" />}>
          Listas de contatos
        </TabBtn>
        <TabBtn active={tab === "retention"} onClick={() => setTab("retention")} icon={<ShieldCheck className="h-3.5 w-3.5" />}>
          Regras de retenção
        </TabBtn>
        <TabBtn active={tab === "compliance"} onClick={() => setTab("compliance")} icon={<Clock className="h-3.5 w-3.5" />}>
          Janelas & LGPD
        </TabBtn>
        <TabBtn active={tab === "dnc"} onClick={() => setTab("dnc")} icon={<Ban className="h-3.5 w-3.5" />}>
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
              <h2 className="text-sm font-semibold">{editingId ? "Editar lista" : "Criar lista"}</h2>
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
                  {editingId ? "Adicionar contatos via CSV (opcional)" : "Importar contatos via CSV (opcional)"}
                </label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
                  className="mt-2 block w-full text-xs"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Colunas aceitas: <code className="font-mono">name</code> (obrigatório), <code className="font-mono">phone_number</code>, <code className="font-mono">email</code>, <code className="font-mono">company</code>, <code className="font-mono">location</code>.
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
                    <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
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
                          {r.campaign_kind ? CAMPAIGN_KIND_LABEL[r.campaign_kind as CampaignKind] ?? r.campaign_kind : "—"}
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
      const [r, c] = await Promise.all([
        fetchRetentionRules(accountId),
        fetchCampaigns(accountId),
      ]);
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
    if (!confirm("Excluir esta regra?")) return;
    try {
      await deleteRetentionRule(id);
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
          Regras detectam clientes <strong>inativos</strong> por X dias e os enfileiram automaticamente em uma campanha de retenção. Executam diariamente (cron).
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
          <h2 className="text-sm font-semibold">{editing.id ? "Editar regra" : "Nova regra de retenção"}</h2>
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
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
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
        Define janelas de discagem por dia da semana, limite de tentativas por contato e disclaimer de gravação (LGPD/CDC). Aplicado em todas as campanhas que não sobrescreverem localmente.
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Janelas permitidas (horário local do contato)</h3>
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
    if (!confirm("Remover este número do DNC?")) return;
    try {
      await removeFromDnc(id);
      toast.success("Removido");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao remover");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Números em DNC nunca recebem ligações automáticas — bloqueio é aplicado no dispatcher antes de qualquer chamada.
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
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "retencao":
      return "bg-rose-50 text-rose-700 ring-rose-200";
    case "pos_venda":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    default:
      return "bg-muted text-muted-foreground ring-border";
  }
}
