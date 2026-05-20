import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Users, Trash2, Rocket, ShieldCheck, Pencil } from "lucide-react";
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
  const [tab, setTab] = useState<"lists" | "retention">("lists");
  const [rows, setRows] = useState<ContactListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // form
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CampaignKind>("sdr");
  const [description, setDescription] = useState("");
  const [filterStage, setFilterStage] = useState("");
  const [filterTag, setFilterTag] = useState("");

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
      const filters: Record<string, unknown> = {};
      if (filterStage.trim()) filters.stage_id = filterStage.trim();
      if (filterTag.trim()) filters.tag = filterTag.trim();

      // Build initial members based on filters
      let contactsQuery = (supabase as any)
        .from("contacts")
        .select("id")
        .eq("account_id", accountId)
        .not("phone_number", "is", null)
        .eq("blocked", false)
        .limit(5000);
      if (filterStage.trim()) contactsQuery = contactsQuery.eq("stage_id", filterStage.trim());

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
      }

      toast.success("Lista criada");
      setName("");
      setDescription("");
      setFilterStage("");
      setFilterTag("");
      setCreating(false);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao criar lista");
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
      </div>

      {tab === "retention" && <RetentionRulesPanel accountId={accountId} />}

      {tab === "lists" && (
        <>
          {creating && (
            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">Criar lista</h2>
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
              <p className="text-[11px] text-muted-foreground">
                Os contatos com telefone e não bloqueados serão adicionados automaticamente. Sem filtros, importa todos.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setCreating(false)}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={onCreate}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Criar lista
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
                            onClick={() => onDelete(r.id)}
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
