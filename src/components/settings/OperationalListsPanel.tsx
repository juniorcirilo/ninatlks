import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/lib/account-context";
import {
  OPERATIONAL_LIST_ENDPOINT,
  buildOperationalListTemplate,
  downloadJson,
} from "@/lib/webhook-inbound-templates";
import {
  fetchAgentSources,
  runAgentSource,
  type AgentSource,
} from "@/lib/agent-sources";
import {
  CAMPAIGN_KIND_OPTIONS,
  createOperationalList,
  deleteOperationalList,
  fetchOperationalLists,
  slugifyKey,
  updateOperationalList,
  type OperationalList,
} from "@/lib/operational-lists";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type DialogState = { mode: "create" } | { mode: "edit"; list: OperationalList } | null;

/**
 * Cadastro das listas operacionais que o recebimento alimenta.
 *
 * Existir *antes* da primeira carga é o ponto: a lista criada sozinha pelo
 * webhook nasce com nome e tipo derivados do agente, e a campanha só pode
 * apontar para ela depois que o primeiro contato chega. Criando aqui, o
 * operador já configura tudo, aponta a campanha e a carga cai no lugar certo.
 */
export function OperationalListsPanel() {
  const { accountId } = useAccount();
  const [lists, setLists] = useState<OperationalList[]>([]);
  const [sources, setSources] = useState<AgentSource[]>([]);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // Carga que substitui x carga que acrescenta: é a escolha que muda o payload,
  // e errar nela é apagar a lista sem querer.
  const [replace, setReplace] = useState<Record<string, boolean>>({});

  const load = async () => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [rows, srcs] = await Promise.all([
        fetchOperationalLists(accountId),
        // Fonte é coisa de admin; sem ela a tela ainda lista e edita.
        fetchAgentSources(accountId).catch(() => [] as AgentSource[]),
      ]);
      setLists(rows);
      setSources(srcs);
    } catch (e: any) {
      toast.error(e?.body?.message ?? "Não foi possível carregar as listas");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Sincroniza a lista puxando da fonte do agente que a alimenta.
   *
   * Só aparece com a fonte já testada com sucesso: sincronizar contra uma
   * configuração que nunca funcionou só produziria erro na cara do operador,
   * e o lugar de descobrir isso é a tela de configuração, com o retorno da
   * busca à vista.
   *
   * Duplicação está barrada em dois níveis: o botão desabilita enquanto roda, e
   * o servidor recusa (409) se a mesma fonte já estiver sincronizando — o
   * poller automático dispara no mesmo intervalo e pode pegar a fonte junto.
   * Contato repetido, por fim, não duplica porque o upsert é pelo telefone.
   */
  const sync = async (list: OperationalList, source: AgentSource) => {
    if (!accountId) return;
    setSyncingId(source.id);
    try {
      const result = await runAgentSource(accountId, source.id);
      if (result.ok) {
        toast.success(
          `${list.name}: ${result.processed} contato(s) — ${result.created} novo(s), ${result.updated} atualizado(s).`,
        );
      } else {
        toast.error(result.error ?? "A sincronização falhou");
      }
      await load();
    } catch (e: any) {
      toast.error(e?.body?.message ?? "Não foi possível sincronizar");
    } finally {
      setSyncingId(null);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      toast.success("Copiado");
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const remove = async (list: OperationalList) => {
    if (!accountId) return;
    if (
      !confirm(
        `Excluir a lista "${list.name}"? Os ${list.memberCount} contato(s) continuam na base, mas a campanha que aponta para ela perde a origem.`,
      )
    )
      return;
    setBusyId(list.id);
    try {
      await deleteOperationalList(accountId, list.id);
      setLists((prev) => prev.filter((l) => l.id !== list.id));
      toast.success("Lista excluída.");
    } catch (e: any) {
      toast.error(e?.body?.message ?? "Não foi possível excluir a lista");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          Crie a lista antes da primeira carga para já apontar a campanha de voz para ela.
        </p>
        <button
          type="button"
          onClick={() => setDialog({ mode: "create" })}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3 w-3" /> Nova lista
        </button>
      </div>

      {lists.length === 0 ? (
        <div className="rounded-lg border border-dashed border-foreground/[0.08] bg-foreground/[0.02] py-10 text-center text-[12px] text-muted-foreground">
          Nenhuma lista operacional ainda.
        </div>
      ) : (
        <ul className="space-y-2">
          {lists.map((list) => {
            const kind = CAMPAIGN_KIND_OPTIONS.find((k) => k.value === list.campaignKind);
            const expanded = open === list.id;
            const replaceMembers = replace[list.id] === true;
            // A fonte só serve para esta lista se o destino dela for esta
            // chave — sem isso o botão sincronizaria a lista errada.
            const matching = list.externalKey
              ? sources.filter(
                  (s) => s.active && s.effective_list_key === list.externalKey,
                )
              : [];
            // Havendo mais de uma, a testada ganha: pegar a primeira esconderia
            // o botão só porque existe uma fonte rascunho apontando para a
            // mesma lista.
            const source =
              matching.find((s) => s.last_status === "ok") ?? matching[0] ?? null;
            const canSync = !!source && source.last_status === "ok";
            const tpl = list.externalKey
              ? buildOperationalListTemplate(
                  {
                    name: list.name,
                    externalKey: list.externalKey,
                    campaignKind: list.campaignKind,
                  },
                  { replaceMembers },
                )
              : null;
            return (
              <li
                key={list.id}
                className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12px] font-semibold">{list.name}</span>
                        {kind && (
                          <span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[9px] font-medium uppercase text-muted-foreground">
                            {kind.label}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {list.memberCount} contato(s)
                        </span>
                      </div>
                      {list.description && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {list.description}
                        </p>
                      )}
                      {list.externalKey ? (
                        <div className="mt-1 flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground">listKey:</span>
                          <code className="break-all font-mono text-[10px] text-foreground">
                            {list.externalKey}
                          </code>
                          <button
                            type="button"
                            onClick={() => copy(list.externalKey!, list.id)}
                            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                            aria-label="Copiar listKey"
                          >
                            {copied === list.id ? (
                              <Check className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <p className="mt-1 text-[10px] text-amber-300">
                          Sem chave de recebimento: o webhook não consegue apontar para esta
                          lista.
                        </p>
                      )}
                      {source && !canSync && (
                        <p className="mt-1 text-[10px] text-amber-300">
                          Fonte "{source.name}" configurada mas ainda não testada com
                          sucesso — teste em Templates por agente para liberar o
                          Sincronizar.
                        </p>
                      )}
                      {source && canSync && source.last_run_at && (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Última sincronização:{" "}
                          {new Date(source.last_run_at).toLocaleString("pt-BR")} ·{" "}
                          {source.last_count ?? 0} contato(s)
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canSync && (
                      <button
                        type="button"
                        onClick={() => void sync(list, source!)}
                        disabled={syncingId === source!.id || source!.running}
                        title={`Buscar em ${source!.url}`}
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        <RefreshCw
                          className={cn(
                            "h-3 w-3",
                            (syncingId === source!.id || source!.running) && "animate-spin",
                          )}
                        />
                        {syncingId === source!.id || source!.running
                          ? "Sincronizando…"
                          : "Sincronizar"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDialog({ mode: "edit", list })}
                      className="rounded-md border border-foreground/[0.08] bg-foreground/[0.04] px-2.5 py-1 text-[11px] font-medium hover:bg-foreground/[0.08]"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(list)}
                      disabled={busyId === list.id}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                      aria-label="Excluir lista"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {tpl && (
                  <>
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : list.id)}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDown
                        className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")}
                      />
                      {expanded ? "Ocultar exemplos" : "Payload e cURL de carga"}
                    </button>

                    {expanded && (
                      <div className="mt-2 space-y-2 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-3">
                        <p className="break-all font-mono text-[10px] text-muted-foreground">
                          POST {OPERATIONAL_LIST_ENDPOINT}
                        </p>

                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-0.5 rounded-md border border-foreground/[0.08] bg-foreground/[0.02] p-0.5">
                            {[
                              { value: false, label: "Acrescenta" },
                              { value: true, label: "Substitui" },
                            ].map((opt) => (
                              <button
                                key={opt.label}
                                type="button"
                                onClick={() =>
                                  setReplace((r) => ({ ...r, [list.id]: opt.value }))
                                }
                                className={cn(
                                  "rounded px-2 py-0.5 text-[10px] font-medium",
                                  replaceMembers === opt.value
                                    ? "bg-foreground/[0.10] text-foreground"
                                    : "text-muted-foreground hover:text-foreground",
                                )}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => downloadJson(tpl.fileName, tpl.template)}
                            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                          >
                            <Download className="h-3 w-3" /> Baixar JSON
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              copy(JSON.stringify(tpl.payload, null, 2), `payload-${list.id}`)
                            }
                            className="rounded-md border border-foreground/[0.08] bg-foreground/[0.04] px-2.5 py-1 text-[11px] font-medium hover:bg-foreground/[0.08]"
                          >
                            {copied === `payload-${list.id}` ? "Copiado" : "Copiar payload"}
                          </button>
                          <button
                            type="button"
                            onClick={() => copy(tpl.curl, `curl-${list.id}`)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-foreground/[0.08] bg-foreground/[0.04] px-2.5 py-1 text-[11px] font-medium hover:bg-foreground/[0.08]"
                          >
                            <Terminal className="h-3 w-3" />
                            {copied === `curl-${list.id}` ? "Copiado" : "Copiar cURL"}
                          </button>
                        </div>

                        <p className="text-[10px] text-muted-foreground">
                          {replaceMembers
                            ? "Quem não vier nesta carga sai da lista — é o modo de carteira do dia. Ao paginar, mande replaceMembers: true só na última página, senão cada página apaga a anterior."
                            : "A carga só acrescenta; ninguém sai da lista. Idempotente pelo listKey: rodar de novo atualiza os mesmos contatos."}{" "}
                          Até 5.000 linhas por requisição, e o{" "}
                          <code className="font-mono">variables</code> de cada linha vira
                          dynamic_variables na fala da agente.
                        </p>

                        <pre className="max-h-64 overflow-auto rounded-md border border-foreground/[0.06] bg-black/40 p-3 text-[10px] leading-relaxed text-muted-foreground">
                          {JSON.stringify(tpl.payload, null, 2)}
                        </pre>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {dialog && accountId && (
        <ListDialog
          accountId={accountId}
          list={dialog.mode === "edit" ? dialog.list : null}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function ListDialog({
  accountId,
  list,
  onClose,
  onSaved,
}: {
  accountId: string;
  list: OperationalList | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(list?.name ?? "");
  const [description, setDescription] = useState(list?.description ?? "");
  const [campaignKind, setCampaignKind] = useState(list?.campaignKind ?? "sdr");
  const [externalKey, setExternalKey] = useState(list?.externalKey ?? "");
  // Enquanto o usuário não editar a chave à mão, ela acompanha o nome — criar
  // lista sem chave é o erro fácil aqui, e ela é o que liga o webhook à lista.
  const [keyTouched, setKeyTouched] = useState(Boolean(list?.externalKey));
  const [saving, setSaving] = useState(false);

  const effectiveKey = keyTouched ? externalKey : slugifyKey(name);
  const canSave = useMemo(() => name.trim().length >= 2, [name]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        campaignKind,
        externalKey: effectiveKey.trim() ? effectiveKey.trim() : null,
      };
      if (list) {
        await updateOperationalList(accountId, list.id, payload);
      } else {
        await createOperationalList(accountId, payload);
      }
      toast.success(list ? "Lista atualizada." : "Lista criada.");
      onSaved();
    } catch (e: any) {
      toast.error(e?.body?.message ?? e?.message ?? "Erro ao salvar a lista");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-foreground/[0.08] bg-background p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-[14px] font-semibold">
            {list ? "Editar lista operacional" : "Nova lista operacional"}
          </h3>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Os contatos recebidos com esta chave entram aqui. Aponte a campanha de voz para a
            lista e as variáveis do payload chegam na fala da agente.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Nome
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Carteira do dia — cobrança"
              className="w-full rounded-md border border-foreground/[0.08] bg-foreground/[0.02] px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Tipo de operação
            </label>
            <Select value={campaignKind} onValueChange={setCampaignKind}>
              <SelectTrigger className="h-9 w-full bg-foreground/[0.02] text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAMPAIGN_KIND_OPTIONS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Chave de recebimento (listKey)
            </label>
            <input
              value={effectiveKey}
              onChange={(e) => {
                setKeyTouched(true);
                setExternalKey(e.target.value);
              }}
              placeholder="carteira-do-dia"
              className="w-full rounded-md border border-foreground/[0.08] bg-foreground/[0.02] px-3 py-2 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/40"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              É o valor que o seu sistema manda em{" "}
              <code className="font-mono">listKey</code>. Única por conta; em branco, a lista não
              recebe carga.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Descrição
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="De onde vêm estes contatos e o que a agente deve tratar."
              className="w-full resize-none rounded-md border border-foreground/[0.08] bg-foreground/[0.02] px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          {effectiveKey.trim() && (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                No payload
              </p>
              <pre className="overflow-x-auto rounded-md border border-foreground/[0.06] bg-black/40 p-2 text-[10px] text-muted-foreground">
                {`"listKey": "${effectiveKey.trim()}"`}
              </pre>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={cn(
              "rounded-md border border-foreground/[0.08] px-3 py-1.5 text-[11px] font-medium hover:bg-foreground/[0.04]",
              saving && "opacity-50",
            )}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !canSave}
            className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
