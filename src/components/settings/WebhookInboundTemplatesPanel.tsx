import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  Database,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/lib/account-context";
import { listAgents } from "@/lib/agents/registry.functions";
import {
  INBOUND_ENDPOINT,
  buildAgentTemplate,
  buildCurl,
  downloadJson,
  type AgentTemplate,
} from "@/lib/webhook-inbound-templates";
import {
  deleteAgentSource,
  fetchAgentSources,
  runAgentSource,
  type AgentSource,
} from "@/lib/agent-sources";
import { AgentSourceDialog } from "@/components/settings/AgentSourceDialog";
import { ensureN8nNode } from "@/lib/n8n";
import { cn } from "@/lib/utils";

type AgentRow = {
  key: string;
  name: string;
  kind: string;
  description: string;
  persona_id?: string | null;
};

/**
 * Um template por agente: o que mandar, para onde, e o JSON pronto para baixar.
 * Inclui as personas de voz cadastradas na conta, não só os três agentes
 * embutidos — quem cadastrou uma persona também quer automatizá-la.
 */
export function WebhookInboundTemplatesPanel() {
  const { accountId } = useAccount();
  const fnList = useServerFn(listAgents);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Único x lote é por agente: quem manda formulário um a um e quem sincroniza
  // carteira do dia costumam ser integrações diferentes.
  const [batch, setBatch] = useState<Record<string, boolean>>({});
  const [sources, setSources] = useState<AgentSource[]>([]);
  const [sourceDialog, setSourceDialog] = useState<{
    agentId: string;
    agentName: string;
    source: AgentSource | null;
  } | null>(null);
  // URL/método que o n8n devolveu ao criar (ou achar) o nó do agente — só
  // usado para pré-preencher o diálogo quando a fonte ainda não existe.
  const [n8nPrefill, setN8nPrefill] = useState<{ url: string; method: "GET" | "POST" } | null>(
    null,
  );
  const [removingSourceId, setRemovingSourceId] = useState<string | null>(null);
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null);
  // Agente cujo clique em "Configurar" está esperando o n8n responder —
  // só existe para o botão mostrar "Configurando…" em vez de parecer travado.
  const [configuringAgentId, setConfiguringAgentId] = useState<string | null>(null);

  const loadSources = () => {
    if (!accountId) return;
    fetchAgentSources(accountId)
      .then(setSources)
      // Silencioso: agente comum não enxerga fonte (só admin), e a tela de
      // templates continua útil sem ela.
      .catch(() => setSources([]));
  };

  /**
   * Busca agora, direto do card do agente. É a mesma execução do botão
   * Sincronizar da lista operacional e do "Salvar e testar" do diálogo — aqui
   * sem exigir teste prévio, porque este é justamente o lugar de tentar de novo
   * quando a última busca falhou.
   *
   * Duplicação está barrada nos dois lados: o botão desabilita enquanto roda e
   * o servidor recusa (409) se a fonte já estiver sincronizando.
   */
  const syncSource = async (source: AgentSource) => {
    if (!accountId) return;
    setSyncingSourceId(source.id);
    try {
      const result = await runAgentSource(accountId, source.id);
      if (result.ok) {
        toast.success(
          `${result.processed} contato(s) — ${result.created} novo(s), ${result.updated} atualizado(s).`,
        );
      } else {
        toast.error(result.error ?? "A busca falhou");
      }
      loadSources();
    } catch (e: any) {
      toast.error(e?.body?.message ?? "Não foi possível sincronizar");
    } finally {
      setSyncingSourceId(null);
    }
  };

  /**
   * Clique em "Configurar"/"Editar". Editar nunca mexe no n8n — abre direto,
   * "se existir não mexa" também vale para o formulário. Configurar (fonte
   * nova) tenta primeiro garantir o nó Webhook no workflow "Utalks" e
   * pré-preencher a URL; se a conta não tem n8n conectado (o caso comum, até
   * alguém configurar em Integrações), segue em silêncio para o formulário
   * vazio de sempre — isto é reforço, nunca bloqueio.
   */
  const openConfigure = async (
    agentId: string,
    agentName: string,
    source: AgentSource | null,
  ) => {
    setN8nPrefill(null);
    if (source || !accountId) {
      setSourceDialog({ agentId, agentName, source });
      return;
    }
    setConfiguringAgentId(agentId);
    try {
      const result = await ensureN8nNode(accountId, { agentName });
      if (result.configured && result.url) {
        setN8nPrefill({ url: result.url, method: "POST" });
        toast.success(
          result.created
            ? `Nó criado no workflow "Utalks" — URL preenchida automaticamente.`
            : `Nó de ${agentName} já existia no workflow "Utalks" — URL reaproveitada.`,
        );
      }
    } catch (e: any) {
      toast.warning(
        `n8n conectado, mas não deu para preparar o nó agora: ${e?.body?.message ?? e?.message ?? "erro"}. Configure a URL manualmente.`,
      );
    } finally {
      setConfiguringAgentId(null);
      setSourceDialog({ agentId, agentName, source: null });
    }
  };

  /**
   * "Configurar manualmente": abre o formulário direto, sem tentar achar/criar
   * nó no workflow "Utalks" do n8n primeiro. Existe porque a detecção
   * automática depende do n8n responder rápido — quando ele está lento ou
   * fora do ar, ou quando o cliente quer digitar uma URL própria (inclusive
   * de outro sistema, não n8n), esperar por ela só atrapalha.
   */
  const openManual = (agentId: string, agentName: string) => {
    setN8nPrefill(null);
    setSourceDialog({ agentId, agentName, source: null });
  };

  /** Remove a fonte e o token junto — o servidor apaga a entrada do cofre. */
  const removeSource = async (source: AgentSource, agentName: string) => {
    if (!accountId) return;
    if (
      !confirm(
        `Remover a fonte "${source.name}" de ${agentName}? O token guardado é apagado e a busca automática para. Os contatos já importados continuam na lista.`,
      )
    )
      return;
    setRemovingSourceId(source.id);
    try {
      await deleteAgentSource(accountId, source.id);
      setSources((prev) => prev.filter((s) => s.id !== source.id));
      toast.success("Fonte removida.");
    } catch (e: any) {
      toast.error(e?.body?.message ?? "Não foi possível remover a fonte");
    } finally {
      setRemovingSourceId(null);
    }
  };

  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    fnList({ data: { accountId } })
      .then((r) => setAgents(Array.isArray(r?.agents) ? (r.agents as AgentRow[]) : []))
      .catch((e) =>
        toast.error(`Não foi possível carregar os agentes: ${e?.message ?? e}`),
      )
      .finally(() => setLoading(false));
    loadSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, fnList]);

  const templates = useMemo<AgentTemplate[]>(
    () => agents.map((a) => buildAgentTemplate(a)),
    [agents],
  );

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      toast.success("Copiado");
      setTimeout(() => setCopied(null), 1500);
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Endpoint
            </p>
            <p className="break-all font-mono text-[11px]">POST {INBOUND_ENDPOINT}</p>
          </div>
          <button
            type="button"
            onClick={() => copy(INBOUND_ENDPOINT, "endpoint")}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:text-foreground"
            aria-label="Copiar endpoint"
          >
            {copied === "endpoint" ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Autentique com{" "}
          <code className="font-mono text-[10px]">Authorization: Bearer ntk_…</code> — gere a
          chave em <span className="text-foreground">Chaves de acesso</span>. O{" "}
          <code className="font-mono text-[10px]">phone</code> é a chave principal: mesmo
          telefone atualiza o contato e mescla as variáveis, nunca duplica. Os contatos entram
          numa <span className="text-foreground">lista operacional</span> por agente — aponte a
          campanha de voz para ela e as <code className="font-mono text-[10px]">variables</code>{" "}
          chegam na fala da agente. Aceita um contato{" "}
          <code className="font-mono text-[10px]">{"{…}"}</code> ou lote{" "}
          <code className="font-mono text-[10px]">{"[{…}, {…}]"}</code>.
        </p>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] py-10 text-center text-[12px] text-muted-foreground">
          Nenhum agente disponível nesta conta.
        </div>
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => {
            const agent = agents.find((a) => a.key === t.agentKey)!;
            const expanded = open === t.agentKey;
            const isBatch = batch[t.agentKey] === true;
            const payload = isBatch ? t.batchPayload : t.payload;
            return (
              <li
                key={t.agentKey}
                className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold">{agent.name}</span>
                        <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-medium uppercase text-muted-foreground">
                          {agent.kind}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {agent.description}
                      </p>
                      <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                        agent: {t.agentId}
                      </p>
                      <p className="break-all font-mono text-[10px] text-muted-foreground">
                        lista operacional: {t.listKey}
                      </p>
                      {!t.usesPersonaId && (
                        <p className="mt-1 text-[10px] text-amber-300">
                          Agente ainda não instalado nesta conta: o template usa o slug{" "}
                          <code className="font-mono">{t.agentKey}</code> e o recebimento vai
                          recusar. Instale em <span className="font-medium">Agentes de voz</span>{" "}
                          para o id da persona entrar aqui.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <div className="flex items-center gap-0.5 rounded-md border border-white/[0.08] bg-white/[0.02] p-0.5">
                      {[
                        { value: false, label: "Único" },
                        { value: true, label: "Lote" },
                      ].map((opt) => (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() =>
                            setBatch((b) => ({ ...b, [t.agentKey]: opt.value }))
                          }
                          className={cn(
                            "rounded px-2 py-0.5 text-[10px] font-medium",
                            isBatch === opt.value
                              ? "bg-white/[0.10] text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          downloadJson(
                            isBatch ? t.batchFileName : t.fileName,
                            isBatch ? t.batchTemplate : t.template,
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        <Download className="h-3 w-3" /> Baixar JSON
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          copy(JSON.stringify(payload, null, 2), `payload-${t.agentKey}`)
                        }
                        className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium hover:bg-white/[0.08]"
                      >
                        {copied === `payload-${t.agentKey}` ? "Copiado" : "Copiar payload"}
                      </button>
                      <button
                        type="button"
                        onClick={() => copy(buildCurl(payload), `curl-${t.agentKey}`)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium hover:bg-white/[0.08]"
                      >
                        <Terminal className="h-3 w-3" />
                        {copied === `curl-${t.agentKey}` ? "Copiado" : "Copiar cURL"}
                      </button>
                    </div>
                  </div>
                </div>

                {t.usesPersonaId && (
                  <SourcesBlock
                    // Todas, não só a primeira: fonte que a tela não mostra é
                    // fonte que ninguém consegue remover nem corrigir.
                    sources={sources.filter((s) => s.agent_id === t.agentId)}
                    agentName={agent.name}
                    removing={removingSourceId}
                    syncing={syncingSourceId}
                    configuring={configuringAgentId === t.agentId}
                    onConfigure={(source) => void openConfigure(t.agentId, agent.name, source)}
                    onConfigureManual={() => openManual(t.agentId, agent.name)}
                    onRemove={removeSource}
                    onSync={syncSource}
                  />
                )}

                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : t.agentKey)}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown
                    className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")}
                  />
                  {expanded ? "Ocultar campos" : "Ver campos e exemplo"}
                </button>

                {expanded && (
                  <div className="mt-2 space-y-3">
                    <FieldTable title="Contato" fields={t.fields} />
                    <FieldTable title="variables (contexto da fala)" fields={t.variableFields} />
                    <pre className="overflow-x-auto rounded-md border border-white/[0.06] bg-black/40 p-3 text-[10px] leading-relaxed text-muted-foreground">
                      {JSON.stringify(payload, null, 2)}
                    </pre>
                    {isBatch && (
                      <p className="text-[10px] text-muted-foreground">
                        Até 500 contatos por requisição. Linha com telefone inválido volta como{" "}
                        <code className="font-mono">skipped</code> e as outras entram; o lote de
                        aprovação na campanha é criado uma vez, não um por contato.
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {sourceDialog && accountId && (
        <AgentSourceDialog
          accountId={accountId}
          agentId={sourceDialog.agentId}
          agentName={sourceDialog.agentName}
          source={sourceDialog.source}
          prefillUrl={n8nPrefill?.url}
          prefillMethod={n8nPrefill?.method}
          onClose={() => {
            setSourceDialog(null);
            setN8nPrefill(null);
          }}
          onSaved={loadSources}
        />
      )}
    </div>
  );
}

/**
 * Estado das fontes de dados do agente. Fica no card do agente, e não numa
 * tela separada, porque "de onde vêm os contatos deste agente" é a mesma
 * pergunta que o template ao lado responde pelo caminho do push.
 *
 * Mais de uma fonte por agente é suportado de propósito: cada uma tem sua
 * própria URL/método/token, útil quando o cliente tem mais de um sistema de
 * origem (ex.: um endpoint GET pra carteira ativa, outro POST pra leads novos)
 * alimentando a mesma lista operacional.
 */
function SourcesBlock({
  sources,
  agentName,
  removing,
  syncing,
  configuring,
  onConfigure,
  onConfigureManual,
  onRemove,
  onSync,
}: {
  sources: AgentSource[];
  agentName: string;
  removing: string | null;
  syncing: string | null;
  /** Aguardando o n8n responder ao clique em "Nova fonte". */
  configuring: boolean;
  onConfigure: (source: AgentSource | null) => void;
  /** Abre o formulário direto, sem tentar detectar nó no n8n primeiro. */
  onConfigureManual: () => void;
  onRemove: (source: AgentSource, agentName: string) => void;
  onSync: (source: AgentSource) => void;
}) {
  return (
    <div className="mt-2 space-y-1.5">
      {sources.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Nenhuma fonte configurada.</p>
      ) : (
        sources.map((source) => (
          <SourceRow
            key={source.id}
            source={source}
            agentName={agentName}
            removing={removing}
            syncing={syncing}
            onConfigure={onConfigure}
            onRemove={onRemove}
            onSync={onSync}
            compact
          />
        ))
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onConfigure(null)}
          disabled={configuring}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-white/[0.12] bg-transparent px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:border-white/[0.2] hover:text-foreground disabled:opacity-50"
        >
          {configuring ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          {configuring ? "Configurando…" : "Nova fonte"}
        </button>
        <button
          type="button"
          onClick={onConfigureManual}
          disabled={configuring}
          className="text-[10px] text-muted-foreground underline decoration-dotted hover:text-foreground disabled:opacity-50"
        >
          configurar manualmente (pular detecção no n8n)
        </button>
      </div>
    </div>
  );
}

function SourceRow({
  source,
  agentName,
  removing,
  syncing,
  configuring,
  onConfigure,
  onRemove,
  onSync,
  compact,
}: {
  source: AgentSource | null;
  agentName: string;
  removing: string | null;
  syncing: string | null;
  configuring?: boolean;
  onConfigure: (source: AgentSource | null) => void;
  onRemove: (source: AgentSource, agentName: string) => void;
  onSync: (source: AgentSource) => void;
  compact?: boolean;
}) {
  const busy = !!source && (syncing === source.id || source.running);
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5",
        !compact && "mt-2",
      )}
    >
      <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-[11px] text-muted-foreground">Fonte de dados:</span>
      {source ? (
        <>
          <code className="min-w-0 break-all font-mono text-[10px] text-foreground">
            {source.method} {source.url}
          </code>
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
              source.last_status === "ok"
                ? "bg-emerald-500/20 text-emerald-300"
                : source.last_status === "erro"
                  ? "bg-rose-500/20 text-rose-300"
                  : "bg-slate-500/20 text-slate-400",
            )}
          >
            {source.last_status === "ok"
              ? `testada · ${source.last_count ?? 0} contato(s)`
              : source.last_status === "erro"
                ? "última busca falhou"
                : "nunca testada"}
          </span>
          {source.schedule_minutes && (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              a cada {source.schedule_minutes} min
            </span>
          )}
        </>
      ) : (
        <span className="text-[11px] text-muted-foreground">não configurada</span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => onConfigure(source)}
          disabled={!source && configuring}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium hover:bg-white/[0.08] disabled:opacity-50"
        >
          {!source && configuring && <Loader2 className="h-3 w-3 animate-spin" />}
          {source ? "Editar" : configuring ? "Configurando…" : "Configurar"}
        </button>
        {source && (
          <button
            type="button"
            onClick={() => onSync(source)}
            disabled={busy || removing === source.id}
            title={`Buscar agora em ${source.url}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} />
            {busy ? "Sincronizando…" : "Sincronizar"}
          </button>
        )}
        {source && (
          <button
            type="button"
            onClick={() => onRemove(source, agentName)}
            disabled={removing === source.id || busy}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
            aria-label="Remover fonte de dados"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function FieldTable({
  title,
  fields,
}: {
  title: string;
  fields: Array<{ field: string; required: boolean; desc: string }>;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul className="space-y-1">
        {fields.map((f) => (
          <li key={f.field} className="flex items-baseline gap-2 text-[11px]">
            <code className="shrink-0 font-mono text-foreground">{f.field}</code>
            {f.required && (
              <span className="shrink-0 rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-rose-300">
                obrigatório
              </span>
            )}
            <span className="text-muted-foreground">{f.desc}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
